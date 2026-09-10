import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
import { JSDOM } from 'jsdom';

// Exercise the actual bundled app in a DOM; these are interaction tests,
// not a substitute for visual checks or live Supabase authentication testing.
const output=await build({configFile:false,logLevel:'silent',define:{'import.meta.env.VITE_SUPABASE_URL':'""','import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':'""'},build:{write:false,minify:false}});
const bundle=output.output.find(o=>o.type==='chunk'&&o.isEntry).code;
async function setup() {
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div><dialog id="dialog"></dialog>',{url:'https://pocketwise.test',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  // The production bundle is an ES module. An IIFE preserves module scope
  // here so its local close() helper does not replace the DOM's window.close.
  w.eval(`(()=>{${bundle}\n})()`);
  const click=selector=>{const node=w.document.querySelector(selector);assert.ok(node,`Expected ${selector}`);node.click();};
  const fill=(name,value)=>{w.document.querySelector(`[name="${name}"]`).value=value;};
  const submit=()=>w.document.querySelector('dialog form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  const settle=()=>new Promise(r=>setTimeout(r,5));
  const navigate=async page=>{w.location.hash=page;await settle();};
  return {dom,w,click,fill,submit,settle,navigate};
}
test('demo transaction can be created, edited, found and deleted without HTML injection',async()=>{
  const x=await setup();try {
    x.click('[data-action="add"]');x.fill('amount','10.29');x.fill('note','<img src=x onerror=alert(1)> Test lunch');x.submit();await x.settle();
    assert.equal(x.w.document.querySelector('dialog').open,false);
    assert.ok(x.w.document.body.textContent.includes('Test lunch'));
    assert.equal(x.w.document.querySelector('img'),null);
    await x.navigate('transactions');
    const search=x.w.document.querySelector('#search');search.value='Test lunch';search.dispatchEvent(new x.w.Event('input',{bubbles:true}));
    assert.equal(x.w.document.querySelectorAll('tbody tr').length,1);
    assert.ok(x.w.document.querySelector('tbody').textContent.includes('10.29'));
    x.click('[data-action="edit"]');x.fill('amount','12.75');x.submit();await x.settle();
    assert.ok(x.w.document.querySelector('tbody').textContent.includes('12.75'));
    x.click('[data-action="edit"]');x.click('[data-action="delete"]');x.click('[data-action="confirm-delete"]');await x.settle();
    assert.equal(x.w.document.querySelectorAll('tbody tr').length,0);
  }finally{x.dom.window.close();}
});
test('invalid transaction leaves the form open and does not report success',async()=>{
  const x=await setup();try{
    x.click('[data-action="add"]');x.fill('amount','-2');x.submit();await x.settle();
    assert.equal(x.w.document.querySelector('dialog').open,true);
    assert.match(x.w.document.querySelector('.form-error').textContent,/positive amount/);
  }finally{x.dom.window.close();}
});
test('monthly budgets update and navigation renders every main view',async()=>{
  const x=await setup();try{
    await x.navigate('budgets');x.click('[data-action="budget-edit"]');x.fill('budget-0','99.99');x.submit();await x.settle();
    assert.ok(x.w.document.querySelector('#page-content').textContent.includes('99.99'));
    for(const page of ['reports','settings','overview','transactions']){await x.navigate(page);assert.ok(x.w.document.querySelector('h1').textContent.length>0);}
    x.click('[data-action="login"]');assert.match(x.w.document.querySelector('dialog').textContent,/Connect your own workspace/);
  }finally{x.dom.window.close();}
});
test('smart entry produces an editable unsaved draft and back preserves typed manual fields',async()=>{
  const x=await setup();try{
    x.click('[data-action="add"]');x.fill('amount','45.67');x.fill('note','Keep my typed note');
    x.click('[data-action="smart-receipt"]');x.click('[data-smart-action="back"]');
    assert.equal(x.w.document.querySelector('[name="amount"]').value,'45.67');
    assert.equal(x.w.document.querySelector('[name="note"]').value,'Keep my typed note');
    x.click('[data-action="smart-voice"]');x.click('[data-smart-action="sample"]');
    assert.equal(x.w.document.querySelector('#dialog-title').textContent,'Review suggested transaction');
    assert.equal(x.w.document.querySelector('[name="amount"]').value,'12.50');
    assert.equal(x.w.document.querySelector('[name="id"]').value,'');
    assert.equal(x.w.document.querySelector('[data-action="delete"]'),null);
    assert.ok(!x.w.document.querySelector('#page-content').textContent.includes('Sample lunch'));
    x.fill('note','Reviewed smart lunch');x.submit();await x.settle();
    assert.ok(x.w.document.querySelector('#page-content').textContent.includes('Reviewed smart lunch'));
  }finally{x.dom.window.close();}
});
