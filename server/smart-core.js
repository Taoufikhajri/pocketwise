import { ACCOUNTS, CURRENCIES, EXPENSES, INCOME, cents, validDate } from '../src/finance.js';

export const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
export class SmartError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = message => { throw new SmartError(400, message); };
export function validateSmartRequest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('Invalid smart-entry request.');
  if (!CURRENCIES.includes(raw.currency) || !validDate(raw.today)) bad('Choose a valid currency and date.');
  const base = { kind:raw.kind, currency:raw.currency, today:raw.today };
  if (raw.kind === 'text') {
    if (typeof raw.text !== 'string' || !raw.text.trim() || raw.text.length > 3000) bad('Describe one transaction in 3,000 characters or fewer.');
    return {...base, text:raw.text.trim()};
  }
  const types = raw.kind === 'receipt' ? ['image/jpeg','image/png','image/webp'] : raw.kind === 'voice' ? ['audio/webm','audio/mp4','audio/mpeg','audio/wav','audio/x-wav'] : [];
  if (!types.includes(raw.mime)) bad('Use a JPG, PNG or WebP receipt, or a WebM, MP4, MP3 or WAV voice note.');
  if (typeof raw.data !== 'string' || raw.data.length > Math.ceil(MAX_MEDIA_BYTES / 3) * 4) throw new SmartError(413,'The upload must be 2 MB or smaller.');
  if (!raw.data || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw.data)) bad('The uploaded file is not valid.');
  const bytes = Buffer.from(raw.data,'base64');
  if (!bytes.length || bytes.length > MAX_MEDIA_BYTES || bytes.toString('base64') !== raw.data) bad('The uploaded file is not valid.');
  const hex = bytes.subarray(0,12).toString('hex');
  const ascii = bytes.subarray(0,12).toString('ascii');
  const matches = {
    'image/jpeg':hex.startsWith('ffd8ff'), 'image/png':hex.startsWith('89504e470d0a1a0a'),
    'image/webp':ascii.startsWith('RIFF') && ascii.slice(8,12)==='WEBP',
    'audio/webm':hex.startsWith('1a45dfa3'), 'audio/mp4':ascii.slice(4,8)==='ftyp',
    'audio/mpeg':ascii.startsWith('ID3') || (bytes[0]===255 && (bytes[1]&224)===224),
    'audio/wav':ascii.startsWith('RIFF') && ascii.slice(8,12)==='WAVE',
    'audio/x-wav':ascii.startsWith('RIFF') && ascii.slice(8,12)==='WAVE'
  };
  if (!matches[raw.mime]) bad('The file content does not match its format. Try another file.');
  return {...base, mime:raw.mime, data:raw.data, bytes};
}

// Model content is untrusted. Return only editable transaction fields; never IDs,
// user IDs, SQL, URLs to fetch, or automatic write instructions.
export function normalizeDraft(raw, context) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SmartError(422,'No usable transaction was found. Try a clearer photo or description.');
  const warnings = Array.isArray(raw.warnings) ? raw.warnings.filter(w=>typeof w==='string').slice(0,5).map(w=>w.slice(0,220)) : [];
  let amount = null;
  try { if (raw.amount !== null && raw.amount !== undefined) amount = cents(raw.amount); } catch { /* Ask for a corrected amount below. */ }
  const sourceCurrency = typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : null;
  if (sourceCurrency && sourceCurrency !== context.currency) {
    amount = null;
    warnings.push(`The source uses ${sourceCurrency}. Enter the amount in ${context.currency}; no currency conversion has been applied.`);
  } else if (!sourceCurrency) warnings.push(`The source currency was not clear. Confirm that the amount is in ${context.currency}.`);
  if (amount === null && (!sourceCurrency || sourceCurrency===context.currency)) warnings.push('The total was not clear. Enter the correct amount.');
  const type = ['expense','income'].includes(raw.type) ? raw.type : 'expense';
  if (!['expense','income'].includes(raw.type)) warnings.push('Confirm whether this is an expense or income.');
  const date = validDate(raw.date) ? raw.date : '';
  if (!date) warnings.push('The date was not clear. Choose the transaction date.');
  const category = (type==='expense'?EXPENSES:INCOME).includes(raw.category) ? raw.category : 'Other';
  if (category !== raw.category) warnings.push('Choose the category that best fits.');
  const account = ACCOUNTS.includes(raw.account) ? raw.account : '';
  if (!account) warnings.push('Choose the account used for this transaction.');
  const note = typeof raw.note === 'string' ? raw.note.replaceAll('\u0000','').slice(0,240) : '';
  return {transaction:{amount,date,type,category,account,note},sourceCurrency,warnings};
}

export const draftSchema = {
  type:'object',additionalProperties:false,
  properties:{
    amount:{type:['string','null'],description:'Final total in decimal currency units, e.g. 12.34. Null if unclear.'},
    date:{type:['string','null'],description:'YYYY-MM-DD transaction date. Null if unknown.'},
    type:{type:['string','null'],enum:['expense','income',null]},
    category:{type:['string','null'],enum:[...new Set([...EXPENSES,...INCOME]),null]},
    account:{type:['string','null'],enum:[...ACCOUNTS,null]},
    note:{type:'string',description:'Short merchant or transaction description, at most 240 characters.'},
    currency:{type:['string','null'],description:'Explicit ISO 4217 currency code. Null if ambiguous.'},
    warnings:{type:'array',items:{type:'string'}}
  },
  required:['amount','date','type','category','account','note','currency','warnings']
};
