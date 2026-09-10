export const CURRENCIES = ['CAD', 'USD', 'PHP', 'EUR', 'GBP', 'AUD', 'INR'];
export const ACCOUNTS = ['Bank', 'Cash', 'Credit card'];
export const EXPENSES = ['Food & drinks', 'Groceries', 'Transport', 'Shopping', 'Housing', 'Bills & utilities', 'Health', 'Entertainment', 'Travel', 'Education', 'Other'];
export const INCOME = ['Salary', 'Freelance', 'Gifts', 'Investment', 'Other'];
export const COLORS = ['#4465ed', '#0f9a87', '#e59b31', '#9b61d0', '#e56b7c', '#418fac', '#7778b8', '#a18958', '#3eab72', '#ab6396', '#8090a5'];
export const MAX_AMOUNT = 100000000000;
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
export function cents(value) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Enter a positive amount with up to two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) throw new Error('Amount must be between 0.01 and 1,000,000,000.00.');
  return amount;
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '2200-12-31') return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === value;
}
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function shiftMonth(month, delta) {
  const [year, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, m - 1 + delta, 1));
  return d.toISOString().slice(0,7);
}
export function monthLabel(month, short = false) {
  return new Intl.DateTimeFormat('en-CA', {month:short ? 'short' : 'long', year:'numeric', timeZone:'UTC'}).format(new Date(`${month}-01T12:00:00Z`));
}
export function money(amount, currency = 'CAD') {
  return new Intl.NumberFormat('en-CA', {style:'currency', currency, currencyDisplay:'narrowSymbol'}).format(amount / 100);
}
export function summary(rows, month) {
  let income = 0, expenses = 0;
  for (const r of rows) if (!month || r.date.startsWith(month)) {
    if (r.type === 'income') income += r.amount; else expenses += r.amount;
  }
  return { income, expenses, net:income - expenses };
}
export function categoryTotals(rows, month) {
  const result = {};
  for (const r of rows) if (r.type === 'expense' && r.date.startsWith(month)) result[r.category] = (result[r.category] || 0) + r.amount;
  return result;
}
export function validateTransaction(r) {
  if (!r || !validDate(r.date) || !['expense','income'].includes(r.type) || !Number.isSafeInteger(r.amount) || r.amount <= 0 || r.amount > MAX_AMOUNT || !(r.type === 'expense' ? EXPENSES : INCOME).includes(r.category) || !ACCOUNTS.includes(r.account) || typeof r.note !== 'string' || r.note.length > 240) throw new Error('A transaction has an invalid date, amount, category, account, or note.');
  return {date:r.date, type:r.type, amount:r.amount, category:r.category, account:r.account, note:r.note.trim()};
}
export function validateBackup(raw) {
  if (!raw || raw.version !== 1 || !CURRENCIES.includes(raw.currency) || !Array.isArray(raw.transactions) || !Array.isArray(raw.budgets) || raw.transactions.length > 20000 || raw.budgets.length > 3000) throw new Error('Use a Pocketwise version 1 backup (up to 20,000 transactions and 3,000 budgets).');
  const transactions = raw.transactions.map(validateTransaction);
  const keys = new Set();
  const budgets = raw.budgets.map(b => {
    if (!b || !validDate(`${b.month}-01`) || !EXPENSES.includes(b.category) || !Number.isSafeInteger(b.amount) || b.amount <= 0 || b.amount > MAX_AMOUNT) throw new Error('A budget in this backup is invalid.');
    const key = `${b.month}:${b.category}`;
    if (keys.has(key)) throw new Error('This backup contains duplicate category budgets.');
    keys.add(key);
    return {month:b.month, category:b.category, amount:b.amount};
  });
  return {version:1, currency:raw.currency, transactions, budgets};
}
export function toCSV(rows, currency) {
  const safe = value => {
    let text = String(value);
    if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"','""')}"`;
  };
  return '\uFEFF' + [['Date','Type','Category','Account','Amount','Currency','Note'], ...rows.map(r => [r.date,r.type,r.category,r.account,(r.amount/100).toFixed(2),currency,r.note])].map(row => row.map(safe).join(',')).join('\r\n');
}
export function demoData() {
  const month = today().slice(0,7);
  const records = [
    ['01','income',485000,'Salary','Bank','Monthly salary'],
    ['01','expense',145000,'Housing','Bank','Rent'],
    ['03','expense',8650,'Groceries','Credit card','Weekly groceries'],
    ['04','expense',2499,'Entertainment','Credit card','Streaming subscriptions'],
    ['05','expense',1850,'Food & drinks','Cash','Lunch with a friend'],
    ['06','expense',6800,'Bills & utilities','Bank','Internet'],
    ['07','expense',4250,'Transport','Credit card','Transit pass top-up'],
    ['08','expense',6275,'Shopping','Credit card','A little home refresh'],
    ['09','income',35000,'Freelance','Bank','Design project'],
    ['10','expense',575,'Food & drinks','Cash','Morning coffee']
  ];
  const transactions = records.map(([day,type,amount,category,account,note]) => ({id:crypto.randomUUID(), date:`${month}-${day}`,type,amount,category,account,note}));
  for (let i=1;i<=5;i++) {
    const date = `${shiftMonth(month,-i)}-15`;
    transactions.push({id:crypto.randomUUID(),date,type:'income',amount:460000+i*5700,category:'Salary',account:'Bank',note:'Monthly salary'});
    transactions.push({id:crypto.randomUUID(),date,type:'expense',amount:210000+i*14300,category:'Housing',account:'Bank',note:'Example monthly expenses'});
  }
  return {currency:'CAD',transactions,budgets:EXPENSES.slice(0,6).map((category,i)=>({month,category,amount:[30000,45000,15000,20000,150000,22000][i]}))};
}
