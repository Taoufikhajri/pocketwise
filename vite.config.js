import { defineConfig, loadEnv } from 'vite';
import { createSmartHandler } from './server/smart-handler.js';

// Local counterpart of the Vercel function. Secrets stay in this Node process;
// Vite only exposes VITE_ variables to the browser.
export default defineConfig(({mode})=>({
  plugins:[{
    name:'pocketwise-local-api',
    configureServer(server){
      const handler=createSmartHandler({env:{...loadEnv(mode,process.cwd(),''),...process.env}});
      server.middlewares.use(async(req,res,next)=>{
        if(req.url?.split('?')[0]!=='/api/smart-entry')return next();
        const response={
          setHeader:(...args)=>res.setHeader(...args),
          status(code){res.statusCode=code;return this;},
          json(body){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));}
        };
        try{
          const chunks=[];let length=0;
          for await(const chunk of req){length+=chunk.length;if(length>3000000){response.status(413).json({error:'Upload is too large.'});return;}chunks.push(chunk);}
          req.body=Buffer.concat(chunks).toString('utf8');
          await handler(req,response);
        }catch{if(!res.writableEnded)response.status(400).json({error:'Could not read this upload.'});}
      });
    }
  }]
}));
