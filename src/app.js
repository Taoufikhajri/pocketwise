import './styles.css';
import { CURRENCIES, EXPENSES, INCOME, MAX_BACKUP_BYTES, cents, today, shiftMonth, monthLabel, demoData, validateTransaction, validateBackup, toCSV } from './finance.js';
import { client, configured, loadData, saveTransaction, deleteTransaction, saveBudgets, saveCurrency, restoreBackup } from './data.js';
import { escape, icon, shell, modal, transactionForm, transactionResults, filteredTransactions } from './views.js';
import { createSmartEntry } from './smart-entry.js';

const app=document.querySelector('#app'), dialog=document.querySelector('#dialog');
const state={...demoData(),demo:true,user:null,page:'overview',month:today().slice(0,7),entryDate:today(),search:'',filter:'all',category:'all',offset:0,ready:true,loading:false,loadError:''};
let busy=false, requestId=0, authMode='signin', pendingBackup=null, toastTimer;
const currentPage=()=>['overview','transactions','budgets','reports','settings'].includes(location.hash.slice(1))?location.hash.slice(1):'overview';
state.page=currentPage();
const smart=createSmartEntry({dialog,open,context:()=>({demo:state.demo,client,userId:state.user?.id,currency:state.currency}),onDraft:result=>{
  const warnings=[...(result.warnings || [])];
  const r=result.transaction;
  if(r.amount&&state.transactions.some(t=>t.date===r.date&&t.amount===r.amount&&t.type===r.type))warnings.push('A transaction with this date and amount already exists. Check for a duplicate before saving.');
  open(transactionForm(state,r,{...result,warnings}));
}});
function render() { app.innerHTML=shell(state); }
function toast(message,error=false) {
  const el=document.querySelector('#toast'); el.textContent=message;el.className=`visible ${error?'error':''}`;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='',6500);
}
function open(content) { dialog.innerHTML=content;if(!dialog.open)dialog.showModal(); }
function close() { if(!busy) dialog.close(); }
function message(error) { return error?.message || 'Something went wrong. Please try again.'; }
async function run(task,success='') {
  if(busy) return;
  busy=true; requestId++;
  const controls=[...dialog.querySelectorAll('button, input, select')];
  const previous=controls.map(el=>el.disabled);controls.forEach(el=>el.disabled=true);
  const errorEl=dialog.querySelector('.form-error');if(errorEl)errorEl.textContent='';
  try { await task(); if(success)toast(success); }
  catch(error) { const text=message(error); const currentError=dialog.querySelector('.form-error');if(currentError)currentError.textContent=text;else toast(text,true); }
  finally { busy=false;controls.forEach((el,i)=>el.disabled=previous[i]); }
}
async function refresh({silent=false}={}) {
  if(state.demo||!state.user) return;
  const ticket=++requestId,id=state.user.id;
  if(!silent) {state.loading=true;render();}
  try {
    const data=await loadData(id);
    if(ticket!==requestId || state.demo || state.user?.id!==id) return;
    Object.assign(state,data,{ready:true,loading:false,loadError:''});render();
  } catch(error) {
    if(ticket!==requestId) return;
    state.loading=false;state.loadError=message(error);render();
  }
}
async function useSession(session) {
  if(session?.user.id===state.user?.id && !state.demo) return;
  smart.cleanup();
  requestId++;
  if(session?.user) {
    Object.assign(state,{demo:false,user:session.user,transactions:[],budgets:[],currency:'CAD',ready:false,loadError:'',offset:0});
    if(authMode!=='update')dialog.close();render();await refresh();
  } else {
    Object.assign(state,demoData(),{demo:true,user:null,ready:true,loading:false,loadError:'',offset:0});render();
  }
}
function authForm(mode='signin') {
  authMode=mode;
  const title=({signin:'Welcome back',signup:'Make room for better money habits',reset:'Reset your password',update:'Choose a new password'})[mode];
  const subtitle=({signin:'Sign in to your personal workspace.',signup:'Create your free personal workspace.',reset:'We’ll send a password reset link to your email.',update:'Use at least 8 characters.'})[mode];
  const configuredContent=`<form id="auth-form"><p class="dialog-intro">${subtitle}</p>${mode!=='update'?'<label class="field">Email<input name="email" type="email" required autocomplete="email" placeholder="you@example.com" /></label>':''}${mode!=='reset'?`<label class="field">Password<input name="password" type="password" ${mode==='signin'?'':'minlength="8"'} required autocomplete="${mode==='signin'?'current-password':'new-password'}" /></label>`:''}<p class="form-error" role="alert"></p><button type="submit" class="button primary full-width">${({signin:'Sign in',signup:'Create account',reset:'Send reset link',update:'Save new password'})[mode]}</button></form><div class="auth-links">${mode==='signin'?'<button data-action="auth-signup">Create an account</button><button data-action="auth-reset">Forgot password?</button>':mode==='update'?'':'<button data-action="login">Back to sign in</button>'}</div>`;
  open(modal(title,configured?configuredContent:`<div class="setup-note">${icon('cloud')}<h3>Connect your own workspace</h3><p>Login and cross-device sync are ready to connect. Follow the included <strong>README.md</strong> to create a Supabase project, run the database setup, and add your two Vercel environment variables.</p><p>You can explore every screen with sample data in the meantime.</p><button class="button primary" data-action="close">Explore the demo</button></div>`));
}
function budgetForm(copy=false) {
  const source=copy?shiftMonth(state.month,-1):state.month;
  const budgets=state.budgets.filter(b=>b.month===source);
  if(copy&&!budgets.length) {toast('There are no budgets in the previous month.');return;}
  open(modal(`Plan for ${monthLabel(state.month)}`,`<form id="budget-form"><p class="dialog-intro">${copy?'Copied from the previous month. Review before saving.':'Set category limits in '+state.currency+'. Leave blank or enter 0 to remove a limit.'}</p><div class="budget-inputs">${EXPENSES.map((c,i)=>`<label class="field">${escape(c)}<input name="budget-${i}" type="text" inputmode="decimal" placeholder="0.00" value="${budgets.find(b=>b.category===c)?(budgets.find(b=>b.category===c).amount/100).toFixed(2):''}" /></label>`).join('')}</div><p class="form-error" role="alert"></p><div class="dialog-actions"><button class="button secondary" type="button" data-action="close">Cancel</button><button class="button primary" type="submit">Save monthly budgets</button></div></form>`));
}
function download(content,filename,type) {
  const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function ensureReady() { if(!state.ready)throw new Error('Wait for your records to load before making changes.'); }
function entryDate() { return state.month===today().slice(0,7)?today():`${state.month}-01`; }
async function action(name,el) {
  if(busy) return;
  switch(name) {
    case 'close':close();break;
    case 'login':authForm();break;
    case 'auth-signup':authForm('signup');break;
    case 'auth-reset':authForm('reset');break;
    case 'add':ensureReady();state.entryDate=entryDate();open(transactionForm(state));break;
    case 'smart-receipt':ensureReady();smart.start('receipt');break;
    case 'smart-voice':ensureReady();smart.start('voice');break;
    case 'edit':ensureReady();{const row=state.transactions.find(t=>t.id===el.dataset.id);if(row)open(transactionForm(state,row));}break;
    case 'prev-month':case 'next-month':{
      const next=shiftMonth(state.month,name==='prev-month'?-1:1);
      if(next<'1900-01'||next>'2200-12')return;
      state.month=next;state.offset=0;render();break;
    }
    case 'page-prev':state.offset=Math.max(0,state.offset-25);render();break;
    case 'page-next':state.offset+=25;render();break;
    case 'refresh':await refresh();break;
    case 'budget-edit':ensureReady();budgetForm();break;
    case 'budget-copy':ensureReady();budgetForm(true);break;
    case 'csv':case 'csv-all':ensureReady();download(toCSV(name==='csv'?filteredTransactions(state):state.transactions,state.currency),`pocketwise-${name==='csv'?state.month:'all'}-${today()}.csv`,'text/csv;charset=utf-8');break;
    case 'backup':ensureReady();{
      const backup=validateBackup({version:1,currency:state.currency,transactions:state.transactions,budgets:state.budgets});
      download(JSON.stringify({...backup,exportedAt:new Date().toISOString()},null,2),`pocketwise-backup-${today()}.json`,'application/json');break;
    }
    case 'delete':{
      const id=el.dataset.id;
      open(modal('Delete this transaction?',`<p class="dialog-intro">This removes the transaction from your workspace and updates your totals.</p><p class="form-error" role="alert"></p><div class="dialog-actions"><button class="button secondary" data-action="close">Keep transaction</button><button class="button danger" data-action="confirm-delete" data-id="${escape(id)}">Delete transaction</button></div>`));break;
    }
    case 'confirm-delete':await run(async()=>{
      ensureReady();const id=el.dataset.id;
      if(state.demo)state.transactions=state.transactions.filter(t=>t.id!==id);
      else {const uid=state.user.id;await deleteTransaction(uid,id);if(state.user?.id!==uid)return;state.transactions=state.transactions.filter(t=>t.id!==id);}
      dialog.close();render();
    },'Transaction deleted.');break;
    case 'confirm-restore':await run(async()=>{
      ensureReady();const backup=pendingBackup;if(!backup)throw new Error('Choose a backup file first.');
      if(state.demo)Object.assign(state,{currency:backup.currency,transactions:backup.transactions.map(t=>({...t,id:crypto.randomUUID()})),budgets:backup.budgets});
      else {
        const uid=state.user.id;
        await restoreBackup(backup);
        if(state.user?.id!==uid)return;
        Object.assign(state,{transactions:[],budgets:[],currency:backup.currency,ready:false});
        await refresh();
      }
      pendingBackup=null;dialog.close();render();
    },'Backup restored.');break;
    case 'logout':await run(async()=>{const {error}=await client.auth.signOut({scope:'local'});if(error)throw error;await useSession(null);},'Signed out on this device.');break;
  }
}
document.addEventListener('click',event=>{const el=event.target.closest('[data-action]');if(el)action(el.dataset.action,el).catch(e=>toast(message(e),true));});
dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
window.addEventListener('hashchange',()=>{if(!location.hash.includes('access_token')&&!location.hash.includes('error')){state.page=currentPage();state.offset=0;render();}});
document.addEventListener('input',e=>{
  if(e.target.id==='search') {state.search=e.target.value;state.offset=0;document.querySelector('#transaction-results').innerHTML=transactionResults(state);}
});
document.addEventListener('change',async e=>{
  try {
    if(e.target.id==='month-picker'&&/^\d{4}-\d{2}$/.test(e.target.value)) {const m=e.target.value;if(m<'1900-01'||m>'2200-12')return;state.month=m;state.offset=0;render();}
    if(e.target.id==='type-filter'||e.target.id==='category-filter') {state[e.target.id==='type-filter'?'filter':'category']=e.target.value;state.offset=0;render();}
    if(e.target.name==='type') {dialog.querySelector('[name="category"]').innerHTML=(e.target.value==='expense'?EXPENSES:INCOME).map(c=>`<option>${escape(c)}</option>`).join('');}
    if(e.target.id==='currency') {
      const currency=e.target.value;
      await run(async()=>{ensureReady();if(!CURRENCIES.includes(currency))return;if(!state.demo)await saveCurrency(state.user.id,currency);state.currency=currency;render();},'Display currency updated. Amounts were not converted.');render();
    }
    if(e.target.id==='restore-file') {
      ensureReady();const file=e.target.files[0];e.target.value='';if(!file)return;
      if(file.size>MAX_BACKUP_BYTES)throw new Error('Choose a backup smaller than 64 MB.');
      let parsed;try{parsed=JSON.parse(await file.text());}catch{throw new Error('This file is not valid JSON. Choose a Pocketwise backup.');}
      pendingBackup=validateBackup(parsed);
      open(modal('Restore this backup?',`<p class="dialog-intro"><strong>${escape(file.name)}</strong></p><p>This backup contains ${pendingBackup.transactions.length} transactions and ${pendingBackup.budgets.length} category budgets in ${pendingBackup.currency}.</p><div class="warning-box">This will replace all transactions and budgets in ${state.demo?'this demo':`your account (${escape(state.user.email)})`}. Download a backup of your current records first if you want to keep them.</div><p class="form-error" role="alert"></p><div class="dialog-actions"><button class="button secondary" data-action="close">Cancel</button><button class="button danger" data-action="confirm-restore">Replace my records</button></div>`));
    }
  } catch(error){toast(message(error),true);}
});
document.addEventListener('submit',e=>{
  // Named form controls can shadow properties: the hidden name="id" input
  // replaces form.id in Chromium. Read the actual attribute for routing.
  const formId=e.target.getAttribute('id');
  if(!['auth-form','transaction-form','budget-form'].includes(formId))return;
  e.preventDefault();const form=e.target,fields=new FormData(form);
  if(formId==='auth-form')run(async()=>{
    const email=String(fields.get('email')||'').trim(),password=String(fields.get('password')||'');
    let result;
    if(authMode==='signin') {result=await client.auth.signInWithPassword({email,password});if(result.error)throw result.error;await useSession(result.data.session);dialog.close();}
    else if(authMode==='signup') {result=await client.auth.signUp({email,password,options:{emailRedirectTo:location.origin}});if(result.error)throw result.error;if(result.data.session){await useSession(result.data.session);dialog.close();}else{dialog.close();toast('Check your email to confirm your account, then sign in.');}}
    else if(authMode==='reset') {result=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin});if(result.error)throw result.error;dialog.close();toast('If an account exists, a password reset link will arrive by email.');}
    else {result=await client.auth.updateUser({password});if(result.error)throw result.error;authMode='signin';dialog.close();toast('Password updated.');}
  });
  if(formId==='transaction-form')run(async()=>{
    ensureReady();const id=fields.get('id'),r=validateTransaction({date:fields.get('date'),type:fields.get('type'),amount:cents(fields.get('amount')),category:fields.get('category'),account:fields.get('account'),note:String(fields.get('note')||'')});
    let saved;
    if(state.demo)saved={...r,id:id||crypto.randomUUID()};
    else {const uid=state.user.id;saved=await saveTransaction(uid,r,id||undefined);if(state.user?.id!==uid)return;}
    state.transactions=id?state.transactions.map(t=>t.id===id?saved:t):[...state.transactions,saved];
    state.month=r.date.slice(0,7);state.offset=0;
    if(!id){
      Object.assign(state,{page:'transactions',search:'',filter:'all',category:'all'});
      const index=filteredTransactions(state).findIndex(t=>t.id===saved.id);
      state.offset=Math.floor(Math.max(0,index)/25)*25;
      // Update the URL without a hashchange that would reset the selected page.
      if(location.hash!=='#transactions')history.pushState(null,'','#transactions');
    }
    dialog.close();render();
  },`Transaction saved for ${fields.get('date')}.`);
  if(formId==='budget-form')run(async()=>{
    ensureReady();const budgets=EXPENSES.flatMap((category,i)=>{const raw=String(fields.get(`budget-${i}`)||'').trim();return raw===''||/^0+(\.0{1,2})?$/.test(raw)?[]:[{month:state.month,category,amount:cents(raw)}];});
    if(!state.demo)await saveBudgets(state.user.id,state.month,budgets);
    state.budgets=[...state.budgets.filter(b=>b.month!==state.month),...budgets];dialog.close();render();
  },'Monthly budgets saved.');
});
function autoRefresh() { if(!busy&&!dialog.open&&!document.hidden&&!['INPUT','SELECT'].includes(document.activeElement?.tagName))refresh({silent:true}); }
window.addEventListener('focus',autoRefresh);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)autoRefresh();});
setInterval(autoRefresh,30000);
render();
if(client) {
  client.auth.onAuthStateChange((event,session)=>{setTimeout(()=>{if(event==='PASSWORD_RECOVERY')authMode='update';useSession(session).then(()=>{if(event==='PASSWORD_RECOVERY')authForm('update');}).catch(e=>toast(message(e),true));},0);});
  client.auth.getSession().then(({data,error})=>{if(error)throw error;return useSession(data.session);}).catch(e=>toast(message(e),true));
}
