import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmartHandler } from '../server/smart-handler.js';

const env={OPENAI_API_KEY:'server-only-test-secret',AI_ALLOWED_EMAILS:'owner@example.test',VITE_SUPABASE_URL:'https://db.example.test',VITE_SUPABASE_PUBLISHABLE_KEY:'public-test-key'};
const context={currency:'CAD',today:'2026-09-10'};
const draft={amount:'17.25',date:'2026-09-10',type:'expense',category:'Groceries',account:'Cash',note:'Groceries',currency:'CAD',warnings:[]};
const jpeg=Buffer.from([255,216,255,224,0,0]).toString('base64');
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const completion=data=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(data)}]}]});
async function invoke(body,{token='test-session',email='owner@example.test',quota=true,provider,settings=env}={}) {
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/auth/v1/user'))return response({id:'owner-id',email,email_confirmed_at:'2026-01-01'});
    if(url.endsWith('/rpc/consume_smart_entry'))return response(quota);
    if(provider)return provider(url,options);
    return response(completion(draft));
  };
  const headers={};let status,result;
  const res={setHeader:(key,value)=>headers[key]=value,status(code){status=code;return this;},json(data){result=data;return this;}};
  await createSmartHandler({env:settings,fetcher})({method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body},res);
  return {status,result,calls,headers};
}
test('anonymous and non-allowlisted requests never reach the paid provider',async()=>{
  const anonymous=await invoke({...context,kind:'text',text:'Lunch 12 dollars'},{token:''});
  assert.equal(anonymous.status,401);assert.equal(anonymous.calls.length,0);
  const stranger=await invoke({...context,kind:'text',text:'Lunch 12 dollars'},{email:'stranger@example.test'});
  assert.equal(stranger.status,403);assert.equal(stranger.calls.length,1);
});
test('receipt extraction is authenticated, quota checked and uses a non-stored structured response',async()=>{
  const result=await invoke({...context,kind:'receipt',mime:'image/jpeg',data:jpeg,user_id:'other-user'});
  assert.equal(result.status,200);assert.equal(result.result.transaction.amount,1725);
  assert.equal(result.result.transaction.id,undefined);assert.equal(result.calls.length,3);
  const providerCall=result.calls[2];const body=JSON.parse(providerCall.options.body);
  assert.equal(body.store,false);assert.equal(body.text.format.strict,true);
  assert.equal(body.input[0].content[1].image_url,`data:image/jpeg;base64,${jpeg}`);
  assert.equal(result.headers['Cache-Control'],'no-store');
  assert.ok(!JSON.stringify(result.result).includes(env.OPENAI_API_KEY));
});
test('voice transcription is passed to extraction and returned for user review',async()=>{
  let transcribed=false;
  const r=await invoke({...context,kind:'voice',mime:'audio/webm',data:Buffer.from([26,69,223,163,1]).toString('base64')},{provider:(url,options)=>{
    if(url.endsWith('/transcriptions')){assert.ok(options.body instanceof FormData);assert.equal(options.body.get('file').name,'voice.webm');transcribed=true;return response({text:'Spent CAD 17.25 on groceries today, cash.'});}
    assert.equal(transcribed,true);assert.match(JSON.parse(options.body).input[0].content[1].text,/17.25/);return response(completion(draft));
  }});
  assert.equal(r.status,200);assert.match(r.result.transcript,/17.25/);
});
test('quota exhaustion and malformed media stop before a provider call',async()=>{
  const capped=await invoke({...context,kind:'text',text:'Lunch'},{quota:false});
  assert.equal(capped.status,429);assert.equal(capped.calls.length,2);
  const invalid=await invoke({...context,kind:'receipt',mime:'image/jpeg',data:'b3RoZXI='});
  assert.equal(invalid.status,400);assert.equal(invalid.calls.length,1);
});
test('provider failure and refusal return an actionable error without exposing secrets or saving records',async()=>{
  const failed=await invoke({...context,kind:'text',text:'Lunch'},{provider:()=>response({secret:env.OPENAI_API_KEY},500)});
  assert.equal(failed.status,502);assert.ok(!JSON.stringify(failed.result).includes(env.OPENAI_API_KEY));
  const refused=await invoke({...context,kind:'text',text:'Lunch'},{provider:()=>response({status:'completed',output:[{content:[{type:'refusal',refusal:'no'}]}]})});
  assert.equal(refused.status,422);
  assert.ok(failed.calls.every(c=>!c.url.includes('/transactions')));
});
