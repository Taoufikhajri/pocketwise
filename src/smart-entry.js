import { today } from './finance.js';
import { icon, modal } from './views.js';
import './smart-entry.css';

const MAX_BYTES=2*1024*1024;
function asBase64(blob) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(',')[1]);
    reader.onerror=()=>reject(new Error('Could not read this file. Try selecting it again.'));
    reader.readAsDataURL(blob);
  });
}
async function receiptImage(file) {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPG, PNG, or WebP photo. For HEIC or PDF bills, export a JPG or take a screenshot first.');
  if(file.size>15*1024*1024)throw new Error('Choose an image smaller than 15 MB.');
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=url;await image.decode();
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>40000000)throw new Error('This image is too large to process on your device. Crop it or choose a smaller photo.');
    const scale=Math.min(1,2048/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image preparation is not supported in this browser.');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    // Re-encoding also removes the original photo's metadata before upload.
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.86));
    if(!blob||blob.size>MAX_BYTES)throw new Error('Crop the photo more closely around the bill, then try again.');
    return blob;
  }finally{URL.revokeObjectURL(url);}
}

export function createSmartEntry({dialog,open,context,onDraft}) {
  let active=false,kind='',media=null,previewURL='',recorder=null,stream=null,ticker=null,controller=null,generation=0,processing=false,previousNodes=[],microphoneTicket=0;
  const find=selector=>dialog.querySelector(selector);
  const status=text=>{const el=find('#smart-status');if(el)el.textContent=text;};
  const error=text=>{const el=find('.form-error');if(el)el.textContent=text;};
  function releaseStream(){stream?.getTracks().forEach(track=>track.stop());stream=null;clearInterval(ticker);ticker=null;}
  function cleanup(){
    active=false;generation++;microphoneTicket=0;controller?.abort();controller=null;
    if(recorder&&recorder.state!=='inactive'){recorder.onstop=null;recorder.stop();}
    recorder=null;releaseStream();media=null;processing=false;
    if(previewURL)URL.revokeObjectURL(previewURL);previewURL='';
  }
  function lock(locked){
    processing=locked;
    dialog.querySelectorAll('[data-smart-action]:not([data-smart-action="back"]),#smart-file,#smart-camera,#smart-text').forEach(el=>el.disabled=locked);
  }
  function showMedia(blob,label){
    media=blob;if(previewURL)URL.revokeObjectURL(previewURL);previewURL=URL.createObjectURL(blob);
    const area=find('#smart-preview');area.replaceChildren();
    const el=document.createElement(kind==='receipt'?'img':'audio');el.src=previewURL;
    if(kind==='receipt'){el.alt='Receipt photo to review before analysis';}else{el.controls=true;}
    area.append(el);const caption=document.createElement('p');caption.textContent=label;area.append(caption);
    status(kind==='receipt'?'Photo ready. Check that the total and date are readable.':'Voice note ready. Listen back, then create your draft.');
  }
  async function chooseFile(file){
    if(!file)return;const ticket=++generation;lock(true);error('');status('Preparing your file…');
    media=null;if(previewURL)URL.revokeObjectURL(previewURL);previewURL='';find('#smart-preview').replaceChildren();
    try{
      let blob=file;
      if(kind==='receipt')blob=await receiptImage(file);
      else{
        const mime=file.type.split(';')[0];
        if(!['audio/webm','audio/mp4','audio/x-m4a','audio/mpeg','audio/wav','audio/x-wav','video/mp4'].includes(mime))throw new Error('Choose a WebM, MP4/M4A, MP3 or WAV voice note.');
        if(file.size>MAX_BYTES)throw new Error('Choose an audio file smaller than 2 MB.');
        blob=new Blob([file],{type:['audio/x-m4a','video/mp4'].includes(mime)?'audio/mp4':mime});
      }
      if(!active||ticket!==generation)return;
      showMedia(blob,file.name);
    }catch(e){if(active&&ticket===generation){error(e.message);status('Choose another file to try again.');}}
    finally{if(active&&ticket===generation)lock(false);}
  }
  function stopRecording(){if(recorder&&recorder.state!=='inactive')recorder.stop();releaseStream();}
  async function record(){
    if(recorder?.state==='recording'){stopRecording();return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('Recording is unavailable in this browser. Upload a voice note or type your transaction below.');
    const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    if(!mime)throw new Error('This browser cannot record a supported format. Upload a voice note or type below.');
    const ticket=++generation;microphoneTicket=ticket;lock(true);error('');status('Allow microphone access to record your transaction.');
    let acquired;
    try{acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});}
    catch{
      if(!active||ticket!==generation)return;
      microphoneTicket=0;lock(false);status('Microphone access was not available.');
      throw new Error('Microphone permission was denied or no microphone was found. Upload audio or type instead.');
    }
    if(microphoneTicket===ticket)microphoneTicket=0;
    if(!active||ticket!==generation||document.hidden){
      acquired.getTracks().forEach(track=>track.stop());
      if(active&&ticket===generation){lock(false);status('Recording did not start because the page was hidden. Try again when you return.');}
      return;
    }
    stream=acquired;
    try{recorder=new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:64000});}
    catch{releaseStream();lock(false);throw new Error('Could not start recording. Try uploading a voice note.');}
    const chunks=[];let bytes=0,tooLarge=false;
    recorder.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>MAX_BYTES){tooLarge=true;stopRecording();}}};
    recorder.onerror=()=>{stopRecording();error('Recording failed. Please try again.');};
    recorder.onstop=()=>{
      releaseStream();if(!active||ticket!==generation)return;
      const blob=new Blob(chunks,{type:mime.split(';')[0]});recorder=null;lock(false);
      find('[data-smart-action="record"]').innerHTML=`${icon('mic')}Record again`;
      if(tooLarge||blob.size>MAX_BYTES){error('The recording is too large. Please record a shorter note.');return;}
      if(!blob.size){error('No audio was captured. Please try again.');return;}
      showMedia(blob,'Recorded voice note');
    };
    try{recorder.start(250);}
    catch{recorder=null;releaseStream();lock(false);status('Recording did not start.');throw new Error('Could not start recording. Upload a voice note or try again.');}
    const button=find('[data-smart-action="record"]');button.disabled=false;button.innerHTML=`${icon('stop')}Stop recording`;
    const started=Date.now();status('Recording… 0:00 / 1:00');
    ticker=setInterval(()=>{const seconds=Math.floor((Date.now()-started)/1000);status(`Recording… ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} / 1:00`);if(seconds>=60)stopRecording();},250);
  }
  async function analyze(){
    const ctx=context();if(ctx.demo||!ctx.client)throw new Error('Sign in to analyze your own receipts and voice notes.');
    const description=find('#smart-text')?.value.trim() || '';
    if(!media&&!description)throw new Error(kind==='receipt'?'Choose a receipt photo first.':'Record or upload a voice note, or type a transaction.');
    const ticket=++generation;controller=new AbortController();lock(true);error('');status(kind==='receipt'?'Reading the bill…':'Preparing your transaction…');
    const userId=ctx.userId;
    try{
      const {data,error:sessionError}=await ctx.client.auth.getSession();
      if(sessionError||!data.session||data.session.user.id!==userId)throw new Error('Your session expired. Please sign in again.');
      const body={kind:media?kind:'text',currency:ctx.currency,today:today()};
      if(media){body.mime=media.type.split(';')[0];body.data=await asBase64(media);}else body.text=description;
      if(!active||ticket!==generation)return;
      const response=await fetch('/api/smart-entry',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify(body),signal:controller.signal});
      let result;try{result=await response.json();}catch{throw new Error('Smart entry is unavailable here. Use the deployed app or the included local development server.');}
      if(!response.ok)throw new Error(result.error || 'Could not create a draft. Try again.');
      if(!active||ticket!==generation||context().userId!==userId)return;
      cleanup();onDraft(result);
    }catch(e){if(active&&ticket===generation&&e.name!=='AbortError'){error(e.message);status('Nothing was saved. You can retry or enter the transaction manually.');}}
    finally{if(active&&ticket===generation)lock(false);}
  }
  function start(mode){
    cleanup();previousNodes=[...dialog.childNodes];active=true;kind=mode;
    const demo=context().demo;
    const receipt=mode==='receipt';
    const content=demo?`<div class="smart-intro"><span class="smart-symbol">${icon(receipt?'camera':'mic')}</span><h3>${receipt?'A photo becomes a draft':'Say it, then review it'}</h3><p>Sign in to analyze your own ${receipt?'receipt photos':'voice notes'}. You can try a sample suggestion in this demo.</p><button class="button primary" data-smart-action="sample">Try a sample suggestion</button></div>`:
      `<p class="dialog-intro">${receipt?'Take or upload one bill or receipt. We’ll suggest its total, date, and category.':'Say one transaction, for example: “I spent twelve dollars and fifty cents on lunch yesterday, paid cash.”'}</p>
      ${!receipt?`<button class="button primary full-width record-button" data-smart-action="record">${icon('mic')}Start recording</button><p class="smart-help">Up to 60 seconds. Recording starts only when you tap the button.</p>`:''}
      <label class="smart-upload">${icon(receipt?'camera':'up')}<strong>${receipt?'Choose a receipt photo':'Or upload a voice note'}</strong><span>${receipt?'JPG, PNG, WebP · up to 15 MB, resized before upload':'WebM, MP4/M4A, MP3, WAV · up to 2 MB'}</span><input id="smart-file" type="file" accept="${receipt?'image/jpeg,image/png,image/webp':'audio/webm,audio/mp4,audio/x-m4a,audio/mpeg,audio/wav,audio/x-wav,.m4a'}" /></label>
      ${receipt?`<label class="button secondary file-button camera-button">${icon('camera')}Take a photo<input id="smart-camera" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" /></label>`:''}
      <div id="smart-preview" class="smart-preview"></div>${!receipt?'<label class="field">Or type a transaction<textarea id="smart-text" maxlength="3000" rows="3" placeholder="Spent CAD 12.50 on lunch yesterday, paid cash"></textarea><small>If an audio clip is selected, it is used instead of this text.</small></label>':''}
      <p id="smart-status" class="smart-status" role="status">Nothing has been sent yet.</p><p class="smart-privacy">When you choose Create draft, this ${receipt?'photo':'audio or text'} is sent to OpenAI to suggest a transaction. Pocketwise does not store the original file. Always check the draft before saving.</p><button class="button primary full-width" data-smart-action="analyze">${icon('sparkles')}Create draft</button>`;
    open(modal(receipt?'Scan a bill or receipt':'Voice entry',`${content}<p class="form-error" role="alert"></p><button class="button text-button smart-back" data-smart-action="back">${icon('left')}Back to manual entry</button>`));
  }
  dialog.addEventListener('click',async e=>{
    const button=e.target.closest('[data-smart-action]');if(!active||!button)return;
    const action=button.dataset.smartAction;
    if(action==='back'){cleanup();dialog.replaceChildren(...previousNodes);return;}
    if(action==='sample'){
      const result={transaction:{amount:1250,date:today(),type:'expense',category:'Food & drinks',account:'Cash',note:'Sample lunch'},sourceCurrency:'CAD',warnings:['This is a sample suggestion, not a scan of your data.'],transcript:kind==='voice'?'I spent CAD twelve dollars and fifty cents on lunch today, paid cash.':''};
      cleanup();onDraft(result);return;
    }
    if(processing&&!(action==='record'&&recorder?.state==='recording'))return;
    try{if(action==='record')await record();if(action==='analyze')await analyze();}catch(err){if(active)error(err.message);}
  });
  dialog.addEventListener('change',e=>{if(active&&['smart-file','smart-camera'].includes(e.target.id)){const file=e.target.files[0];e.target.value='';chooseFile(file);}});
  dialog.addEventListener('close',cleanup);
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)return;
    stopRecording();
    if(microphoneTicket){microphoneTicket=0;generation++;lock(false);status('The microphone request was cancelled when you left the page. Tap Start recording to try again.');}
  });
  window.addEventListener('pagehide',cleanup);
  return {start,cleanup};
}
