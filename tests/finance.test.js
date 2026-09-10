import test from 'node:test';
import assert from 'node:assert/strict';
import { cents, validDate, summary, categoryTotals, validateBackup, toCSV, shiftMonth, MAX_BACKUP_BYTES } from '../src/finance.js';

test('money stays in exact cents and rejects ambiguous or unsafe amounts', () => {
  assert.equal(cents('10.29'), 1029);
  assert.equal(cents('0.01'), 1);
  for (const amount of ['-1', '1.001', '1e3', 'NaN', '', '0', '1000000001']) assert.throws(() => cents(amount));
});
test('dates reject calendar rollovers and preserve leap days', () => {
  assert.equal(validDate('2024-02-29'), true);
  for (const date of ['2025-02-29', '2026-04-31', 'x', '2026-13-01']) assert.equal(validDate(date), false);
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});
const rows = [
  { date:'2026-09-01', type:'income', amount:100001, category:'Salary' },
  { date:'2026-09-02', type:'expense', amount:2999, category:'Food & drinks' },
  { date:'2026-09-04', type:'expense', amount:1, category:'Food & drinks' },
  { date:'2026-08-02', type:'expense', amount:500, category:'Transport' }
];
test('monthly income, spending and categories exclude other months', () => {
  assert.deepEqual(summary(rows, '2026-09'), { income:100001, expenses:3000, net:97001 });
  assert.equal(categoryTotals(rows, '2026-09')['Food & drinks'], 3000);
  assert.equal(categoryTotals(rows, '2026-09').Transport ?? 0, 0);
});
test('backup validates money, dates, categories and uniqueness before replacement', () => {
  const backup = { version:1, currency:'CAD', transactions:[{date:'2026-09-01', type:'expense', amount:1029, category:'Food & drinks', account:'Bank', note:'Lunch'}], budgets:[{month:'2026-09', category:'Food & drinks', amount:50000}] };
  assert.equal(validateBackup(backup).transactions[0].amount,1029);
  assert.throws(() => validateBackup({...backup,transactions:[{...backup.transactions[0],amount:1.5}]}));
  assert.throws(() => validateBackup({...backup,transactions:[{...backup.transactions[0],date:'2026-02-30'}]}));
  assert.throws(() => validateBackup({...backup,budgets:[...backup.budgets,...backup.budgets]}));
  assert.throws(() => validateBackup({...backup,currency:'BOGUS'}));
});
test('CSV quotes text and neutralizes spreadsheet formulas', () => {
  const csv = toCSV([{ date:'2026-09-01', type:'expense', amount:123, category:'Other', account:'Cash', note:'=HYPERLINK("bad")' }], 'CAD');
  assert.ok(csv.includes("\"'=HYPERLINK(\"\"bad\"\")\""));
  assert.ok(csv.includes('1.23'));
});
test('largest supported backup with heavily escaped notes fits the restore size limit',()=>{
  const backup=validateBackup({version:1,currency:'CAD',transactions:Array.from({length:20000},()=>({date:'2026-09-01',type:'expense',amount:100000000000,category:'Food & drinks',account:'Credit card',note:'\u0000'.repeat(240)})),budgets:[]});
  assert.ok(Buffer.byteLength(JSON.stringify(backup,null,2))<MAX_BACKUP_BYTES);
});
