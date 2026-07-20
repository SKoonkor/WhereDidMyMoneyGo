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
  None: 'ไม่มี',
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
  // Budget.
  'Plan your spending with the 50/30/20 rule.': 'วางแผนการใช้จ่ายด้วยกฎ 50/30/20',
  'This period': 'รอบนี้',
  '{start} – {end} · income {income} ({mode})': '{start} – {end} · รายรับ {income} ({mode})',
  fixed: 'คงที่',
  'rolling average': 'ค่าเฉลี่ยย้อนหลัง',
  Needs: 'จำเป็น',
  Wants: 'ต้องการ',
  Savings: 'เงินออม',
  of: 'จาก',
  left: 'เหลือ',
  over: 'เกิน',
  ahead: 'เกินเป้า',
  short: 'ต่ำกว่าเป้า',
  'Spending vs budget': 'การใช้จ่ายเทียบกับงบ',
  'of budget': 'ของงบ',
  'Remaining budget': 'งบคงเหลือ',
  'Hidden cost': 'ต้นทุนแฝง',
  'Over budget — not in the ring': 'เกินงบ — ไม่แสดงในวงแหวน',
  'Income & split': 'รายรับและสัดส่วน',
  'Fixed amount': 'จำนวนคงที่',
  'Rolling average': 'ค่าเฉลี่ยย้อนหลัง',
  'Monthly income': 'รายรับต่อเดือน',
  'Average of the last {n} completed months of income.': 'ค่าเฉลี่ยรายรับจาก {n} เดือนล่าสุดที่ครบเดือน',
  'Category buckets': 'กลุ่มหมวดหมู่',
  'Tap a category to move it between Needs and Wants. Savings is whatever income is left.':
    'แตะหมวดหมู่เพื่อย้ายระหว่างจำเป็นและต้องการ เงินออมคือรายรับที่เหลือ',
  'The budget month starts on day {d}. Change it in Settings.':
    'เดือนงบประมาณเริ่มวันที่ {d} เปลี่ยนได้ในการตั้งค่า',
  // Compound Interest calculator (P3.1).
  'Compound Interest': 'ดอกเบี้ยทบต้น',
  'See how deposits grow over time.': 'ดูว่าเงินฝากเติบโตอย่างไรเมื่อเวลาผ่านไป',
  'See how regular deposits grow over time. A learning tool — it does not use your tracked data.':
    'ดูว่าเงินฝากสม่ำเสมอเติบโตอย่างไรเมื่อเวลาผ่านไป เป็นเครื่องมือเพื่อการเรียนรู้ ไม่ได้ใช้ข้อมูลที่คุณบันทึกไว้',
  'Principal Amount': 'เงินต้น',
  'Monthly Deposit': 'เงินฝากรายเดือน',
  'Period (months)': 'ระยะเวลา (เดือน)',
  'Annual Interest Rate (%)': 'อัตราดอกเบี้ยต่อปี (%)',
  Compounding: 'การทบต้น',
  Monthly: 'รายเดือน',
  Quarterly: 'รายไตรมาส',
  '6 Months': '6 เดือน',
  Annually: 'รายปี',
  'Overlay my Financial Goals (buy each as it is reached)':
    'ซ้อนเป้าหมายการเงินของฉัน (ซื้อแต่ละอย่างเมื่อถึงเป้า)',
  'No goals yet — add some in ': 'ยังไม่มีเป้าหมาย เพิ่มได้ที่ ',
  'Total contributions': 'เงินสมทบรวม',
  'Maturity value': 'มูลค่าเมื่อครบกำหนด',
  'Interest earned': 'ดอกเบี้ยที่ได้รับ',
  'Effective APY': 'อัตราผลตอบแทนต่อปีที่แท้จริง',
  'Growth over time': 'การเติบโตเมื่อเวลาผ่านไป',
  'Totals are taken at the set period; drag the chart to scroll past it.':
    'ยอดรวมคำนวณ ณ ระยะเวลาที่กำหนด ลากกราฟเพื่อเลื่อนดูเลยจากนั้น',
  Months: 'เดือน',
  Month: 'เดือน',
  'Value ({currency})': 'มูลค่า ({currency})',
  '±20% rate ({lo}–{hi}%)': 'อัตรา ±20% ({lo}–{hi}%)',
  'Maturity ({pct}%)': 'ครบกำหนด ({pct}%)',
  Maturity: 'ครบกำหนด',
  'After buying (×factor)': 'หลังซื้อ (×ตัวคูณ)',
  'After buying (no factor)': 'หลังซื้อ (ไม่มีตัวคูณ)',
  Principal: 'เงินต้น',
  '{name} bought · month {month}': 'ซื้อ {name} · เดือนที่ {month}',

  // Retirement projection (P3.2).
  Calculator: 'เครื่องคำนวณ',
  Retirement: 'การเกษียณ',
  'Project a full retirement plan: save, retire, then draw down against inflating expenses.':
    'วางแผนเกษียณแบบเต็ม: ออมเงิน เกษียณ แล้วถอนใช้ท่ามกลางค่าใช้จ่ายที่เพิ่มขึ้นตามเงินเฟ้อ',
  'Current age': 'อายุปัจจุบัน',
  'Retirement age': 'อายุเกษียณ',
  'Life expectancy': 'อายุขัย',
  'Yearly raise (%)': 'ขึ้นเงินเดือนต่อปี (%)',
  'Inflation (%)': 'เงินเฟ้อ (%)',
  'Retirement bonus': 'โบนัสเกษียณ',
  'Monthly pension': 'บำนาญรายเดือน',
  'Monthly expense (today)': 'ค่าใช้จ่ายรายเดือน (ปัจจุบัน)',
  "Show today's money (inflation-adjusted)": 'แสดงมูลค่าปัจจุบัน (ปรับตามเงินเฟ้อ)',
  'Pot at retirement': 'เงินก้อน ณ วันเกษียณ',
  'Financial freedom': 'อิสรภาพทางการเงิน',
  'Not reached': 'ยังไม่ถึง',
  'Funds last': 'เงินอยู่ได้ถึง',
  'Beyond life expectancy': 'เกินอายุขัย',
  until: 'ถึง',
  'Ending (today’s money)': 'คงเหลือ (มูลค่าปัจจุบัน)',
  yo: 'ปี',
  Age: 'อายุ',
  'Future money': 'มูลค่าอนาคต',
  "Today's money": 'มูลค่าปัจจุบัน',
  'Without goals': 'ไม่รวมเป้าหมาย',
  'Balance (future money)': 'ยอดคงเหลือ (มูลค่าอนาคต)',
  "Balance (today's money)": 'ยอดคงเหลือ (มูลค่าปัจจุบัน)',
  'After buying (plain)': 'หลังซื้อ (ราคาปกติ)',
  "×factor (today's money)": '×ตัวคูณ (มูลค่าปัจจุบัน)',
  Retire: 'เกษียณ',
  'Funds depleted': 'เงินหมด',
  '{name} bought · age {age}': 'ซื้อ {name} · อายุ {age}',
  'Retirement projection': 'การคาดการณ์การเกษียณ',
  'Deposits stop at retirement; expenses (today’s money) then inflate and draw down the pot.':
    'หยุดฝากเงินเมื่อเกษียณ ค่าใช้จ่าย (มูลค่าปัจจุบัน) จะเพิ่มตามเงินเฟ้อและทยอยลดเงินก้อน',
  'Show market uncertainty (Monte Carlo)': 'แสดงความไม่แน่นอนของตลาด (มอนติคาร์โล)',
  'Return volatility (%)': 'ความผันผวนผลตอบแทน (%)',
  'Inflation volatility (%)': 'ความผันผวนเงินเฟ้อ (%)',
  'Raise volatility (%)': 'ความผันผวนการขึ้นเงินเดือน (%)',
  ' (median)': ' (ค่ากลาง)',
  'Success: {pct}%': 'โอกาสสำเร็จ: {pct}%',

  // Income Tax (P3.4).
  'Income Tax': 'ภาษีเงินได้',
  'Estimate your yearly income tax.': 'ประเมินภาษีเงินได้ประจำปีของคุณ',
  'Estimate your personal income tax for a year. Model: {country}.':
    'ประเมินภาษีเงินได้บุคคลธรรมดาสำหรับปีหนึ่ง แบบจำลอง: {country}',
  Thailand: 'ประเทศไทย',
  'Tax year': 'ปีภาษี',
  'Assessable income': 'เงินได้พึงประเมิน',
  'Gross income ({currency})': 'เงินได้รวม ({currency})',
  '↻ From ledger ({year}): {amount} {currency}': '↻ จากบัญชี ({year}): {amount} {currency}',
  'Count only these income categories (none = all):':
    'นับเฉพาะหมวดรายรับเหล่านี้ (ไม่เลือก = ทั้งหมด):',
  'Deductions & allowances': 'ค่าลดหย่อนและค่าใช้จ่าย',
  'Automatic expense deduction': 'หักค่าใช้จ่ายอัตโนมัติ',
  'Tax already paid': 'ภาษีที่ชำระแล้ว',
  'Withholding / prepayments from these expense categories:':
    'ภาษีหัก ณ ที่จ่าย / ชำระล่วงหน้าจากหมวดรายจ่ายเหล่านี้:',
  'No expense categories yet.': 'ยังไม่มีหมวดรายจ่าย',
  'Paid in {year}': 'ชำระในปี {year}',
  'Net taxable income': 'เงินได้สุทธิที่ต้องเสียภาษี',
  'Tax due': 'ภาษีที่ต้องชำระ',
  'Effective rate': 'อัตราภาษีที่แท้จริง',
  'Marginal rate': 'อัตราภาษีขั้นสูงสุด',
  'Refund: {amount} {currency}': 'เงินคืน: {amount} {currency}',
  'Still owed: {amount} {currency}': 'ค้างชำระ: {amount} {currency}',
  'By tax bracket': 'ตามขั้นภาษี',
  'Personal allowance': 'ค่าลดหย่อนส่วนตัว',
  'Spouse (no income)': 'คู่สมรส (ไม่มีเงินได้)',
  Children: 'บุตร',
  'Parental care': 'ค่าอุปการะบิดามารดา',
  'Life & health insurance': 'ประกันชีวิตและสุขภาพ',
  'Social security': 'ประกันสังคม',
  'Provident fund / GPF': 'กองทุนสำรองเลี้ยงชีพ / กบข.',
  SSF: 'SSF',
  RMF: 'RMF',
  'Mortgage interest': 'ดอกเบี้ยเงินกู้บ้าน',
  Donations: 'เงินบริจาค',
  children: 'คน',
  people: 'คน',
  'Automatic 60,000 for every taxpayer.': 'อัตโนมัติ 60,000 สำหรับผู้เสียภาษีทุกคน',
  '60,000 if your spouse has no assessable income.': '60,000 หากคู่สมรสไม่มีเงินได้พึงประเมิน',
  '30,000 per child.': '30,000 ต่อบุตรหนึ่งคน',
  '30,000 per dependent parent aged 60+, up to 4.':
    '30,000 ต่อบิดามารดาที่อยู่ในอุปการะอายุ 60 ปีขึ้นไป สูงสุด 4 คน',
  'Premiums, capped at 100,000.': 'เบี้ยประกัน สูงสุด 100,000',
  'Contributions, capped at 9,000.': 'เงินสมทบ สูงสุด 9,000',
  'Up to 15% of income and 500,000 (shared retirement cap).':
    'สูงสุด 15% ของเงินได้และ 500,000 (เพดานเกษียณรวม)',
  'Up to 30% of income and 200,000 (shared retirement cap).':
    'สูงสุด 30% ของเงินได้และ 200,000 (เพดานเกษียณรวม)',
  'Up to 30% of income and 500,000 (shared retirement cap).':
    'สูงสุด 30% ของเงินได้และ 500,000 (เพดานเกษียณรวม)',
  'Home-loan interest, capped at 100,000.': 'ดอกเบี้ยเงินกู้บ้าน สูงสุด 100,000',
  'Capped at 10% of income after other deductions.':
    'สูงสุด 10% ของเงินได้หลังหักค่าลดหย่อนอื่น',

  // Financial Goals + Savings Pool.
  'Financial Goals': 'เป้าหมายการเงิน',
  'The Emergency Fund is always in the pool. Tick other goals to add their target on top.':
    'กองทุนฉุกเฉินอยู่ในพูลเสมอ เลือกเป้าหมายอื่นเพื่อเพิ่มยอดเป้าหมายด้านบน',
  'Savings Pool': 'พูลเงินออม',
  'Emergency Fund': 'กองทุนฉุกเฉิน',
  Target: 'เป้าหมาย',
  base: 'ฐาน',
  'No goals yet. Add one below.': 'ยังไม่มีเป้าหมาย เพิ่มด้านล่าง',
  'Add to pool': 'เพิ่มเข้าพูล',
  'Remove from pool': 'นำออกจากพูล',
  'Drag to reorder': 'ลากเพื่อจัดลำดับ',
  // Reconcile.
  Reconcile: 'กระทบยอด',
  'Match tracked balances to reality.': 'ปรับยอดที่บันทึกให้ตรงกับความจริง',
  "Register each account's real balance. The gap is recorded as a hidden cost (untracked amount).":
    'บันทึกยอดจริงของแต่ละบัญชี ส่วนต่างจะถูกบันทึกเป็นต้นทุนแฝง (ยอดที่ไม่ได้ติดตาม)',
  'Enter balances as the app shows them — liabilities like Credit Card are negative. Accounts you leave unchanged record nothing.':
    'กรอกยอดตามที่แอปแสดง — หนี้สินเช่นบัตรเครดิตเป็นค่าลบ บัญชีที่ไม่แก้ไขจะไม่บันทึกอะไร',
  Tracked: 'ที่บันทึก',
  Actual: 'ยอดจริง',
  Discrepancy: 'ส่วนต่าง',
  'Total discrepancy to record': 'ส่วนต่างรวมที่จะบันทึก',
  'Apply reconciliation': 'บันทึกการกระทบยอด',
  'No discrepancies — nothing to record.': 'ไม่มีส่วนต่าง — ไม่มีอะไรต้องบันทึก',
  'Recorded {n} balance adjustment(s).': 'บันทึกการปรับยอด {n} รายการ',
  'Recorded hidden cost (untracked)': 'ต้นทุนแฝงที่บันทึก (ไม่ได้ติดตาม)',
  'Last reconciled': 'กระทบยอดล่าสุด',
  never: 'ยังไม่เคย',
  due: 'ถึงกำหนด',
  'Add a goal': 'เพิ่มเป้าหมาย',
  'Goal name': 'ชื่อเป้าหมาย',
  'xTimes rule (≥1, optional)': 'ตัวคูณ (≥1, ไม่บังคับ)',
  '[{fx}x rule]': '[กฎ {fx} เท่า]',
  '+ Add goal': '+ เพิ่มเป้าหมาย',
  'The pool needs the highest of your ticked goals; the factor scales a goal before it counts.':
    'พูลใช้เป้าหมายที่สูงที่สุดที่เลือกไว้ ตัวคูณจะปรับยอดเป้าหมายก่อนนับว่าถึงเป้า',
  '{pct}% funded': 'ระดมทุนแล้ว {pct}%',
  '{pct}% funded · Emergency Fund covers {months} months':
    'ระดมทุนแล้ว {pct}% · กองทุนฉุกเฉินครอบคลุม {months} เดือน',
  'Pool accounts and the Emergency Fund target are set in ':
    'บัญชีพูลและเป้าหมายกองทุนฉุกเฉินตั้งค่าได้ใน ',
  // Savings-pool settings.
  'Savings pool': 'พูลเงินออม',
  'Pool accounts': 'บัญชีในพูล',
  'Balances of these accounts make up your savings pool.':
    'ยอดคงเหลือของบัญชีเหล่านี้รวมเป็นพูลเงินออมของคุณ',
  'Monthly required expenses': 'ค่าใช้จ่ายจำเป็นต่อเดือน',
  'Your baseline monthly spending — used to size the Emergency Fund.':
    'ค่าใช้จ่ายพื้นฐานต่อเดือน — ใช้กำหนดขนาดกองทุนฉุกเฉิน',
  'Target months': 'จำนวนเดือนเป้าหมาย',
  'Months of expenses to keep. Emergency Fund target = {amount}.':
    'จำนวนเดือนของค่าใช้จ่ายที่ต้องการเก็บ เป้าหมายกองทุนฉุกเฉิน = {amount}',
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
  Language: 'ภาษา',
  'Applies across the app right away.': 'มีผลทั่วทั้งแอปทันที',
  'Saved ✓': 'บันทึกแล้ว ✓',
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
