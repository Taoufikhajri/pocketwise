import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSmartRequest, normalizeDraft } from '../server/smart-core.js';

const context={currency:'CAD',today:'2026-09-10'};
const extracted={amount:'12.34',date:'2026-09-09',type:'expense',category:'Food & drinks',account:'Cash',note:'Lunch',currency:'CAD',warnings:[]};
test('AI draft returns integer cents, strips unexpected properties and never provides a saved record ID',()=>{
  const result=normalizeDraft({...extracted,id:'injected-id',user_id:'someone'},context);
  assert.equal(result.transaction.amount,1234);
  assert.equal(result.transaction.id,undefined);
  assert.equal(result.transaction.user_id,undefined);
});
test('foreign currency clears amount instead of silently relabelling money',()=>{
  const result=normalizeDraft({...extracted,currency:'USD'},context);
  assert.equal(result.transaction.amount,null);
  assert.equal(result.sourceCurrency,'USD');
  assert.ok(result.warnings.some(w=>w.includes('CAD')));
});
test('missing or uncertain AI fields remain visible for manual correction',()=>{
  const result=normalizeDraft({...extracted,amount:null,date:'2026-02-30',account:null,currency:null,category:'Made up'},context);
  assert.equal(result.transaction.amount,null);
  assert.equal(result.transaction.date,'');
  assert.equal(result.transaction.account,'');
  assert.ok(result.warnings.length>=3);
});
test('input validates content, context, file types and request size before API calls',()=>{
  assert.equal(validateSmartRequest({...context,kind:'text',text:'Spent 12.34 on lunch'}).kind,'text');
  for(const bad of [
    {...context,kind:'receipt',mime:'image/svg+xml',data:'PHN2Zy8+'},
    {...context,kind:'voice',mime:'audio/webm',data:'not base64'},
    {...context,kind:'receipt',mime:'image/jpeg',data:'a'.repeat(3000000)},
    {...context,kind:'text',text:''},
    {...context,today:'2026-02-31',kind:'text',text:'Lunch'}
  ])assert.throws(()=>validateSmartRequest(bad));
});
test('maximum permitted receipt validates without overflowing parser limits',()=>{
  const bytes=Buffer.alloc(2*1024*1024);bytes[0]=255;bytes[1]=216;bytes[2]=255;
  assert.equal(validateSmartRequest({...context,kind:'receipt',mime:'image/jpeg',data:bytes.toString('base64')}).bytes.length,bytes.length);
});
