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
  Apps: 'แอป',
  'More coming soon.': 'มีเพิ่มเติมเร็ว ๆ นี้',
  'Where your money goes vs. plan.': 'เงินของคุณไปไหนเทียบกับแผน',
  'Savings goals and progress.': 'เป้าหมายการออมและความคืบหน้า',
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
  'Net worth': 'มูลค่าสุทธิ',
  'Net worth · last 6 months': 'มูลค่าสุทธิ · 6 เดือนล่าสุด',
  'Net worth trend': 'แนวโน้มมูลค่าสุทธิ',
  'Income & Expense': 'รายรับและรายจ่าย',
  'Category breakdown by month.': 'แยกตามหมวดหมู่รายเดือน',
  Pie: 'วงกลม',
  Bars: 'แท่ง',
  Other: 'อื่นๆ',
  'No data': 'ไม่มีข้อมูล',
  'No transactions this month': 'ไม่มีธุรกรรมในเดือนนี้',
  // Money Flow.
  'Money Flow': 'กระแสเงิน',
  'Running balance and forecast.': 'ยอดคงเหลือสะสมและการคาดการณ์',
  'Running balance across your accounts, with a forward forecast.':
    'ยอดคงเหลือสะสมข้ามบัญชีของคุณ พร้อมการคาดการณ์ล่วงหน้า',
  Forecast: 'คาดการณ์',
  'Latest balances': 'ยอดคงเหลือล่าสุด',
  'Balance after': 'ยอดคงเหลือหลังรายการ',
  'Hidden cost (untracked)': 'ต้นทุนแฝง (ไม่ได้บันทึก)',
  'Add a few more weeks of history to see a forecast.':
    'เพิ่มข้อมูลย้อนหลังอีกสองสามสัปดาห์เพื่อดูการคาดการณ์',
  '30 d': '30 วัน',
  '90 d': '90 วัน',
  '180 d': '180 วัน',
  '1 y': '1 ปี',
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
  // Export & backup.
  'Export & backup': 'ส่งออกและสำรองข้อมูล',
  Export: 'ส่งออก',
  'Export a spreadsheet, or back up and restore all your data.':
    'ส่งออกสเปรดชีต หรือสำรองและกู้คืนข้อมูลทั้งหมดของคุณ',
  '{n} transactions on this device.': 'มี {n} ธุรกรรมในอุปกรณ์นี้',
  'A spreadsheet copy you can open elsewhere. It re-imports into this app too.':
    'สำเนาสเปรดชีตที่เปิดในแอปอื่นได้ และนำกลับเข้าแอปนี้ได้เช่นกัน',
  'Export CSV': 'ส่งออก CSV',
  'Export Excel': 'ส่งออก Excel',
  'Preparing…': 'กำลังเตรียม…',
  'Backup & restore': 'สำรองและกู้คืน',
  'A full backup (transactions, accounts, categories, settings) as one file. Keep it somewhere safe — it is the only copy of your data.':
    'สำรองข้อมูลทั้งหมด (ธุรกรรม บัญชี หมวดหมู่ การตั้งค่า) เป็นไฟล์เดียว เก็บไว้ให้ปลอดภัย — เป็นสำเนาเดียวของข้อมูลคุณ',
  'Download backup': 'ดาวน์โหลดไฟล์สำรอง',
  'Restore from backup…': 'กู้คืนจากไฟล์สำรอง…',
  'Restore replaces ALL data on this device with the backup. Continue?':
    'การกู้คืนจะแทนที่ข้อมูลทั้งหมดในอุปกรณ์นี้ด้วยไฟล์สำรอง ดำเนินการต่อหรือไม่?',
  'Restored {n} transactions.': 'กู้คืน {n} ธุรกรรมแล้ว',
  'That file is not valid JSON.': 'ไฟล์นี้ไม่ใช่ JSON ที่ถูกต้อง',
  "This doesn't look like a Money Tracker backup file.":
    'ไฟล์นี้ดูเหมือนจะไม่ใช่ไฟล์สำรองของ Money Tracker',
  // General settings.
  General: 'ทั่วไป',
  'App name': 'ชื่อแอป',
  'Base currency': 'สกุลเงินหลัก',
  'Month start day': 'วันเริ่มต้นเดือน',
  'Shown in the header and on the home screen icon label.':
    'แสดงในส่วนหัวและป้ายไอคอนบนหน้าจอหลัก',
  'Stamped on new transactions and shown across the app.':
    'ประทับบนธุรกรรมใหม่และแสดงทั่วทั้งแอป',
  'The day each budgeting month begins (1–28). Used by Budget.':
    'วันที่แต่ละเดือนงบประมาณเริ่มต้น (1–28) ใช้โดยงบประมาณ',
  'Changes are saved automatically.': 'บันทึกการเปลี่ยนแปลงโดยอัตโนมัติ',
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
