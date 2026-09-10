import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import { JSDOM } from 'jsdom';

const output=await build({configFile:false,logLevel:'silent',build:{write:false,minify:false,lib:{entry:'src/smart-entry.js',name:'SmartEntryTest',formats:['iife']}}});
const code=(Array.isArray(output)?output:[output]).flatMap(result=>result.output).find(item=>item.type==='chunk').code;
async function pendingRecording({startFailure=false}={}){
  const dom=new JSDOM('<dialog></dialog>',{url:'https://pocketwise.test',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;const dialog=w.document.querySelector('dialog');
  let resolvePermission,started=0,stopped=0;
  const stream={getTracks:()=>[{stop:()=>stopped++}]};
  Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:()=>new Promise(resolve=>resolvePermission=resolve)}});
  w.MediaRecorder=class{
    static isTypeSupported(){return true;}
    constructor(){this.state='inactive';}
    start(){if(startFailure)throw new Error('Recorder unavailable');this.state='recording';started++;}
    stop(){this.state='inactive';this.onstop?.();}
  };
  const {createSmartEntry}=w.eval(`${code}\nSmartEntryTest`);
  const smart=createSmartEntry({dialog,open:html=>dialog.innerHTML=html,context:()=>({demo:false,currency:'CAD'}),onDraft:()=>{throw new Error('Must not save or create a draft while acquiring the microphone.');}});
  smart.start('voice');dialog.querySelector('[data-smart-action="record"]').click();
  return {dom,w,dialog,smart,grant:()=>resolvePermission(stream),counts:()=>({started,stopped}),settle:()=>new Promise(resolve=>setTimeout(resolve,5))};
}
test('hiding the page cancels pending microphone acquisition, even if permission resolves later',async()=>{
  const x=await pendingRecording();try{
    Object.defineProperty(x.w.document,'hidden',{value:true,configurable:true});
    x.w.document.dispatchEvent(new x.w.Event('visibilitychange'));
    x.grant();await x.settle();
    assert.deepEqual(x.counts(),{started:0,stopped:1});
    assert.equal(x.dialog.querySelector('[data-smart-action="record"]').disabled,false);
  }finally{x.smart.cleanup();x.dom.window.close();}
});
test('closing the dialog releases a late microphone stream without starting it',async()=>{
  const x=await pendingRecording();try{
    x.dialog.dispatchEvent(new x.w.Event('close'));x.grant();await x.settle();
    assert.deepEqual(x.counts(),{started:0,stopped:1});
  }finally{x.smart.cleanup();x.dom.window.close();}
});
test('a recorder start failure releases microphone tracks and lets the user retry',async()=>{
  const x=await pendingRecording({startFailure:true});try{
    x.grant();await x.settle();
    assert.deepEqual(x.counts(),{started:0,stopped:1});
    assert.equal(x.dialog.querySelector('[data-smart-action="record"]').disabled,false);
    assert.match(x.dialog.querySelector('.form-error').textContent,/record/i);
  }finally{x.smart.cleanup();x.dom.window.close();}
});
