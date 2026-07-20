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
  Income: 'รายรับ',
  Expense: 'รายจ่าย',
  'No transactions yet': 'ยังไม่มีธุรกรรม',
  'Your data is stored on this device only.':
    'ข้อมูลของคุณถูกเก็บไว้ในอุปกรณ์นี้เท่านั้น',
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
