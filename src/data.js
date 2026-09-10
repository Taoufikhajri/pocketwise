import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(url?.startsWith('https://') && key && !url.includes('YOUR-') && !key.includes('YOUR-'));
export const client = configured ? createClient(url, key) : null;

function checked(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
async function allRows(table, userId) {
  const rows = [];
  let cursor;
  for (;;) {
    let query = client.from(table).select('*').eq('user_id',userId).order('id').limit(1000);
    if (cursor) query = query.gt('id',cursor);
    const page = checked(await query);
    rows.push(...page);
    if (page.length < 1000) return rows;
    cursor = page.at(-1).id;
  }
}
export async function loadData(userId) {
  const [transactions, budgets, profile] = await Promise.all([
    allRows('transactions',userId), allRows('budgets',userId),
    client.from('profiles').select('currency').eq('user_id',userId).maybeSingle().then(checked)
  ]);
  return {transactions,budgets,currency:profile?.currency || 'CAD'};
}
export async function saveTransaction(userId, transaction, id) {
  const row = {...transaction,user_id:userId};
  return checked(await (id ? client.from('transactions').update(row).eq('id',id).eq('user_id',userId) : client.from('transactions').insert(row)).select().single());
}
export async function deleteTransaction(userId,id) {
  return checked(await client.from('transactions').delete().eq('id',id).eq('user_id',userId).select('id').single());
}
export async function saveBudgets(userId, month, budgets) {
  checked(await client.rpc('set_month_budgets', {target_month:month, entries:budgets}));
}
export async function saveCurrency(userId,currency) {
  checked(await client.from('profiles').upsert({user_id:userId,currency}).select().single());
}
export async function restoreBackup(backup) {
  checked(await client.rpc('restore_backup', {backup}));
}
