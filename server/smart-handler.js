import { SmartError, validateSmartRequest } from './smart-core.js';
import { extractWithOpenAI } from './openai.js';

export function createSmartHandler({env=process.env,fetcher=fetch}={}) {
  return async function handler(req,res) {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if (req.method!=='POST') {res.setHeader('Allow','POST');return res.status(405).json({error:'Use POST.'});}
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),50000);
    try {
      const token = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(req.headers.authorization || '')?.[1];
      if (!token) throw new SmartError(401,'Sign in before using smart entry.');
      const supabaseURL = env.VITE_SUPABASE_URL;
      const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!supabaseURL?.startsWith('https://') || !supabaseKey) throw new SmartError(503,'Supabase is not configured on the server.');
      const base = supabaseURL.replace(/\/$/,'');
      const authHeaders = {apikey:supabaseKey,Authorization:`Bearer ${token}`};
      const auth = await fetcher(`${base}/auth/v1/user`,{headers:authHeaders,signal:controller.signal});
      if (!auth.ok) throw new SmartError(401,'Your session expired. Sign in again.');
      const user=await auth.json();
      if (!user.id || !user.email || !user.email_confirmed_at) throw new SmartError(403,'Confirm your account email before using smart entry.');
      const allowed=(env.AI_ALLOWED_EMAILS || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
      if (!env.OPENAI_API_KEY || !allowed.length) throw new SmartError(503,'Smart entry needs server setup. Add the API key and allowed account email in Vercel.');
      if (!allowed.includes(user.email.toLowerCase())) throw new SmartError(403,'Smart entry is not enabled for this account.');
      if (!String(req.headers['content-type']||'').startsWith('application/json')) throw new SmartError(415,'Send JSON with a supported image or audio file.');
      const serialized=typeof req.body==='string'?req.body:JSON.stringify(req.body);
      if (!serialized || Buffer.byteLength(serialized)>3000000) throw new SmartError(413,'The smart-entry upload is too large.');
      let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{throw new SmartError(400,'Invalid JSON request.');}
      const input=validateSmartRequest(body);
      // A database counter survives serverless cold starts and concurrent requests.
      const quota=await fetcher(`${base}/rest/v1/rpc/consume_smart_entry`,{method:'POST',headers:{...authHeaders,'Content-Type':'application/json'},body:'{}',signal:controller.signal});
      if (!quota.ok) throw new SmartError(503,'Smart entry is not ready. Run the smart-entry SQL setup in Supabase.');
      if (await quota.json() !== true) throw new SmartError(429,'You have reached 30 smart-entry attempts for today. Use manual entry or try tomorrow (UTC).');
      const draft=await extractWithOpenAI(input,{env,fetcher,signal:controller.signal});
      return res.status(200).json(draft);
    } catch(error) {
      if (controller.signal.aborted) return res.status(504).json({error:'Smart entry took too long. Try a shorter voice note or a clearer photo.'});
      if (error instanceof SmartError) return res.status(error.status).json({error:error.message});
      // Never return provider bodies, uploaded content, tokens, or configuration.
      return res.status(502).json({error:'Smart entry could not connect. Please try again.'});
    } finally {clearTimeout(timer);}
  };
}
