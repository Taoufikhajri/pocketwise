import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('database enforces account isolation, budget uniqueness and atomic restore',async()=>{
  const db=new PGlite();
  const alice='00000000-0000-4000-8000-000000000001',bob='00000000-0000-4000-8000-000000000002';
  try {
    await db.exec(`create schema auth; create role authenticated; create role anon;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth,public to authenticated,anon;
      grant execute on function auth.uid() to authenticated,anon;
      insert into auth.users values ('${alice}'),('${bob}');`);
    await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${alice}';`);
    const {rows}=await db.query(`insert into public.transactions(user_id,date,type,amount,category,account,note) values ($1,'2026-09-01','expense',1029,'Groceries','Bank','Alice lunch') returning id`,[alice]);
    const id=rows[0].id;
    await db.exec(`set request.jwt.claim.sub='${bob}';`);
    assert.equal((await db.query('select * from public.transactions')).rows.length,0);
    assert.equal((await db.query('update public.transactions set amount=1 where id=$1 returning id',[id])).rows.length,0);
    await assert.rejects(db.query(`insert into public.transactions(user_id,date,type,amount,category,account) values ($1,'2026-09-01','expense',5,'Groceries','Bank')`,[alice]),/row-level security/);
    await db.query(`insert into public.transactions(user_id,date,type,amount,category,account,note) values ($1,'2026-09-01','income',50000,'Salary','Bank','Bob income')`,[bob]);
    await db.exec(`set request.jwt.claim.sub='${alice}';`);
    await db.query('select public.set_month_budgets($1,$2::jsonb)',['2026-09',JSON.stringify([{category:'Groceries',amount:20000}])]);
    assert.equal((await db.query('select amount from public.budgets')).rows[0].amount,20000);
    await assert.rejects(db.query('select public.set_month_budgets($1,$2::jsonb)',['2026-09',JSON.stringify([{category:'Groceries',amount:100},{category:'Groceries',amount:200}])]),/duplicate key/);
    assert.equal((await db.query('select amount from public.budgets')).rows[0].amount,20000);
    const backup={version:1,currency:'CAD',transactions:[{date:'2026-09-02',type:'expense',amount:999,category:'Groceries',account:'Cash',note:'Restored'}],budgets:[]};
    await assert.rejects(db.query('select public.restore_backup($1::jsonb)',[JSON.stringify({...backup,transactions:[{...backup.transactions[0],amount:-1}]})]),/check constraint/);
    assert.equal((await db.query('select id from public.transactions')).rows[0].id,id,'failed restore must keep original records');
    await db.query('select public.restore_backup($1::jsonb)',[JSON.stringify(backup)]);
    assert.equal((await db.query('select note from public.transactions')).rows[0].note,'Restored');
    assert.equal((await db.query('select * from public.budgets')).rows.length,0);
    await db.exec(`set request.jwt.claim.sub='${bob}';`);
    assert.equal((await db.query('select note from public.transactions')).rows[0].note,'Bob income','restore must not affect another user');
    await db.exec('set role anon;');
    await assert.rejects(db.query('select * from public.transactions'),/permission denied/);
    await assert.rejects(db.query('select public.restore_backup($1::jsonb)',[JSON.stringify(backup)]),/permission denied/);
  } finally {await db.close();}
});
