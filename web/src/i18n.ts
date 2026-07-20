// Minimal i18n mirroring the Dash app: English strings ARE the keys; Thai is a
// lookup table. The full translations_th.py dictionary gets ported into `TH`
// in a later phase — for now it carries the app-shell strings.
export type Lang = 'en' | 'th'

const TH: Record<string, string> = {
  'Where Did My Money Go': 'เงินหายไปไหน',
  Home: 'หน้าหลัก',
  Transactions: 'ธุรกรรม',
  Budget: 'งบประมาณ',
  Goals: 'เป้าหมาย',
  Settings: 'ตั้งค่า',
  Add: 'เพิ่ม',
  Amount: 'จำนวนเงิน',
  Category: 'หมวดหมู่',
  Subcategory: 'หมวดหมู่ย่อย',
  Account: 'บัญชี',
  Income: 'รายรับ',
  Expense: 'รายจ่าย',
  Transfer: 'โอนเงิน',
  Saving: 'เงินออม',
  Date: 'วันที่',
  Note: 'บันทึกย่อ',
  Save: 'บันทึก',
  Cancel: 'ยกเลิก',
  Delete: 'ลบ',
  From: 'จาก',
  To: 'ไปยัง',
  Net: 'คงเหลือสุทธิ',
  'Add transaction': 'เพิ่มธุรกรรม',
  'Edit transaction': 'แก้ไขธุรกรรม',
  'Delete this transaction?': 'ลบธุรกรรมนี้?',
  'No transactions yet': 'ยังไม่มีธุรกรรม',
  'Your data is stored on this device only.':
    'ข้อมูลของคุณถูกเก็บไว้ในอุปกรณ์นี้เท่านั้น',
  // Manage accounts & categories.
  Accounts: 'บัญชี',
  Categories: 'หมวดหมู่',
  Rename: 'เปลี่ยนชื่อ',
  'Manage accounts & categories': 'จัดการบัญชีและหมวดหมู่',
  'Add, rename, reorder, or remove accounts and categories.':
    'เพิ่ม เปลี่ยนชื่อ จัดลำดับ หรือลบบัญชีและหมวดหมู่',
  'New account': 'บัญชีใหม่',
  'New category': 'หมวดหมู่ใหม่',
  'New subcategory': 'หมวดหมู่ย่อยใหม่',
  'Move up': 'เลื่อนขึ้น',
  'Move down': 'เลื่อนลง',
  '{n} used': 'ใช้อยู่ {n} รายการ',
  'That name already exists.': 'มีชื่อนี้อยู่แล้ว',
  'Delete "{name}"?': 'ลบ "{name}"?',
  'In use by {n} transaction(s) — reassign those first.':
    'ถูกใช้โดย {n} ธุรกรรม — โปรดย้ายธุรกรรมเหล่านั้นก่อน',
}

export function getLang(): Lang {
  return (localStorage.getItem('pref-lang') as Lang) === 'th' ? 'th' : 'en'
}

export function setLang(lang: Lang) {
  localStorage.setItem('pref-lang', lang)
  document.documentElement.setAttribute('data-lang', lang)
}

// Translate. In English, the key is returned as-is. `{name}` placeholders are
// filled from `vars`.
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = getLang() === 'th' ? TH[key] ?? key : key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return s
}
