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
  // Import.
  Import: 'นำเข้า',
  Type: 'ประเภท',
  Inflow: 'เงินเข้า',
  Outflow: 'เงินออก',
  Description: 'รายละเอียด',
  Currency: 'สกุลเงิน',
  Id: 'รหัส',
  TransferId: 'รหัสการโอน',
  Preview: 'ตัวอย่าง',
  Decimal: 'ทศนิยม',
  Auto: 'อัตโนมัติ',
  none: 'ไม่มี',
  'Bring in a CSV or Excel export from another money app.':
    'นำเข้าไฟล์ CSV หรือ Excel จากแอปการเงินอื่น',
  'Import a CSV or Excel export from another money app. Your file is read on this device only.':
    'นำเข้าไฟล์ CSV หรือ Excel จากแอปการเงินอื่น ไฟล์ของคุณถูกอ่านบนอุปกรณ์นี้เท่านั้น',
  'Choose a .csv or .xlsx file': 'เลือกไฟล์ .csv หรือ .xlsx',
  'Choose a different file': 'เลือกไฟล์อื่น',
  'Could not read any columns from this file.': 'ไม่พบคอลัมน์ในไฟล์นี้',
  'Could not read this file. Use a .csv or .xlsx export.':
    'อ่านไฟล์นี้ไม่ได้ กรุณาใช้ไฟล์ .csv หรือ .xlsx',
  'Detected format: {name}': 'รูปแบบที่ตรวจพบ: {name}',
  'No preset matched — check the column mapping below.':
    'ไม่พบรูปแบบสำเร็จรูป — โปรดตรวจสอบการจับคู่คอลัมน์ด้านล่าง',
  'Column mapping': 'การจับคู่คอลัมน์',
  'Date order': 'ลำดับวันที่',
  '{n} ready': 'พร้อม {n} รายการ',
  '{n} skipped': 'ข้าม {n} รายการ',
  'New accounts in this file': 'บัญชีใหม่ในไฟล์นี้',
  'Create new': 'สร้างใหม่',
  'Map to {name}': 'จับคู่กับ {name}',
  'New categories to be created: {list}': 'หมวดหมู่ใหม่ที่จะสร้าง: {list}',
  '…and {n} more': '…และอีก {n} รายการ',
  'Import {n} transactions': 'นำเข้า {n} ธุรกรรม',
  'Importing…': 'กำลังนำเข้า…',
  'Imported {n} transactions.': 'นำเข้า {n} ธุรกรรมแล้ว',
  'New accounts added: {list}': 'เพิ่มบัญชีใหม่: {list}',
  'New categories added: {list}': 'เพิ่มหมวดหมู่ใหม่: {list}',
  'View transactions': 'ดูธุรกรรม',
  'Import another file': 'นำเข้าไฟล์อื่น',
  'Loading…': 'กำลังโหลด…',
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
