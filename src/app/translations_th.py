"""English → Thai UI strings.

Keys are the exact English source text passed to ``i18n.t(...)``; values are the
Thai translations. Anything not present here falls back to English, so this file
is filled in incrementally as each page is translated. Grouped by area for easy
review — the user can adjust any wording directly.

NOTE: only fixed UI text belongs here. User data (account/category names,
transaction notes, ticker symbols) is never translated.
"""

from __future__ import annotations

TRANSLATIONS_TH: dict[str, str] = {
    # ── Shared chrome: navigation menu ─────────────────────────────────────────
    "Money Flow": "กระแสเงิน",
    "Income / Expense": "รายรับ / รายจ่าย",
    "Transactions": "รายการจดบันทึก",
    "Budget": "จัดการงบประมาณ",
    "Financial Goals": "เป้าหมายการเงิน",
    "Income Tax": "ภาษีเงินได้บุคคล",
    "Compound Interest": "ดอกเบี้ยทบต้น",
    "Investing Simulator": "จำลองการลงทุน",
    "Historical Data": "ข้อมูลย้อนหลัง",
    "Paper Trading": "เปเปอร์เทรดดิ้ง",
    "Live Market Data": "ข้อมูลตลาดเรียลไทม์",
    "Stock Intrinsic Valuation": "ประเมินมูลค่าหุ้น",
    "Account Settings": "ตั้งค่าแอพ",
    "☰  Menu": "☰  เมนู",
    "Menu": "เมนู",
    "⌂ Home": "⌂ หน้าแรก",

    # ── Shared chrome: reminder banner + control tooltips ──────────────────────
    "⏰ Time to reconcile your accounts — register your real "
    "balances to capture untracked spending.":
        "⏰ ถึงเวลาเทียบยอดบัญชีแล้ว — บันทึกยอดเงินจริงเพื่อตรวจดูรายจ่ายที่ยังไม่ได้บันทึก",
    "Reconcile now": "ปรับยอดบัญชี",
    "Dismiss": "ปิด",
    "Toggle light/dark mode": "สลับโหมดสว่าง/มืด",
    "Hide/show amounts": "ซ่อน/แสดงจำนวนเงิน",
    "Switch language (EN / TH)": "เปลี่ยนภาษา (EN / TH)",

    # ── Home page ──────────────────────────────────────────────────────────────
    "A snapshot of your last 30 days. Click any chart to explore.":
        "ภาพรวม 30 วันล่าสุด คลิกที่กราฟใดก็ได้เพื่อดูรายละเอียด",
    "Open Budget": "ตั้งค่างบประมาณ",
    "Resets": "รีเซ็ต",
    "ahead": "เก็บเกินเป้า",
    "short": "ที่หลุดเป้า",
    "over": "ที่เกินงบมา",
    "left": "ที่เหลือใช้",
    "Last Item Recorded": "รายการล่าสุด",
    "None yet": "ยังไม่มี",
    "View Transactions": "ดูรายการจดบันทึก",
    "Inc.": "รับ",
    "Exp.": "จ่าย",
    "Tfr.": "โอน",
    "Adj.": "ปรับ",

    # 50/30/20 budget bucket names (shown on Home + Budget)
    "Needs": "จำเป็น",
    "Wants": "อยากได้",
    "Savings": "เงินออม",

    # ── Money Flow page + figure ───────────────────────────────────────────────
    "Running balance across your accounts, with a forward forecast "
    "(dashed) and 50% / 90% uncertainty bands. Zoom/pan to explore; "
    "click an account in the legend to show/hide it.":
        "ยอดคงเหลือสะสมของทุกบัญชีพร้อมการพยากรณ์ล่วงหน้า (เส้นประ) "
        "   ซูม/เลื่อนเพื่อดูกราฟย้อนหลัง คลิกชื่อบัญชีพื่อแสดง/ซ่อน",
    "Forecast:": "พยากรณ์:",
    "30 d": "30 วัน",
    "90 d": "90 วัน",
    "180 d": "180 วัน",
    "1 y": "1 ปี",
    "Retrain model": "ฝึกโมเดลใหม่",
    "Model trained ": "ฝึกโมเดลล่าสุดเมื่อ ",
    "Retrain the forecast model on all your current "
    "transactions? This replaces the saved model.":
        "ฝึกโมเดลพยากรณ์ใหม่จากธุรกรรมทั้งหมดของคุณหรือไม่? "
        "การทำเช่นนี้จะแทนที่โมเดลที่บันทึกไว้",
    "No transactions": "ไม่มีการจดบันทึก",
    "Amount": "จำนวนเงิน",
    "Balance after": "ยอดคงเหลือหลังรายการ",
    "Forecast": "พยากรณ์",
    "Forecast 90%": "พยากรณ์ 90%",
    "Forecast 50%": "พยากรณ์ 50%",
    "Net worth": "มูลค่าสุทธิ",
    "Hidden cost (untracked)": "รายการที่ไม่ได้บันทึก",
    "Latest balances": "ยอดคงเหลือปัจจุบัน",
    "Accounts (click to toggle)": "บัญชี",

    # ── Income / Expense (pie) page + figure ───────────────────────────────────
    "Income & Expense Composition": "รายละเอียดรายรับ&รายจ่าย",
    "Where your money comes from and where it goes.":
        "เพื่อตรวจสอบว่าเงินของคุณมาจากไหนและไปไหน",
    "Income": "รายรับ",
    "Expense": "รายจ่าย",
    "No data": "ไม่มีข้อมูล",
    "Pie": "แผนภูมิรูปวงกลม",
    "Histogram": "แผนภูมิแท่ง",
    "Past 30 days": "30 วันที่ผ่านมา",
    "Past 120 days": "120 วันที่ผ่านมา",
    "Past year": "1 ปีที่ผ่านมา",
    "Selected period": "ช่วงที่เลือก",
    "Expense order:": "การเรียงรายจ่าย:",
    "By amount": "ตามจำนวนเงิน",
    "By Needs/Wants": "ตามจำเป็น/อยากได้",
    "Sub-categories": "รายละเอียดหมวดหมู่ย่อย",
    "Other": "อื่นๆ",
    "of expense": "ของรายจ่าย",
    "of income": "ของรายรับ",

    # ── Financial Goals page + figure ──────────────────────────────────────────
    "The Emergency Fund is always included in the pool. "
    "Select other goals to add their targets on top.":
        "เงินออมฉุกเฉินจะถูกคิดรวมเสมอ คลิกเพิ่มเป้าหมายอื่นเพื่อคำนวนยอดรวมที่ต้องเก็บออม",
    "Goals": "เป้าหมาย",
    "Drag to reorder · click to add to the pool.":
        "ลากเพื่อจัดลำดับ · คลิกเลือกเพื่อคำนวนเงินที่ต้องออม",
    "Add a goal": "เพิ่มเป้าหมาย",
    "Goal name": "ชื่อเป้าหมาย",
    "Target": "เป้าหมาย",
    "Importance ×factor (default 1)": "ความสำคัญ ×ตัวคูณ (ค่าเริ่มต้น 1)",
    "Importance factor (≥ 1, optional)": "ตัวคูณความสำคัญ (≥ 1, ไม่บังคับ)",
    "xTimes rule factor (≥ 1, optional)": "ตัวคูณกฎ x เท่า (≥ 1, ไม่บังคับ)",
    "[{fx}x rule]": "[กฎ {fx} เท่า]",
    "Add '{name}' with a target of {amount} {cur} and a {fx}x rule?":
        "เพิ่ม '{name}' เป้าหมาย {amount} {cur} และกฎ {fx} เท่า?",
    "Add '{name}' with a target of {amount} {cur} and no multiplier?":
        "เพิ่ม '{name}' เป้าหมาย {amount} {cur} โดยไม่มีตัวคูณ?",
    "Multiplies this goal's target before it counts "
    "as reached (the pool needs the highest of your "
    "ticked goals).":
        "ใช้หลักการ x เท่าของราคาเป้าหมายจริงถึงนับว่าบรรลุเป้าหมาย",
    "+ Add goal": "+ เพิ่มเป้าหมาย",
    "Delete a goal": "ลบเป้าหมาย",
    "Select a goal…": "เลือกเป้าหมาย…",
    "Delete goal": "ลบเป้าหมาย",
    "Enter both a name and a target amount.": "กรุณากรอกทั้งชื่อและยอดเป้าหมาย",
    "Added '{name}'.": "เพิ่ม '{name}' แล้ว",
    "Deleted '{name}'.": "ลบ '{name}' แล้ว",
    "Delete the goal '{name}'? This cannot be undone.":
        "ลบเป้าหมาย '{name}' หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้",
    "Emergency Fund": "เงินออมฉุกเฉิน",
    "Savings Pool": "เงินออม",
    "{pct}% funded": "ออมแล้ว {pct}%",
    "{pct}% funded · Emergency Fund covers {months} months":
        "ออมแล้ว {pct}% · เงินออมฉุกเฉินครอบคลุม {months} เดือน",

    # ── Reconcile Balances page ────────────────────────────────────────────────
    "Reconcile Balances": "ปรับยอดบัญชี",
    "Settings": "ตั้งค่า",
    "Register each account's real balance. The gap is recorded "
    "as a hidden cost (untracked amount).":
        "บันทึกยอดคงเหลือจริงของแต่ละบัญชี ส่วนต่างจะถูกบันทึกเป็นจำนวนเงินที่ไม่ได้บันทึก",
    "Account": "บัญชี",
    "Tracked": "ที่บันทึกไว้",
    "Actual": "จริง",
    "Discrepancy": "ส่วนต่าง",
    "Total discrepancy to record": "ส่วนต่างรวมที่จะบันทึก",
    "never": "ยังไม่เคย",
    "Enter balances as the app shows them — liabilities like "
    "Credit Card are negative. Accounts you leave unchanged "
    "record nothing.":
        "กรอกยอดคงเหลือตามที่แอปแสดง — หนี้สินเช่นบัตรเครดิตให้ใส่ค่าติดลบ "
        "บัญชีที่ไม่ได้แก้ไขจะไม่บันทึกอะไร",
    "Apply reconciliation": "ยืนยันการปรับยอดบัญชี",
    "Recorded hidden cost (untracked)": "รวมยอดที่ไม่ได้บันทึก",
    "Last reconciled": "ปรับยอดบัญชีล่าสุด",
    "No discrepancies — nothing to record.": "ไม่มีส่วนต่าง — ไม่มีอะไรต้องบันทึก",
    "Recorded {n} balance adjustment(s).": "บันทึกการปรับยอด {n} รายการแล้ว",

    # ── Month + weekday names (Transactions) ───────────────────────────────────
    "January": "มกราคม", "February": "กุมภาพันธ์", "March": "มีนาคม",
    "April": "เมษายน", "May": "พฤษภาคม", "June": "มิถุนายน",
    "July": "กรกฎาคม", "August": "สิงหาคม", "September": "กันยายน",
    "October": "ตุลาคม", "November": "พฤศจิกายน", "December": "ธันวาคม",
    "Mon": "จ.", "Tue": "อ.", "Wed": "พ.", "Thu": "พฤ.",
    "Fri": "ศ.", "Sat": "ส.", "Sun": "อา.",

    # ── Transactions page ──────────────────────────────────────────────────────
    "Your monthly transaction record.": "บันทึกรายการธุรกรรมรายเดือนของคุณ",
    "Today": "วันนี้",
    "Go": "ไป",
    "⬆ Export": "⬆ ส่งออก",
    "Download your transactions": "ดาวน์โหลดรายการจดบันทึก",
    "This month · CSV": "เดือนนี้ · CSV",
    "This month · Excel": "เดือนนี้ · Excel",
    "Everything · CSV": "ทั้งหมด · CSV",
    "Everything · Excel": "ทั้งหมด · Excel",
    "⚙ Account Settings": "⚙ ตั้งค่าบัญชี",
    "Import, reconcile, backup & app settings":
        "Import รายการบันทึก, ปรับยอดบัญชี, สำรองข้อมูล และตั้งค่าแอป",
    "Loading transactions…": "กำลังโหลดรายการจดบันทึก",
    "+ Add": "+ เพิ่ม",
    "Total": "รวมทั้งหมด",
    "No transactions this month.": "ไม่มีรายการจดบันทึกในเดือนนี้",
    "Hidden cost": "ที่ไม่ได้จดบันทึก",
    "untracked": "ไม่ได้บันทึก",
    "Balance adjustment": "การปรับยอดคงเหลือ",
    "Transfer": "โอนข้ามบัญชี",
    "Add a transaction on this day": "เพิ่มธุรกรรมในวันนี้",

    # ── Add / Edit transaction form (txn_form) ─────────────────────────────────
    "Add Transaction": "เพิ่มรายการ",
    "Edit Transaction": "แก้ไขรายการ",
    "Recorded straight into your transactions file.":
        "บันทึกลงไฟล์รายการบันทึก",
    "Date": "วันที่",
    "Category": "หมวดหมู่",
    "From": "จาก",
    "Account": "บัญชี",
    "To": "ไปยัง",
    "Note": "โน้ต",
    "Description": "รายละเอียด",
    "Shown on the summary page": "แสดงในหน้าสรุป",
    "Optional details": "รายละเอียดเพิ่มเติม (ไม่บังคับ)",
    "Save": "บันทึก",
    "Continue": "บันทึกรายการต่อไป",
    "Delete": "ลบ",
    "Select category…": "เลือกหมวดหมู่…",
    "Select account…": "เลือกบัญชี…",
    "(no subcategory)": "(ไม่มีหมวดหมู่ย่อย)",
    "New category name": "ชื่อหมวดหมู่ใหม่",
    "New account name": "ชื่อบัญชีใหม่",
    "New subcategory in {cat}": "หมวดหมู่ย่อยใหม่ใน {cat}",
    "‹ Back": "‹ กลับ",
    "Pick a date.": "เลือกวันที่",
    "Enter an amount greater than zero.": "กรุณากรอกจำนวนเงินที่มากกว่าศูนย์",
    "Select both From and To accounts.": "กรุณาเลือกทั้งบัญชีต้นทางและปลายทาง",
    "From and To must be different accounts.": "บัญชีต้นทางและปลายทางต้องต่างกัน",
    "Select an account.": "เลือกบัญชี",
    "Select a category.": "เลือกหมวดหมู่",
    "Saved — add another.": "บันทึกแล้ว — เพิ่มรายการถัดไป",
    "Delete this transaction? Transfers remove both linked rows. "
    "This cannot be undone (a backup is kept in data/backups).":
        "ลบรายการนี้หรือไม่? การโอนจะลบทั้งสองรายการที่เชื่อมกัน "
        "การกระทำนี้ย้อนกลับไม่ได้ (มีสำรองข้อมูลเก็บไว้ที่ data/backups)",

    # ── Edit-transaction not-found / adjustment views ──────────────────────────
    "Transaction not found": "ไม่พบรายการ",
    "It may have been deleted.": "รายการอาจถูกลบไปแล้ว",
    "‹ Back to transactions": "‹ กลับไปหน้ารายการจดบันทึก",
    "This is a reconciliation entry (hidden cost). Manage your "
    "balances from the Reconcile page.":
        "นี่คือรายการปรับยอดบัญชี จัดการยอดคงเหลือได้จากหน้าการปรับบัญชี",
    "Go to Reconcile Balances": "ไปยังหน้าปรับยอดบัญชี",

    # ── Remove Transactions page ───────────────────────────────────────────────
    "Remove Transactions": "ลบรายการจดบันทึก",
    "Permanently delete every transaction dated within a period. "
    "A backup is saved first, but this can't be undone here.":
        "ลบรายการจดบันทึกทั้งหมดในช่วงเวลาที่เลือกอย่างถาวร "
        "ระบบจะสำรองข้อมูลก่อน แต่การกระทำนี้ย้อนกลับไม่ได้",
    "Start": "เริ่ม",
    "End": "สิ้นสุด",
    "Please select a transaction period for deletion.":
        "กรุณาเลือกช่วงเวลาของรายการบันทึกที่จะลบ",
    "Start date must be on or before the end date.":
        "วันที่เริ่มต้องอยู่ก่อนหรือตรงกับวันที่สิ้นสุด",
    "Delete transactions": "ลบรายการบันทึก",
    "No transactions in that period.": "ไม่มีรายการบันทึกในช่วงเวลานั้น",
    "⚠ Permanently delete {n} transaction(s) dated {start} to {end}?":
        "⚠ ลบ {n} รายการที่ลงวันที่ {start} ถึง {end} อย่างถาวรหรือไม่?",
    "Income rows total: {v}": "รวมรายการรายรับ: {v}",
    "Expense rows total: {v}": "รวมรายการรายจ่าย: {v}",
    "A backup is saved first, but this cannot be undone.":
        "ระบบจะสำรองข้อมูลก่อน แต่การกระทำนี้ย้อนกลับไม่ได้",
    "Removed {n} transaction(s). A backup was saved to data/backups/.":
        "ลบไป {n} รายการแล้ว มีการสำรองข้อมูลไว้ที่ data/backups/",
    "Could not remove: {err}": "ลบไม่สำเร็จ: {err}",

    # ── Budget page + figure ───────────────────────────────────────────────────
    "Income basis": "ฐานรายได้",
    "Fixed monthly amount": "จำนวนคงที่ต่อเดือน",
    "Rolling 6-month average": "ค่าเฉลี่ยย้อนหลัง 6 เดือน",
    "rolling 6-month average": "ค่าเฉลี่ยย้อนหลัง 6 เดือน",
    "fixed": "คงที่",
    "Fixed monthly income": "รายได้คงที่ต่อเดือน",
    "Split (%)": "สัดส่วน (%)",
    "Reset day of month": "วันรีเซ็ตของเดือน",
    "Save settings": "บันทึกการตั้งค่า",
    "Category buckets": "กลุ่มหมวดหมู่",
    "Drag a category between the buckets (or tap it to flip). "
    "The figure is each category's share of the period budget. "
    "Changes save automatically; Savings/Debt is whatever income is "
    "left after Needs and Wants.":
        "ลากหมวดหมู่ระหว่างกลุ่ม (หรือแตะเพื่อสลับ) "
        "ตัวเลขคือสัดส่วนของแต่ละหมวดหมู่ต่องบประมาณของช่วง "
        "การเปลี่ยนแปลงจะบันทึกอัตโนมัติ เงินออมคือส่วนที่เหลือหลังหักจำเป็นและอยากได้",
    "This period": "สำหรับเดือนนี้",
    "Period {start} – {end} · income base ": "ช่วงวันที่ {start} – {end} · ฐานรายได้ ",
    "of": "จาก",
    "Over budget — not in pie": "เกินงบ — ไม่แสดงในกราฟ",
    "Previous month": "เดือนก่อนหน้า",
    "This month — {label}": "เดือนนี้ — {label}",
    "Spending vs budget": "รายจ่ายเทียบกับงบที่ั้ตั้งไว้",
    "Each slice is the category's share of that month's budget. "
    "Needs (blue) fill the budget first, then Wants (orange); "
    "anything over budget drops to the list. "
    "Click a row below to see its monthly trend.":
        "แต่ละบล็อคคือสัดส่วนของหมวดหมู่ต่องบของเดือนนั้น "
        "จำเป็น (น้ำเงิน) อยากได้ (ส้ม) "
        "ส่วนที่เกินงบจะแสดงในลิสต์นอกแผนภูมิ"
        "คลิกชื่อหมวดหมู่ด้านล่างเพื่อดูแนวโน้มรายเดือน",
    "Sub-category detail": "รายละเอียดแยกตามหมวดหมู่ย่อย",
    "Sub-category": "หมวดหมู่ย่อย",
    "This ": "เดือนนี้ ",
    "Prev": "ก่อนหน้า",
    "Change ": "เปลี่ยนแปลง ",
    "No expense data for these months.": "ไม่มีข้อมูลรายจ่ายสำหรับเดือนเหล่านี้",
    "new": "ใหม่",
    "= {total}% (should be 100)": "= {total}% (ควรรวมเป็น 100)",
    "Saved.": "บันทึกแล้ว",
    " (note: split is {total}%, not 100%)": " (หมายเหตุ: สัดส่วนเป็น {total}% ไม่ใช่ 100%)",
    "Saved ✓": "บันทึกแล้ว ✓",
    "Spending trend: {label}": "แนวโน้มรายจ่าย: {label}",
    "Spending Trend": "แนวโน้มรายจ่าย",
    "Remaining budget": "งบที่เหลือ",
    "of budget": "ของงบ",

    # ── Income Tax page ────────────────────────────────────────────────────────
    "Estimate your Thailand personal income tax for the year. "
    "Set your tax-payment subcategory in Settings.":
        "ประมาณภาษีเงินได้บุคคลธรรมดาของไทยสำหรับปีนี้ "
        "ตั้งค่าหมวดหมู่ย่อยที่ใช้เพื่อจ่ายภาษีได้ในหน้าตั้งค่า",
    "Your details": "ข้อมูลของคุณ",
    "Tax year": "ปีภาษี",
    "Gross annual income": "รายได้รวมต่อปี",
    "Prefilled from your tracked income for the year — "
    "edit if some of it isn't taxable.":
        "กรอกล่วงหน้าจากรายได้ที่บันทึกไว้ในปีนั้น — แก้ไขได้หากบางส่วนไม่ต้องเสียภาษี",
    "Prefilled from these income categories: {cats} — "
    "edit if some of it isn't taxable.":
        "กรอกล่วงหน้าจากหมวดหมู่รายได้เหล่านี้: {cats} — "
        "แก้ไขได้หากบางส่วนไม่ต้องเสียภาษี",
    "CALCULATE": "คำนวณ",
    "RESET": "รีเซ็ต",
    "⬇ Export report": "⬇ ส่งออกรายงาน",
    "Deductions & allowances": "ค่าลดหย่อนและค่าใช้จ่าย",
    "Enter what applies to you. Each is capped to its statutory "
    "limit — after Calculate, every box shows how much actually "
    "counts.":
        "กรอกรายการที่เกี่ยวข้องกับคุณ แต่ละรายการจำกัดตามเพดานที่กฎหมายกำหนด — "
        "หลังกดคำนวณ แต่ละช่องจะแสดงจำนวนที่นำมาใช้ได้จริง",
    "Applies": "ใช้",
    "Close": "ปิด",
    "Tax already paid": "ภาษีที่จ่ายไปแล้ว",
    "See which months you paid tax": "ดูว่าจ่ายภาษีในเดือนใดแล้วบ้าง",
    "No tax payments recorded for this year.": "ไม่มีการบันทึกการจ่ายภาษีสำหรับปีนี้",
    "Gross income": "รายได้รวม",
    "Employment expense": "ค่าใช้จ่ายจากการจ้างงาน",
    "Allowances": "ค่าลดหย่อน",
    "Net taxable income": "เงินได้สุทธิที่ต้องเสียภาษี",
    "Tax due": "ภาษีที่ต้องชำระ",
    "Effective rate": "อัตราภาษีที่แท้จริง",
    "Marginal rate": "อัตราภาษีขั้นสูงสุด",
    "Still to pay": "ต้องจ่ายเพิ่ม",
    "Refund": "ได้คืน",
    "Settled": "ชำระครบแล้ว",
    "Band": "ขั้น",
    "Income in band": "เงินได้ในขั้น",
    "Rate": "อัตรา",
    "Tax": "ภาษี",
    "No taxable income — no tax due.": "ไม่มีเงินได้ที่ต้องเสียภาษี — ไม่มีภาษีต้องชำระ",
    "Tax by bracket": "ภาษีตามขั้นบันได",
    "Counts: {v}": "นำมาใช้: {v}",
    "Tax paid — {year}": "ภาษีที่จ่าย — {year}",
    "No payment made": "ยังไม่ได้จ่าย",

    # Income-tax allowance labels + hints (Thai model)
    "Personal allowance": "ค่าลดหย่อนส่วนตัว",
    "Automatic 60,000 for every taxpayer.": "หักอัตโนมัติ 60,000 สำหรับผู้เสียภาษีทุกคน",
    "Spouse (no income)": "คู่สมรส (ที่ไม่มีรายได้)",
    "60,000 if your spouse has no assessable income.":
        "60,000 หากคู่สมรสไม่มีเงินได้ที่ต้องประเมิน",
    "Children": "บุตร",
    "children": "คน",
    "people": "คน",
    "30,000 per child.": "30,000 ต่อบุตรหนึ่งคน",
    "Parental care": "ค่าอุปการะบิดามารดา",
    "30,000 per dependent parent aged 60+, up to 4.":
        "30,000 ต่อบิดามารดาที่อยู่ในอุปการะอายุ 60 ปีขึ้นไป สูงสุด 4 คน",
    "Life & health insurance": "ประกันชีวิตและสุขภาพ",
    "Premiums, capped at 100,000.": "เบี้ยประกัน สูงสุด 100,000",
    "Social security": "ประกันสังคม",
    "Contributions, capped at 9,000.": "เงินสมทบ สูงสุด 9,000",
    "Provident fund / GPF": "กองทุนสำรองเลี้ยงชีพ / กบข.",
    "Up to 15% of income and 500,000 (shared retirement cap).":
        "สูงสุด 15% ของรายได้และ 500,000 (เพดานรวมเพื่อการเกษียณ)",
    "SSF": "SSF",
    "Up to 30% of income and 200,000 (shared retirement cap).":
        "สูงสุด 30% ของรายได้และ 200,000 (เพดานรวมเพื่อการเกษียณ)",
    "RMF": "RMF",
    "Up to 30% of income and 500,000 (shared retirement cap).":
        "สูงสุด 30% ของรายได้และ 500,000 (เพดานรวมเพื่อการเกษียณ)",
    "Mortgage interest": "ดอกเบี้ยเงินกู้ซื้อบ้าน",
    "Home-loan interest, capped at 100,000.":
        "ดอกเบี้ยสินเชื่อบ้าน สูงสุด 100,000",
    "Donations": "เงินบริจาค",
    "Capped at 10% of income after other deductions.":
        "สูงสุด 10% ของรายได้หลังหักค่าลดหย่อนอื่น",

    # ── Settings page ──────────────────────────────────────────────────────────
    "Home": "หน้าแรก",
    "Edit your app configuration.": "แก้ไขการตั้งค่าแอป",
    "General": "ทั่วไป",
    "App name": "ชื่อแอป",
    "Base currency": "สกุลเงินหลัก",
    "Stamped on new transactions. The display currency across figures "
    "updates fully after an app restart.":
        "สกุลเงินที่แสดงในกราฟจะอัปเดตครบถ้วนหลังจากรีสตาร์ทแอป",
    "Emergency fund": "เงินออมฉุกเฉิน",
    "Monthly required expenses": "ค่าใช้จ่ายจำเป็นต่อเดือน",
    "Target months": "จำนวนเดือนเป้าหมาย",
    "Emergency-fund target = target months × monthly required expenses.":
        "เป้าหมายกองทุนฉุกเฉิน = จำนวนเดือนเป้าหมาย × ค่าใช้จ่ายจำเป็นต่อเดือน",
    "Savings account(s)": "บัญชีเงินออม",
    "+ savings account": "+ บัญชีเงินออม",
    "The Financial Goals savings pool combines the balances of "
    "all listed accounts.":
        "กองเงินออมในหน้าเป้าหมายการเงินรวมยอดคงเหลือของทุกบัญชีที่ระบุไว้",
    "− remove account": "− ลบบัญชี",
    "Privacy": "โหมดความเป็นส่วนตัว",
    "Auto-privacy": "เข้าโหมดความเป็นส่วนตัวอัตโนมัติ",
    "Hide amounts automatically when the home "
    "page is left idle":
        "ซ่อนตัวเลขจำนวนเงินอัตโนมัติเมื่อหน้าแรกไม่มีการใช้งานสักพัก",
    "Idle delay (seconds)": "ระยะเวลาไม่ใช้งาน (วินาที)",
    "Amounts stay hidden until you click the eye toggle to reveal them.":
        "จำนวนเงินจะถูกซ่อนไว้จนกว่าคุณจะคลิกปุ่มรูปตาเพื่อออกจากโหมดความเป็นส่วนตัว",
    "Tax setting": "การตั้งค่าภาษี",
    "Tax-payment subcategory": "หมวดหมู่ย่อยการจ่ายภาษีที่ใช้ในรายการบันทึก",
    "The Income Tax page sums this expense subcategory over the "
    "year as the tax you have already paid.":
        "หน้าภาษีเงินได้จะรวมยอดหมวดหมู่ย่อยรายจ่ายนี้ตลอดทั้งปีเป็นภาษีที่คุณจ่ายไปแล้ว",
    "Income categories (for tax)": "หมวดหมู่รายได้ (สำหรับคำนวณภาษี)",
    "Tax-payment subcategories": "หมวดหมู่ย่อยการจ่ายภาษี",
    "Leave empty to tax all income. The Income Tax page prefills "
    "gross income from the categories you add here.":
        "เว้นว่างไว้เพื่อคิดภาษีจากรายได้ทั้งหมด หน้าภาษีเงินได้จะกรอกรายได้รวม"
        "จากหมวดหมู่ที่คุณเพิ่มไว้ที่นี่",
    "The Income Tax page sums these expense subcategories over "
    "the year as the tax you have already paid.":
        "หน้าภาษีเงินได้จะรวมยอดหมวดหมู่ย่อยรายจ่ายเหล่านี้ตลอดทั้งปีเป็นภาษีที่คุณจ่ายไปแล้ว",
    "+ add category": "+ เพิ่มหมวดหมู่",
    "+ add subcategory": "+ เพิ่มหมวดหมู่ย่อย",
    "− remove": "− ลบ",
    "Select income category": "เลือกหมวดหมู่รายได้",
    "Select tax subcategory": "เลือกหมวดหมู่ย่อยภาษี",
    "Select tax category": "เลือกหมวดหมู่ภาษี",
    "Select subcategory in {cat}": "เลือกหมวดหมู่ย่อยใน {cat}",
    "Select in {cat}": "เลือกใน {cat}",
    "Whole category": "ทั้งหมวดหมู่",
    "{cat} (all)": "{cat} (ทั้งหมด)",
    "All income (default)": "รายได้ทั้งหมด (ค่าเริ่มต้น)",
    "All income": "รายได้ทั้งหมด",
    "None selected — defaults to “Tax”.": "ยังไม่ได้เลือก — ใช้ค่าเริ่มต้น “Tax”",
    "Language settings": "การตั้งค่าภาษา",
    "{label}: {old} → {new}": "{label}: {old} → {new}",
    "You have unsaved changes:": "คุณมีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก:",
    "Leave without saving?": "ออกจากหน้านี้โดยไม่บันทึกหรือไม่?",
    "on": "เปิด",
    "off": "ปิด",
    "disabled": "ปิดใช้งาน",
    "allowed": "อนุญาต",
    "Language toggle": "ปุ่มสลับภาษา",
    "Disable language toggling": "ปิดการสลับภาษา",
    "When disabled, the EN/ไทย switch at the top still shows but "
    "cannot change the language.":
        "เมื่อปิดใช้งาน ปุ่ม EN/ไทย ด้านบนจะยังแสดงอยู่ แต่จะไม่สามารถเปลี่ยนภาษาได้",
    "Second language": "ภาษาที่สอง",
    "English is always the first language. Choose the language the "
    "toggle translates to.":
        "ภาษาอังกฤษเป็นภาษาแรกเสมอ เลือกภาษาที่ต้องการให้ปุ่มสลับไปแปล",
    "No language toggle allowed, enable in Settings":
        "ไม่อนุญาตให้สลับภาษา เปิดใช้งานได้ในการตั้งค่า",
    "Account tools": "เครื่องมือบัญชี",
    "Transaction data": "ข้อมูลการจดบันทึก",
    "⬇ Import": "⬇ นำเข้า",
    "Reconcile balances": "ปรับยอดบัญชี",
    "Manage accounts & categories": "จัดการบัญชีและหมวดหมู่",
    "Backup & restore": "สำรองและกู้คืนข้อมูล",
    "Remove transactions": "ลบรายการจดบันทึก",
    "⚠ Danger Zone\n\nThe next screen lets you permanently "
    "delete transactions within a date range you choose. "
    "Deletions are backed up first, but cannot be undone from "
    "that page.\n\nOpen the Remove Transactions tool?":
        "⚠ โซนอันตราย\n\nหน้าถัดไปให้คุณลบรายการจดบันทึกในช่วงวันที่ที่เลือกอย่างถาวร "
        "การลบจะถูกสำรองข้อมูลก่อน แต่ไม่สามารถย้อนกลับจากหน้านั้นได้"
        "\n\nเปิดเครื่องมือลบรายการจดบันทึกหรือไม่?",
    "Could not save: {err}": "บันทึกไม่สำเร็จ: {err}",

    # ── Backup & Restore page ──────────────────────────────────────────────────
    "Backup & Restore": "สำรองและกู้คืนข้อมูล",
    "Everything personal in one file: your ledger and all settings.":
        "ทุกข้อมูลส่วนตัวในไฟล์เดียว: บัญชีรายการจดบันทึกและการตั้งค่าทั้งหมด",
    "No automatic backups yet — they appear after your "
    "first change to the ledger.":
        "ยังไม่มีการสำรองข้อมูลอัตโนมัติ — จะปรากฏหลังจากคุณแก้ไขบัญชีรายการจดบันทึกรั้งแรก",
    "When": "เมื่อ",
    "What": "อะไร",
    "File": "ไฟล์",
    "Size": "ขนาด",
    "Restore…": "กู้คืน…",
    "Download a full backup": "ดาวน์โหลดข้อมูลสำรองทั้งหมด",
    "⬇ Download backup": "⬇ ดาวน์โหลดข้อมูลสำรอง",
    "Restore from a backup file": "กู้คืนจากไฟล์สำรอง",
    "Drag & drop or ": "ลากมาวาง หรือ ",
    "select a backup .zip": "เลือกไฟล์สำรอง .zip",
    "Restore this backup": "กู้คืนข้อมูลสำรองนี้",
    "Automatic backups": "การสำรองข้อมูลอัตโนมัติ",
    "The app snapshots the ledger before every change (20 "
    "kept) and the whole state before every restore. Restoring "
    "a ledger snapshot only replaces transactions — settings "
    "stay as they are.":
        "แอปจะบันทึกสำเนาบัญชีรายการจดบันทึกอนการเปลี่ยนแปลงทุกครั้ง (เก็บไว้ 20 ชุด) "
        "และสำเนาสถานะทั้งหมดก่อนการกู้คืนทุกครั้ง การกู้คืนสำเนาบัญชีจะแทนที่เฉพาะรายการจดบันทึก - "
        "การตั้งค่ายังคงเดิม",
    "Confirm restore": "ยืนยันการกู้คืน",
    "Cancel": "ยกเลิก",
    "unknown date": "ไม่ทราบวันที่",
    "{filename} — valid backup ({n} files, created {created}).":
        "{filename} — ไฟล์สำรองถูกต้อง ({n} ไฟล์ สร้างเมื่อ {created})",
    "Contains: {items}.": "ประกอบด้วย: {items}",
    "the ledger": "บัญชีรายการจดบันทึก",
    "settings/config": "การตั้งค่า/คอนฟิก",
    "Restoring REPLACES your current data — a snapshot of the "
    "current state is saved to data/backups/ first.":
        "การกู้คืนจะแทนที่ข้อมูลปัจจุบันของคุณ — "
        "ระบบจะบันทึกสำเนาสถานะปัจจุบันไว้ที่ data/backups/ ก่อน",
    "Restore failed — nothing was changed: {err}":
        "กู้คืนไม่สำเร็จ — ไม่มีการเปลี่ยนแปลง: {err}",
    "Restored {items} ({n} files).": "กู้คืน {items} แล้ว ({n} ไฟล์)",
    "Pre-restore snapshot: {name}. If settings "
    "changed, restart the app to apply them everywhere.":
        "สำเนาก่อนกู้คืน: {name} หากมีการเปลี่ยนการตั้งค่า ให้รีสตาร์ทแอปเพื่อให้มีผลทุกที่",
    "Replace the current ledger with {name}?":
        "แทนที่บัญชีรายการจดบันทึกปัจจุบันด้วย {name} หรือไม่?",
    "Restore failed: {err}": "กู้คืนไม่สำเร็จ: {err}",
    "Ledger restored from {name}. (The previous state was "
    "backed up first.)":
        "กู้คืนบัญชีรายการจดบันทึกจาก {name} แล้ว (มีการสำรองสถานะก่อนหน้าไว้ก่อน)",

    # ── Manage accounts & categories page ──────────────────────────────────────
    "Tidy up the account and category lists.": "จัดระเบียบรายการบัญชีเงินและหมวดหมู่",
    "Accounts": "บัญชี",
    "Categories": "หมวดหมู่",
    "Spending": "รายจ่าย",
    "Expand / collapse": "ขยาย / ย่อ",
    "Rename": "เปลี่ยนชื่อ",
    "✕ Undo delete": "✕ ยกเลิกการลบ",
    "{n} uses": "ใช้ {n} ครั้ง",
    "Rename an account (updates every transaction, including "
    "transfers) or delete one you no longer use.":
        "เปลี่ยนชื่อบัญชี (อัปเดตทุกรายการจดบันทึก รวมถึงการโอน) หรือลบบัญชีที่ไม่ใช้แล้ว",
    " — drag a subcategory to another category to move it":
        " — ลากหมวดหมู่ย่อยไปยังอีกหมวดหมู่เพื่อย้าย",
    "Tap a category to rename it, delete it, or edit its "
    "subcategories.":
        "แตะที่หมวดหมู่เพื่อเปลี่ยนชื่อ ลบ หรือแก้ไขหมวดหมู่ย่อย",
    "Tap a category to manage it.": "แตะที่หมวดหมู่เพื่อจัดการ",
    "Marked for deletion — will be removed on Save.":
        "ทำเครื่องหมายเพื่อลบ — จะถูกลบเมื่อบันทึก",
    "✕ Undo delete category": "✕ ยกเลิกการลบหมวดหมู่",
    "Rename category": "เปลี่ยนชื่อหมวดหมู่",
    "Delete category": "ลบหมวดหมู่",
    "✕ Undo": "✕ เลิกทำ",
    "New subcategory": "หมวดหมู่ย่อยใหม่",
    "+ Add subcategory": "+ เพิ่มหมวดหมู่ย่อย",
    "Subcategories": "หมวดหมู่ย่อย",
    "None yet.": "ยังไม่มี",
    "Rename account": "เปลี่ยนชื่อบัญชี",
    "Review changes": "ตรวจทานการเปลี่ยนแปลง",
    "Apply changes": "ใช้การเปลี่ยนแปลง",
    '"{name}" deleted': 'ลบ "{name}" แล้ว',
    '"{old}" renamed to → "{new}"': 'เปลี่ยนชื่อ "{old}" → "{new}"',
    'income category "{name}" deleted': 'ลบหมวดหมู่รายรับ "{name}" แล้ว',
    'income category "{old}" renamed to → "{new}"':
        'เปลี่ยนชื่อหมวดหมู่รายรับ "{old}" → "{new}"',
    'category "{name}" deleted': 'ลบหมวดหมู่ "{name}" แล้ว',
    'category "{old}" renamed to → "{new}"':
        'เปลี่ยนชื่อหมวดหมู่ "{old}" → "{new}"',
    'sub "{sub}" added to "{cat}"': 'เพิ่มหมวดหมู่ย่อย "{sub}" ใน "{cat}"',
    'sub "{sub}" deleted from "{cat}"': 'ลบหมวดหมู่ย่อย "{sub}" จาก "{cat}"',
    'sub "{sub}" moved from "{old}" → "{new}"':
        'ย้ายหมวดหมู่ย่อย "{sub}" จาก "{old}" → "{new}"',
    'sub "{old}" renamed to → "{new}"':
        'เปลี่ยนชื่อหมวดหมู่ย่อย "{old}" → "{new}"',
    "An account named '{name}' already exists.":
        "มีบัญชีชื่อ '{name}' อยู่แล้ว",
    "Staged rename → '{name}'.": "เตรียมเปลี่ยนชื่อ → '{name}'",
    "'{name}' is used by {n} transaction(s) — rename it or reassign "
    "those first.":
        "'{name}' ถูกใช้โดย {n} รายการ — เปลี่ยนชื่อหรือย้ายรายการเหล่านั้นก่อน",
    "Staged delete of '{name}'.": "เตรียมลบ '{name}'",
    "Restored '{name}'.": "กู้คืน '{name}' แล้ว",
    "A category named '{name}' already exists.":
        "มีหมวดหมู่ชื่อ '{name}' อยู่แล้ว",
    "'{name}' is used by {n} transaction(s) — rename or reassign "
    "those first.":
        "'{name}' ถูกใช้โดย {n} รายการ — เปลี่ยนชื่อหรือย้ายรายการเหล่านั้นก่อน",
    "'{name}' already exists.": "มี '{name}' อยู่แล้ว",
    "Staged new subcategory '{name}'.": "เตรียมเพิ่มหมวดหมู่ย่อย '{name}'",
    "'{cat}' already has a '{sub}'.": "'{cat}' มี '{sub}' อยู่แล้ว",
    "Moved '{sub}' → {cat}.": "ย้าย '{sub}' → {cat} แล้ว",
    "No changes to apply.": "ไม่มีการเปลี่ยนแปลงให้บันทึก",
    "Account changes:": "การเปลี่ยนแปลงบัญชี:",
    "Category changes:": "การเปลี่ยนแปลงหมวดหมู่:",
    "Could not apply: {err}": "บันทึกไม่สำเร็จ: {err}",
    "Changes applied.": "บันทึกการเปลี่ยนแปลงแล้ว",

    # ── Import wizard page ─────────────────────────────────────────────────────
    "Import Data": "นำเข้าข้อมูล",
    "Bring transactions in from another app or a bank export.":
        "นำเข้าธุรกรรมจากแอปอื่นหรือไฟล์ส่งออกจากธนาคาร",
    "Auto-detect": "ตรวจจับอัตโนมัติ",
    "(day first)": "(วันขึ้นก่อน)",
    "(month first)": "(เดือนขึ้นก่อน)",
    "(year first)": "(ปีขึ้นก่อน)",
    "(dot decimal)": "(จุดทศนิยม)",
    "(comma decimal)": "(จุลภาคทศนิยม)",
    "No previous import on record yet.": "ยังไม่มีบันทึกการนำเข้าครั้งก่อน",
    "Last import: {filename} · {count} row(s) — ticking the box below "
    "will remove these before importing.":
        "นำเข้าล่าสุด: {filename} · {count} แถว — "
        "การติ๊กช่องด้านล่างจะลบรายการเหล่านี้ก่อนนำเข้า",
    "1 · Choose a file": "1 · เลือกไฟล์",
    "select a .csv / .xlsx file": "เลือกไฟล์ .csv / .xlsx",
    "2 · Map columns": "2 · จับคู่คอลัมน์",
    "Source preset: ": "รูปแบบต้นทาง: ",
    "Type": "ประเภท",
    "Inflow": "เงินเข้า",
    "Outflow": "เงินออก",
    "Subcategory": "หมวดหมู่ย่อย",
    "Currency": "สกุลเงิน",
    "Date format": "รูปแบบวันที่",
    "Decimal format": "รูปแบบทศนิยม",
    "Preview import": "แสดงตัวอย่างการนำเข้า",
    " Replace previous import (remove the last "
    "imported file's transactions first)":
        " แทนที่การนำเข้าครั้งก่อน (ลบรายการจดบันทึกของไฟล์ที่นำเข้าล่าสุดก่อน)",
    "Import": "นำเข้า",
    "Undo last import": "เลิกทำการนำเข้าล่าสุด",
    "Go to Transactions": "ไปที่หน้ารายการจดบันทึก",
    "Save as profile": "บันทึกเป็นโปรไฟล์",
    "Name this column mapping so you can reuse it on "
    "a future import.":
        "ตั้งชื่อการจับคู่คอลัมน์นี้เพื่อนำกลับมาใช้ในการนำเข้าครั้งต่อไป",
    "Profile name…": "ชื่อโปรไฟล์…",
    "Auto-detect / manual": "ตรวจจับอัตโนมัติ / กำหนดเอง",
    "Could not read {filename}: {err}": "อ่าน {filename} ไม่ได้: {err}",
    "{filename} — {rows} rows, {cols} columns. ":
        "{filename} — {rows} แถว {cols} คอลัมน์ ",
    "Detected: {name}.": "ตรวจพบ: {name}",
    "No known layout detected — check the mapping below.":
        "ไม่พบรูปแบบที่รู้จัก — ตรวจสอบการจับคู่ด้านล่าง",
    "File contents (first {n} rows, read-only):":
        "เนื้อหาไฟล์ ({n} แถวแรก ดูอย่างเดียว):",
    "3 · Review": "3 · ตรวจทาน",
    "{importable} transaction(s) ready to import "
    "({parsed} parsed, {exact} already imported — skipped":
        "{importable} ธุรกรรมพร้อมนำเข้า "
        "(อ่านได้ {parsed} รายการ, นำเข้าแล้ว {exact} รายการ — ข้าม",
    ", {n} possible duplicate(s) — see below":
        ", {n} รายการที่อาจซ้ำ — ดูด้านล่าง",
    "{n} row(s) skipped: {reason}": "ข้าม {n} แถว: {reason}",
    "New categories will be created: ": "จะสร้างหมวดหมู่ใหม่: ",
    "Unknown accounts — create them or map to an "
    "existing account:":
        "บัญชีที่ไม่รู้จัก — สร้างใหม่หรือจับคู่กับบัญชีที่มีอยู่:",
    "➕ Create “{name}”": "➕ สร้าง “{name}”",
    "{n} possible duplicate(s) — same day, amount, account, and type "
    "as an existing entry. Tick any you still want to import:":
        "{n} รายการที่อาจซ้ำ — วันที่ จำนวนเงิน บัญชี และประเภทตรงกับรายการที่มีอยู่ "
        "ติ๊กรายการที่คุณยังต้องการนำเข้า:",
    "… and {n} more.": "… และอีก {n} รายการ",
    "Cannot import: {err}": "นำเข้าไม่ได้: {err}",
    "⚠ REPLACE MODE: {n} transaction(s) from the previous "
    "import (\"{filename}\") will be DELETED first.":
        "⚠ โหมดแทนที่: {n} รายการจดบันทึกจากการนำเข้าครั้งก่อน (\"{filename}\") จะถูกลบก่อน",
    "{n} transaction(s) will be imported from \"{filename}\".":
        "จะนำเข้า {n} รายการจดบันทึกจาก \"{filename}\"",
    "{n} row(s) will be skipped (duplicates / unticked).":
        "จะข้าม {n} แถว (รายการซ้ำ / ไม่ได้ติ๊ก)",
    "A backup is saved before any change. Continue?":
        "ระบบจะบันทึกข้อมูลสำรองก่อนการเปลี่ยนแปลง ดำเนินการต่อหรือไม่?",
    "Import undone — the ledger was restored.":
        "เลิกทำการนำเข้าแล้ว — กู้คืนบัญชีรายการจดบันทึกเรียบร้อย",
    "Nothing to import.": "ไม่มีรายการให้นำเข้า",
    " Previous import ({n} row(s)) removed.":
        " ลบการนำเข้าครั้งก่อน ({n} แถว) แล้ว",
    "Imported {n} transaction(s)": "นำเข้า {n} รายการแล้ว",
    " — {n} duplicate(s) skipped.": " — ข้ามรายการซ้ำ {n} รายการ",
    "A backup was taken first (Undo restores the pre-import "
    "ledger); the uploaded file was archived under "
    "data/backups/.":
        "มีการสำรองข้อมูลไว้ก่อน (เลิกทำจะกู้คืนบัญชีรายการจดบันทึกก่อนนำเข้า); "
        "ไฟล์ที่อัปโหลดถูกจัดเก็บไว้ที่ data/backups/",
    "Give the profile a name first.": "ตั้งชื่อโปรไฟล์ก่อน",
    'Save this column mapping as profile "{name}"?':
        'บันทึกการจับคู่คอลัมน์นี้เป็นโปรไฟล์ "{name}" หรือไม่?',
    'Saved profile "{name}" → {file}': 'บันทึกโปรไฟล์ "{name}" → {file} แล้ว',

    # ── Stock Intrinsic Valuation page + figures ────────────────────────────────
    "Estimate a stock's fair value by several models. Enter any "
    "ticker — assumptions auto-fill and stay editable.":
        "ประเมินมูลค่าของหุ้นด้วยหลายแบบจำลอง ใส่สัญลักษณ์หุ้นใดก็ได้ — "
        "สมมติฐานจะเติมอัตโนมัติและแก้ไขได้",
    "Ticker:": "สัญลักษณ์หุ้น:",
    "e.g. AAPL": "เช่น AAPL",
    "Analyze": "วิเคราะห์",
    "Assumptions": "สมมติฐาน",
    "Cost of equity r_e (%)": "ต้นทุนส่วนของผู้ถือหุ้น r_e (%)",
    "WACC (%)": "WACC (%)",
    "Risk-free r_f (%)": "อัตราปลอดความเสี่ยง r_f (%)",
    "Beta": "เบต้า",
    "ERP (%)": "ส่วนชดเชยความเสี่ยงตลาด ERP (%)",
    "Stage-1 growth g1 (%)": "การเติบโตระยะที่ 1 g1 (%)",
    "Stage-2 growth g2 (%)": "การเติบโตระยะที่ 2 g2 (%)",
    "Terminal growth g_T (%)": "การเติบโตปลายทาง g_T (%)",
    "Recalculate": "คำนวณใหม่",
    "Could not analyze {ticker}: {err}": "วิเคราะห์ {ticker} ไม่ได้: {err}",
    "Reverse DCF: the market price implies ":
        "DCF ย้อนกลับ: ราคาตลาดบ่งชี้ถึง ",
    " stage-1 FCF growth. Believable for this business?":
        " การเติบโตของ FCF ระยะที่ 1 น่าเชื่อถือสำหรับธุรกิจนี้หรือไม่?",
    "⚠ {pct}% of the DCF value sits in the terminal value — the number "
    "is almost all far-future assumption. Trust it less.":
        "⚠ {pct}% ของมูลค่า DCF อยู่ในมูลค่าปลายทาง — "
        "ตัวเลขเกือบทั้งหมดเป็นสมมติฐานในอนาคตอันไกล ควรเชื่อถือน้อยลง",
    "Model caveats — why the numbers differ":
        "ข้อควรระวังของแบบจำลอง — ทำไมตัวเลขจึงต่างกัน",
    "Method": "วิธี",
    "Fair": "มูลค่าที่ fair",
    "MoS": "ส่วนเผื่อความปลอดภัย",
    "Notes": "หมายเหตุ",
    # caveats
    "Why the numbers differ": "ทำไมตัวเลขจึงต่างกัน",
    "Each model prices a different thing: discounted cash flows (DCF), the dividend "
    "stream (DDM), book value plus excess returns (RI), a payout-justified multiple "
    "(P/E), a 1974 heuristic (Graham), and zero-growth earnings power (EPV). "
    "Dispersion is information, not error: a wide spread means high uncertainty. "
    "Read the median of the models that fit the company (see Notes), never one number.":
        "แต่ละแบบจำลองประเมินสิ่งที่ต่างกัน: กระแสเงินสดคิดลด (DCF), กระแสเงินปันผล (DDM), "
        "มูลค่าตามบัญชีบวกผลตอบแทนส่วนเกิน (RI), ตัวคูณที่สมเหตุสมผลตามการจ่ายปันผล (P/E), "
        "กฎเกณฑ์ปี 1974 (Graham) และกำลังการทำกำไรแบบไม่เติบโต (EPV) "
        "การกระจายตัวคือข้อมูล ไม่ใช่ข้อผิดพลาด: ช่วงที่กว้างหมายถึงความไม่แน่นอนสูง "
        "ให้ดูค่ามัธยฐานของแบบจำลองที่เหมาะกับบริษัท (ดูหมายเหตุ) ไม่ใช่ตัวเลขเดียว",
    "Two-stage DCF": "DCF สองระยะ",
    "Very sensitive to inputs: ±1% on WACC or terminal growth can move fair value "
    "20–40%. FCF here is CFO − CapEx (retail convention) — it is post-interest, so "
    "bridging −debt at WACC slightly double-counts debt. Not for banks or cyclicals.":
        "อ่อนไหวต่อค่าที่ป้อนมาก: ±1% ของ WACC หรือการเติบโตปลายทางเปลี่ยนมูลค่ายุติธรรมได้ "
        "20–40% FCF ที่นี่คือ CFO − CapEx (ตามแบบทั่วไป) — เป็นค่าหลังหักดอกเบี้ย "
        "การหัก −หนี้ด้วย WACC จึงนับหนี้ซ้ำเล็กน้อย ไม่เหมาะกับธนาคารหรือหุ้นวัฏจักร",
    "Dividend Discount (H-model)": "แบบจำลองคิดลดเงินปันผล (H-model)",
    "Growth fades linearly from g1 to g_T over ~10 years. Only meaningful for "
    "steady payers; meaningless when the dividend is token or absent.":
        "การเติบโตค่อย ๆ ลดลงเชิงเส้นจาก g1 ไปยัง g_T ในเวลาประมาณ 10 ปี "
        "มีความหมายเฉพาะกับบริษัทที่จ่ายปันผลสม่ำเสมอ ไร้ความหมายเมื่อเงินปันผลน้อยหรือไม่มี",
    "Residual Income": "รายได้คงเหลือ (RI)",
    "Assumes clean book value; buybacks shrink book equity and inflate ROE, making "
    "this unreliable for heavy repurchasers (common in US mega-caps). ROE fades to "
    "r_e over 10 years — conservative by construction.":
        "สมมติว่ามูลค่าตามบัญชีสะอาด การซื้อหุ้นคืนลดส่วนของผู้ถือหุ้นและทำให้ ROE สูงเกินจริง "
        "จึงไม่น่าเชื่อถือสำหรับบริษัทที่ซื้อหุ้นคืนมาก (พบบ่อยในหุ้นขนาดใหญ่ของสหรัฐฯ) "
        "ROE ค่อย ๆ ลดสู่ r_e ใน 10 ปี — ระมัดระวังโดยการออกแบบ",
    "Justified P/E": "P/E ที่สมเหตุสมผล",
    "Gordon algebra on payout & sustainable growth (ROE × retention). Undefined for "
    "non-payers and for firms whose sustainable growth exceeds r_e — that is honest, "
    "not a bug.":
        "สูตร Gordon จากการจ่ายปันผลและการเติบโตที่ยั่งยืน (ROE × สัดส่วนกำไรสะสม) "
        "ใช้ไม่ได้กับบริษัทที่ไม่จ่ายปันผลและบริษัทที่การเติบโตยั่งยืนเกิน r_e — "
        "นั่นคือความซื่อตรง ไม่ใช่ข้อบกพร่อง",
    "Graham formula": "สูตร Graham",
    "A 1974 rule of thumb; Graham himself warned against formula valuation. Growth "
    "capped at 15; AAA bond yield approximated as r_f + 1%. Sanity check only.":
        "กฎเกณฑ์ปี 1974 Graham เองเตือนไม่ให้ประเมินมูลค่าด้วยสูตร จำกัดการเติบโตไว้ที่ 15 "
        "ประมาณผลตอบแทนพันธบัตร AAA เป็น r_f + 1% ใช้ตรวจสอบความสมเหตุสมผลเท่านั้น",
    "Earnings Power Value": "มูลค่ากำลังการทำกำไร (EPV)",
    "A deliberate floor: assumes zero growth forever and that current EBIT is "
    "mid-cycle 'normal'. Below-EPV prices suggest the market expects decline.":
        "เป็นค่าต่ำสุดโดยตั้งใจ: สมมติว่าไม่มีการเติบโตตลอดไปและ EBIT ปัจจุบันเป็นค่า 'ปกติ' "
        "กลางวัฏจักร ราคาที่ต่ำกว่า EPV บ่งชี้ว่าตลาดคาดว่าจะถดถอย",
    # figures
    "No valuation": "ไม่มีการประเมินมูลค่า",
    "Margin of safety": "ส่วนเผื่อความปลอดภัย",
    "fair {fair} vs price {price} {currency}":
        "ยุติธรรม {fair} เทียบราคา {price} {currency}",
    "Price {price}": "ราคา {price}",
    "No values": "ไม่มีข้อมูล",
    "Fair value by method": "มูลค่ายุติธรรมแยกตามวิธี",
    "Value / share ({currency})": "มูลค่าต่อหุ้น ({currency})",
    "Terminal": "ปลายทาง",
    "Terminal value = {pct}% of EV": "มูลค่าปลายทาง = {pct}% ของ EV",
    "DCF n/a": "ไม่มี DCF",
    "DCF: present value of cash flows": "DCF: มูลค่าปัจจุบันของกระแสเงินสด",
    "PV (billion {currency})": "มูลค่าปัจจุบัน (พันล้าน {currency})",
    "Bear": "ตลาดหมี",
    "Base": "ฐาน",
    "Bull": "ตลาดกระทิง",
    "DCF scenarios": "สถานการณ์ DCF",
    "Fair value ({currency})": "มูลค่ายุติธรรม ({currency})",
    "Sensitivity: fair value vs discount rate × terminal growth":
        "ความอ่อนไหว: มูลค่ายุติธรรมเทียบอัตราคิดลด × การเติบโตปลายทาง",
    "Terminal growth g_T": "การเติบโตปลายทาง g_T",
    "Discount rate r": "อัตราคิดลด r",

    # ── Compound Interest Calculator page + figures ─────────────────────────────
    "Compound Interest Calculator": "คำนวณดอกเบี้ยแบบทบต้น",
    "A standalone tool for exploring investment growth.":
        "สำหรับเพื่อสำรวจการเติบโตของการลงทุน",
    "Plan your path to retirement — project your savings, "
    "spending, and financial-freedom age.":
        "วางแผนเส้นทางสู่การเกษียณ — คาดการณ์เงินออม ค่าใช้จ่าย "
        "และอายุที่มีอิสรภาพทางการเงินของคุณ",
    " Log y-axis": " แกน y แบบลอการิทึม",
    "Simple Compound Interest Calculator": "คำนวณดอกเบี้ยทบต้นอย่างง่าย",
    "Retirement Planning": "วางแผนเกษียณ",
    "Principal Amount": "เงินต้น",
    "Monthly Deposit": "เงินฝากรายเดือน",
    "Period (months)": "ระยะเวลา (เดือน)",
    "Annual Interest Rate (%)": "อัตราดอกเบี้ยต่อปี (%)",
    "Compounding": "การทบต้น",
    "Monthly": "รายเดือน",
    "Quarterly": "รายไตรมาส",
    "6 Months": "6 เดือน",
    "Annually": "รายปี",
    "(unhide to see goals)": "(ออกจากโหมดความเป็นส่วนตัวคำนวนเป้าหมายการเงิน)",
    "Current age (yr)": "อายุปัจจุบัน (ปี)",
    "Your age today; the projection starts here.":
        "อายุของคุณวันนี้ การคาดการณ์เริ่มจากจุดนี้",
    "Retirement age (yr)": "อายุเกษียณ (ปี)",
    "When you stop working: deposits stop and the "
    "retirement bonus is added; draw-down begins.":
        "เมื่อคุณหยุดทำงาน: การฝากหยุดและเพิ่มโบนัสเกษียณ จากนั้นเริ่มถอนเงิน",
    "Life expectancy (yr)": "อายุขัยที่คาดหวัง (ปี)",
    "The age the projection runs to — savings must "
    "last from retirement to here.":
        "อายุที่การคาดการณ์สิ้นสุด — เงินออมต้องอยู่ได้ตั้งแต่เกษียณจนถึงจุดนี้",
    "Savings you already have today, before any "
    "deposits.":
        "เงินออมที่คุณมีอยู่แล้ววันนี้ ก่อนการฝากใด ๆ",
    "Added to savings at the start of each month "
    "while working; grows yearly by the deposit-"
    "increase rate.":
        "เพิ่มเข้าเงินออมทุกต้นเดือนขณะทำงาน เติบโตทุกปีตามอัตราการเพิ่มเงินฝาก",
    "Deposit increase (%/yr)": "การเพิ่มเงินฝาก (%/ปี)",
    "Yearly raise applied to your monthly deposit "
    "(e.g. a salary raise), compounded until "
    "retirement.":
        "การขึ้นต่อปีที่ใช้กับเงินฝากรายเดือน (เช่น การขึ้นเงินเดือน) ทบต้นจนเกษียณ",
    "Expected yearly investment return, applied "
    "monthly to the balance throughout the plan.":
        "ผลตอบแทนการลงทุนต่อปีที่คาดหวัง คิดรายเดือนกับยอดคงเหลือตลอดแผน",
    "Inflation Rate (%)": "อัตราเงินเฟ้อ (%)",
    "Yearly rise in prices: inflates your expenses "
    "and converts the balance into today's money.":
        "การขึ้นราคาต่อปี: ทำให้ค่าใช้จ่ายสูงขึ้นและแปลงยอดคงเหลือเป็นมูลค่าเงินวันนี้",
    "Retirement Bonus": "โบนัสเกษียณ",
    "One-off lump sum added to savings the year you "
    "retire (e.g. gratuity/severance).":
        "เงินก้อนครั้งเดียวที่เพิ่มเข้าเงินออมในปีที่คุณเกษียณ (เช่น บำเหน็จ/ค่าชดเชย)",
    "Pension (monthly)": "เงินบำนาญ (รายเดือน)",
    "Fixed monthly income through retirement (not "
    "inflation-adjusted); offsets expenses before "
    "drawing on savings.":
        "รายได้รายเดือนคงที่ตลอดการเกษียณ (ไม่ปรับตามเงินเฟ้อ) "
        "หักลบค่าใช้จ่ายก่อนถอนเงินออม",
    "Expected Monthly Expense": "ค่าใช้จ่ายรายเดือนที่คาดหวัง",
    "Monthly spending in today's money; it inflates "
    "each year and savings cover whatever the "
    "pension doesn't.":
        "การใช้จ่ายรายเดือนในมูลค่าเงินวันนี้ เพิ่มตามเงินเฟ้อทุกปี "
        "และเงินออมครอบคลุมส่วนที่บำนาญไม่ครอบคลุม",
    "Return volatility (%/yr)": "ความผันผวนของผลตอบแทน (%/ปี)",
    "Year-to-year swing (std. dev.) of the "
    "investment return — the main source of "
    "uncertainty. ~15% is typical for a "
    "stock-heavy portfolio.":
        "ความผันผวนปีต่อปี (ส่วนเบี่ยงเบนมาตรฐาน) ของผลตอบแทนการลงทุน — "
        "แหล่งความไม่แน่นอนหลัก ~15% เป็นค่าปกติสำหรับพอร์ตที่เน้นหุ้น",
    "Inflation volatility (%/yr)": "ความผันผวนของเงินเฟ้อ (%/ปี)",
    "Year-to-year swing of inflation around "
    "the rate you entered.":
        "ความผันผวนปีต่อปีของเงินเฟ้อรอบ ๆ อัตราที่คุณป้อน",
    "Deposit-growth volatility (%/yr)": "ความผันผวนของการเติบโตเงินฝาก (%/ปี)",
    "Year-to-year swing of your salary-raise "
    "rate.":
        "ความผันผวนปีต่อปีของอัตราการขึ้นเงินเดือนของคุณ",
    "Simulations": "จำนวนการจำลอง",
    "How many random futures to simulate. "
    "More runs give a smoother median "
    "(100–3000).":
        "จำลองอนาคตแบบสุ่มกี่ครั้ง ยิ่งมากค่ามัธยฐานยิ่งเรียบ (100–3000)",
    "Ages": "อายุ",
    "Retirement": "การเกษียณ",
    "Your plan": "แผนของคุณ",
    " Show today's money (real)": " แสดงมูลค่าเงินวันนี้ (จริง)",
    " Show uncertainty (Monte Carlo)": " แสดงความไม่แน่นอน (Monte Carlo)",
    "Ages, retirement age, life expectancy, principal and the "
    "initial monthly deposit are held fixed; only the rates above "
    "vary between runs.":
        "อายุ อายุเกษียณ อายุขัย เงินต้น และเงินฝากรายเดือนเริ่มต้นถูกกำหนดคงที่ "
        "มีเพียงอัตราด้านบนเท่านั้นที่เปลี่ยนไปในแต่ละรอบ",
    "Financial Goals to achieve": "เป้าหมายทางการเงินที่ต้องการบรรลุ",
    "Total Principal": "เงินต้นรวม",
    "Interest Amount": "จำนวนดอกเบี้ย",
    "Maturity Value": "มูลค่าเมื่อครบกำหนด",
    "APY": "APY",
    "Monthly expense at retirement": "ค่าใช้จ่ายรายเดือนเมื่อเกษียณ",
    "Years in retirement": "จำนวนปีในการเกษียณ",
    "Financial freedom": "อิสรภาพทางการเงิน",
    "Total contributions": "เงินสมทบรวม",
    "Pot at retirement": "เงินก้อนเมื่อเกษียณ",
    "Funds-out age (16–84%)": "อายุที่เงินหมด (16–84%)",
    "Ending balance": "ยอดคงเหลือสุดท้าย",
    " mo": " เดือน",
    "Don't buy": "ไม่ซื้อ",
    "Buy at amount": "ซื้อที่จำนวนเงิน",
    "Buy at ×factor": "ซื้อที่ ×ตัวคูณ",
    "Goal": "เป้าหมาย",
    "When you'll reach each goal": "เมื่อไรคุณจะบรรลุแต่ละเป้าหมาย",
    "Months until each selected goal is reached, under three "
    "strategies. “Don't buy” follows the green maturity "
    "line (money is never spent). “Buy at amount” and "
    "“Buy at ×factor” spend in your Financial Goals "
    "rank order, so buying an earlier goal pushes later goals back.":
        "จำนวนเดือนจนกว่าจะบรรลุแต่ละเป้าหมายที่เลือก ภายใต้สามกลยุทธ์ "
        "“ไม่ซื้อ” จะตามเส้นครบกำหนดสีเขียว (ไม่มีการใช้จ่ายเงิน) "
        "“ซื้อที่จำนวนเงิน” และ “ซื้อที่ ×ตัวคูณ” "
        "จะใช้จ่ายตามลำดับความสำคัญในเป้าหมายทางการเงินของคุณ "
        "การซื้อเป้าหมายก่อนหน้าจึงเลื่อนเป้าหมายถัดไปออกไป",
    "Lasts to {age}": "อยู่ได้ถึง {age}",
    "Runs out {age}": "หมดเมื่อ {age}",
    "×factor": "×ตัวคูณ",
    "plain": "ซื้อทันที",
    "not reached": "ไม่ถึงเป้าหมาย",
    "Spent on goals": "ใช้จ่ายกับเป้าหมาย",
    "Outcome": "ผลลัพธ์",
    "Plan succeeds": "แผนสำเร็จ",
    "{prob} of {n} runs": "{prob} จาก {n} รอบ",
    "{p16}–{p84} (med {p50})": "{p16}–{p84} (มัธยฐาน {p50})",
    "age {p50} (16–84%: {p16}–{p84})": "อายุ {p50} (16–84%: {p16}–{p84})",
    "age {age}": "อายุ {age}",
    "Funds last through age {age}": "เงินอยู่ได้ถึงอายุ {age}",
    "Funds run out at age {age}": "เงินหมดเมื่ออายุ {age}",
    # compound figure
    "±20% rate ({lo}–{hi}%)": "อัตรา ±20% ({lo}–{hi}%)",
    "Maturity ({pct}%)": "ครบกำหนด ({pct}%)",
    "Month": "เดือน",
    "Maturity": "ครบกำหนด",
    "After buying (×factor)": "หลังซื้อ (×ตัวคูณ)",
    "After buying (no factor)": "หลังซื้อ (ซื้อทันที)",
    "Principal": "เงินต้น",
    "Value ({currency})": "มูลค่า ({currency})",
    "{name} bought · month {month}": "ซื้อ {name} · เดือน {month}",
    "Growth over time": "การเติบโตตามเวลา",
    "Months": "เดือน",
    # retirement figure
    "Without goals (median)": "ไม่มีเป้าหมาย (มัธยฐาน)",
    "After buying ×factor (median)": "หลังซื้อ ×ตัวคูณ (มัธยฐาน)",
    "After buying plain (median)": "หลังซื้อแบบปกติ (มัธยฐาน)",
    "×factor today's money (median)": "×ตัวคูณ มูลค่าเงินวันนี้ (มัธยฐาน)",
    "Balance (median)": "ยอดคงเหลือ (มัธยฐาน)",
    "Balance today's money (median)": "ยอดคงเหลือมูลค่าเงินวันนี้ (มัธยฐาน)",
    "Without goals": "ไม่คำนึงเป้าหมาย",
    "After buying (plain)": "หลังซื้อ (ซื้อทันที)",
    "×factor (today's money)": "×ตัวคูณ (มูลค่าเงินวันนี้)",
    "Balance (future money)": "ยอดคงเหลือ (มูลค่าเงินอนาคต)",
    "Balance (today's money)": "ยอดคงเหลือ (มูลค่าเงินวันนี้)",
    "Future money": "เงินอนาคต",
    "Plain amount": "จำนวนเงินปกติ",
    "×factor · today": "×ตัวคูณ · วันนี้",
    "Today's money": "มูลค่าเงินวันนี้",
    "Age": "อายุ",
    "{name} bought · age {age}": "ซื้อ {name} · อายุ {age}",
    "Retire · {age}": "เกษียณ · {age}",
    "Funds depleted · age {age}": "เงินหมด · อายุ {age}",
    "Funds depleted · age {age} →": "เงินหมด · อายุ {age} →",
    "Funds depleted · 100+ yr →": "เงินหมด · 100+ ปี →",
    "Financial freedom · age {age}": "อิสรภาพทางการเงิน · อายุ {age}",
    "Funds depleted": "เงินหมด",
    "Retirement projection": "การคาดการณ์การเกษียณ",

    # ── Investing Simulator page + figures ──────────────────────────────────────
    " · CLOSED": " · ปิดแล้ว",
    "Day {i} / {n} — {date}": "วันที่ {i} / {n} — {date}",
    "Ticker": "สัญลักษณ์",
    "Shares": "จำนวนหุ้น",
    "Price": "ราคา",
    "Value": "มูลค่า",
    "No holdings yet.": "ยังไม่มีการถือครอง",
    "Cash": "เงินสด",
    "Total value": "มูลค่ารวม",
    "Today $": "วันนี้ $",
    "Today %": "วันนี้ %",
    "Total $": "รวม $",
    "Total %": "รวม %",
    "(G−L)/(G+L)": "(G−L)/(G+L)",
    "Day %": "% วัน",
    "Stock ticker symbol": "สัญลักษณ์หุ้น",
    "Closing price on the current game day": "ราคาปิดในวันเกมปัจจุบัน",
    "Change vs the previous trading day": "เปลี่ยนแปลงเทียบวันซื้อขายก่อนหน้า",
    "Trailing P/E — price ÷ trailing 12-month EPS (last 4 quarters)":
        "Trailing P/E — ราคา ÷ EPS ย้อนหลัง 12 เดือน (4 ไตรมาสล่าสุด)",
    "Current P/E — price ÷ latest annual (fiscal-year) EPS":
        "Current P/E — ราคา ÷ EPS รายปีล่าสุด (ปีงบการเงิน)",
    "Forward P/E — price ÷ (latest quarterly EPS × 4), annualized":
        "Forward P/E — ราคา ÷ (EPS รายไตรมาสล่าสุด × 4) ต่อปี",
    "Unknown": "ไม่ทราบ",
    "Investing Simulator ": "เครื่องจำลองการลงทุน ",
    "(Historical Data)": "(ข้อมูลย้อนหลัง)",
    "Trade real historical prices day by day. Each portfolio "
    "starts at $10,000 — compare your strategies against the "
    "S&P 500.":
        "ซื้อขายด้วยราคาจริงย้อนหลังวันต่อวัน แต่ละพอร์ตเริ่มต้นที่ $10,000 — "
        "เปรียบเทียบกลยุทธ์ของคุณกับ S&P 500",
    "Period:": "ช่วงเวลา:",
    "Start game": "เริ่มเกม",
    "Next ›": "ถัดไป ›",
    "Restart": "เริ่มใหม่",
    "Manage": "จัดการ",
    "+ Portfolio": "+ พอร์ต",
    "Rename active…": "เปลี่ยนชื่อพอร์ต…",
    "Ticker (e.g. AAPL)": "สัญลักษณ์ หรือชื่อย่อหุ้น (เช่น AAPL)",
    "Add": "เพิ่ม",
    "  Shares": "  จำนวนหุ้น",
    "  $ amount": "  จำนวนเงิน $",
    "Ticker…": "ชื่อย่อหุ้น…",
    "Qty / $": "จำนวน / $",
    "Buy": "ซื้อ",
    "Sell": "ขาย",
    "Stocks": "หุ้น",
    " Normalize (% vs start)": " ปรับส่วนสูงกราฟ (% เทียบจุดเริ่ม)",
    "Delete stock": "ลบหุ้น",
    "Restart game": "เริ่มเกมใหม่",
    "Keep your portfolios and tickers and replay from "
    "day 1, or clear everything and start over?":
        "เก็บพอร์ตและชื่อย่อหุ้นแล้วเล่นใหม่จากวันที่ 1 หรือล้างทั้งหมดแล้วเริ่มใหม่?",
    "Restart (keep portfolios)": "เริ่มใหม่ (เก็บพอร์ต)",
    "Restart — clear all": "เริ่มใหม่ — ล้างทั้งหมด",
    "Remove ": "ลบ ",
    " from the list forever, or just for this game?":
        " ออกจากรายการถาวร หรือเฉพาะเกมนี้?",
    "Delete forever": "ลบถาวร",
    "Delete this session": "ลบเฉพาะรอบนี้",
    "Pick a start and close date.": "เลือกวันเริ่มและวันปิด",
    "Could not start: {err}": "เริ่มไม่ได้: {err}",
    "Sell your shares of {ticker} first.": "ขายหุ้น {ticker} ของคุณก่อน",
    "Choose a ticker to trade.": "เลือกสัญลักษณ์เพื่อซื้อขาย",
    "Qty": "จำนวน",
    # shared metric labels/tips (Investing + Paper Trading)
    "Operating margin": "อัตรากำไรจากการดำเนินงาน",
    "Revenue growth (YoY)": "การเติบโตของรายได้ (YoY)",
    "P/S": "P/S",
    "Trailing P/E": "Trailing P/E",
    "P/E (current)": "P/E",
    "Forward P/E": "Forward P/E",
    "D/E": "D/E",
    "Price-to-Sales — market cap ÷ trailing 12-month revenue":
        "Price-to-Sales — มูลค่าตลาด ÷ รายได้ย้อนหลัง 12 เดือน",
    "Debt-to-Equity — total debt ÷ shareholders' equity":
        "Debt-to-Equity — หนี้สินรวม ÷ ส่วนของผู้ถือหุ้น",
    "Operating income ÷ revenue": "กำไรจากการดำเนินงาน ÷ รายได้",
    "Year-over-year revenue change": "การเปลี่ยนแปลงรายได้เทียบปีต่อปี",
    "Price ÷ trailing 12-month EPS (last 4 quarters)":
        "ราคา ÷ EPS ย้อนหลัง 12 เดือน (4 ไตรมาสล่าสุด)",
    "Price ÷ latest annual (fiscal-year) EPS":
        "ราคา ÷ EPS รายปีล่าสุด (ปีงบการเงิน)",
    "Price ÷ (latest quarterly EPS × 4), annualized":
        "ราคา ÷ (EPS รายไตรมาสล่าสุด × 4) ต่อปี",
    # investment figure
    "Start ${amount}": "เริ่มต้น ${amount}",
    "Portfolio value over time": "มูลค่าพอร์ตตามเวลา",
    "Value (USD)": "มูลค่า (USD)",
    "Game start": "เริ่มเกม",
    "% of start": "% เทียบจุดเริ่ม",
    "Price (USD)": "ราคา (USD)",
    "{ticker} price": "ราคา {ticker}",
    " (% of start)": " (% เทียบจุดเริ่ม)",
    " — normalized": " — ปรับมาตรฐาน",
    " — price": " — ราคา",
    "Open": "เปิด",
    "High": "สูงสุด",
    "Low": "ต่ำสุด",
    "Volume": "ปริมาณ",
    "Vol": "ปริมาณ",

    # ── Paper Trading — Accounts page ───────────────────────────────────────────
    "Paper Trading ": "เทรดจำลอง ",
    "(Live Market Data)": "(ข้อมูลตลาดสด)",
    "Your practice accounts. Pick one to start trading, or "
    "create a new account below.":
        "บัญชีฝึกซ้อมของคุณ เลือกหนึ่งบัญชีเพื่อเริ่มซื้อขาย หรือสร้างบัญชีใหม่ด้านล่าง",
    "Delete account": "ลบบัญชี",
    "Created {date} · {n} open positions": "สร้างเมื่อ {date} · {n} สถานะเปิด",
    "No accounts yet — create one below to start trading.":
        "ยังไม่มีบัญชี — สร้างด้านล่างเพื่อเริ่มซื้อขาย",
    "  created {date}": "  สร้างเมื่อ {date}",
    "Restore": "กู้คืน",
    "Recently deleted": "ลบล่าสุด",
    "New account": "บัญชีใหม่",
    "Account name (e.g. Growth)": "ชื่อบัญชี (เช่น Growth)",
    "Starting $ (optional)": "เงินเริ่มต้น $ (ไม่บังคับ)",
    "Create account": "สร้างบัญชี",
    "Delete ": "ลบ ",
    "? It moves to Recently deleted and can be "
    "restored.":
        "? บัญชีจะย้ายไปยังลบล่าสุดและสามารถกู้คืนได้",
    "Confirm new account": "ยืนยันบัญชีใหม่",
    "Confirm": "ยืนยัน",
    "Enter an account name.": "ใส่ชื่อบัญชี",
    "Create account ": "สร้างบัญชี ",
    " with ": " ด้วย ",
    " starting cash.": " เป็นเงินเริ่มต้น",
    "this account": "บัญชีนี้",

    # ── Paper Trading — Trade page + figure ─────────────────────────────────────
    "Equity ${amount}": "มูลค่าสุทธิ ${amount}",
    "  ·  Today ": "  ·  วันนี้ ",
    "  ·  Total ": "  ·  รวม ",
    "Equity": "มูลค่าสุทธิ",
    "Buying power": "อำนาจซื้อ",
    "Realized P/L": "กำไร/ขาดทุนที่รับรู้แล้ว",
    "Unrealized P/L": "กำไร/ขาดทุนที่ยังไม่รับรู้",
    "Total account value: cash + market value of all positions "
    "(short positions count negative).":
        "มูลค่าบัญชีทั้งหมด: เงินสด + มูลค่าตลาดของทุกสถานะ (สถานะขายชอร์ตนับเป็นลบ)",
    "Free cash available for new buys or as collateral for shorts.":
        "เงินสดว่างสำหรับซื้อใหม่หรือเป็นหลักประกันสำหรับการขายชอร์ต",
    "Change since yesterday's close, summed over stock/crypto positions "
    "(options excluded).":
        "การเปลี่ยนแปลงตั้งแต่ราคาปิดเมื่อวาน รวมทุกสถานะหุ้น/คริปโต (ไม่รวมออปชัน)",
    "Today's $ change as a percent of yesterday's equity.":
        "การเปลี่ยนแปลง $ วันนี้เป็นเปอร์เซ็นต์ของมูลค่าสุทธิเมื่อวาน",
    "Profit/loss vs the net capital you put in (deposits − withdrawals). "
    "Moving cash in or out never counts as gain or loss.":
        "กำไร/ขาดทุนเทียบเงินทุนสุทธิที่คุณใส่เข้าไป (ฝาก − ถอน) "
        "การโยกเงินเข้าออกไม่นับเป็นกำไรหรือขาดทุน",
    "Total $ P/L as a percent of your net contributed capital.":
        "กำไร/ขาดทุน $ รวมเป็นเปอร์เซ็นต์ของเงินทุนสุทธิที่คุณใส่เข้าไป",
    "Profit/loss locked in by trades you have already closed.":
        "กำไร/ขาดทุนที่ล็อกไว้จากการซื้อขายที่คุณปิดแล้ว",
    "Paper profit/loss still open in your current positions — "
    "changes with the market until you close them.":
        "กำไร/ขาดทุนบนกระดาษที่ยังเปิดอยู่ในสถานะปัจจุบัน — "
        "เปลี่ยนไปตามตลาดจนกว่าคุณจะปิด",
    " (short)": " (ชอร์ต)",
    "No open positions.": "ไม่มีสถานะเปิด",
    "Position": "สถานะ",
    "Avg": "เฉลี่ย",
    "P/L": "กำไร/ขาดทุน",
    "No pending orders.": "ไม่มีคำสั่งค้าง",
    "Order": "คำสั่ง",
    "Trigger": "จุดกระตุ้น",
    "Cancel order": "ยกเลิกคำสั่ง",
    "Add tickers to watch live quotes.": "เพิ่มสัญลักษณ์เพื่อดูราคาสด",
    "Last": "ล่าสุด",
    "Chg": "เปลี่ยน",
    "Chg %": "เปลี่ยน %",
    "Remove from watchlist (holdings unaffected)":
        "ลบออกจากรายการเฝ้าดู (ไม่กระทบการถือครอง)",
    "No transactions yet.": "ยังไม่มีธุรกรรม",
    "Action": "การกระทำ",
    "Load an option chain to pick a contract.":
        "โหลดตารางออปชันเพื่อเลือกสัญญา",
    "Strike": "ราคาใช้สิทธิ",
    "Bid": "เสนอซื้อ",
    "Ask": "เสนอขาย",
    "IV": "IV",
    "OI": "OI",
    "Deposit": "ฝาก",
    "Withdraw": "ถอน",
    "into": "เข้า",
    "from": "จาก",
    "Sell / Short": "ขาย / ชอร์ต",
    "contract": "สัญญา",
    "share": "หุ้น",
    "  (×{mult} per contract)": "  (×{mult} ต่อสัญญา)",
    "@ {ap}${price} per {unit}": "@ {ap}${price} ต่อ{unit}",
    "at the current price": "ที่ราคาปัจจุบัน",
    "Estimated cost": "ต้นทุนโดยประมาณ",
    "Estimated proceeds": "รายรับโดยประมาณ",
    "limit ${price}": "ลิมิต ${price}",
    "stop ${price}": "สต็อป ${price}",
    "trailing stop": "trailing stop",
    "{otype} order — {trig}": "คำสั่ง{otype} — {trig}",
    "Est. amount when filled: ": "จำนวนโดยประมาณเมื่อจับคู่: ",
    "Example: ": "ตัวอย่าง: ",
    "● LIVE": "● สด",
    "Capital": "เงินทุน",
    "$ amount": "จำนวนเงิน $",
    "Order ticket": "ใบสั่งซื้อขาย",
    "  Stock/ETF": "  หุ้น/ETF",
    "  Stock/ETF/Crypto": "  หุ้น/ETF/คริปโต",
    "  Crypto": "  คริปโต",
    "  Option": "  ออปชัน",
    "Symbol (e.g. AAPL, BTC-USD)": "สัญลักษณ์ (เช่น AAPL, BTC-USD)",
    "Load chain": "โหลดตาราง",
    "Expiry": "วันหมดอายุ",
    "  Call": "  Call",
    "  Put": "  Put",
    "  Market": "  ตลาด",
    "  Limit": "  ลิมิต",
    "  Stop": "  สต็อป",
    "  Trailing": "  Trailing",
    "What do these order types mean?": "ประเภทคำสั่งเหล่านี้หมายถึงอะไร?",
    "Limit $": "ลิมิต $",
    "Stop $": "สต็อป $",
    "Trail %": "Trail %",
    "  Shares/Contracts": "  หุ้น/สัญญา",
    "+ Watch": "+ เฝ้าดู",
    "Pending orders": "คำสั่งค้าง",
    "Watchlist": "รายการเฝ้าดู",
    "Trade history": "ประวัติการซื้อขาย",
    "View all": "ดูทั้งหมด",
    "Positions": "สถานะ",
    "Sector": "กลุ่มอุตสาหกรรม",
    "Option chain": "ตารางออปชัน",
    "Line": "เส้น",
    "Candle": "แท่งเทียน",
    "Full Screen": "เต็มจอ",
    "Exit Full Screen": "ออกจากเต็มจอ",
    "Confirm transaction": "ยืนยันธุรกรรม",
    "Confirm delete": "ยืนยันการลบ",
    "Order types explained": "อธิบายประเภทคำสั่ง",
    "Market": "ตลาด",
    "Executes immediately at the current market price.":
        "ดำเนินการทันทีที่ราคาตลาดปัจจุบัน",
    "“Buy 5 AAPL at market” fills right away at ≈ the live "
    "price. Use it when getting in/out now matters more than "
    "the exact price.":
        "“ซื้อ AAPL 5 หุ้นที่ราคาตลาด” จับคู่ทันทีที่ ≈ ราคาสด "
        "ใช้เมื่อการเข้า/ออกตอนนี้สำคัญกว่าราคาที่แน่นอน",
    "Limit": "ลิมิต",
    "Executes only at your price or better; waits otherwise.":
        "ดำเนินการเฉพาะที่ราคาของคุณหรือดีกว่าเท่านั้น มิฉะนั้นจะรอ",
    "AAPL trades at $300. A buy-limit at $290 fills only if "
    "the price drops to $290 or less (buying a dip). A "
    "sell-limit at $320 fills only at $320 or more (taking "
    "profit at your target).":
        "AAPL ซื้อขายที่ $300 คำสั่งซื้อลิมิตที่ $290 จะจับคู่เฉพาะเมื่อราคาลดลงถึง $290 "
        "หรือต่ำกว่า (ซื้อตอนย่อ) คำสั่งขายลิมิตที่ $320 จะจับคู่เฉพาะที่ $320 "
        "หรือมากกว่า (ทำกำไรที่เป้าหมายของคุณ)",
    "Stop": "สต็อป",
    "Dormant until the price crosses your trigger, then "
    "executes at market.":
        "อยู่เฉยจนกว่าราคาจะข้ามจุดกระตุ้นของคุณ จากนั้นดำเนินการที่ราคาตลาด",
    "You bought AAPL at $300. A sell-stop at $280 (a "
    "“stop-loss”) sells automatically if it falls to $280, "
    "capping your loss. A buy-stop at $315 buys only if the "
    "price breaks out upward through $315.":
        "คุณซื้อ AAPL ที่ $300 คำสั่งขายสต็อปที่ $280 (“stop-loss”) จะขายอัตโนมัติ "
        "หากราคาตกถึง $280 จำกัดการขาดทุนของคุณ คำสั่งซื้อสต็อปที่ $315 "
        "จะซื้อเฉพาะเมื่อราคาทะลุขึ้นผ่าน $315",
    "Trailing": "Trailing",
    "A stop that follows the price by a set percent and only "
    "ratchets in your favour.":
        "สต็อปที่ตามราคาตามเปอร์เซ็นต์ที่กำหนดและขยับเฉพาะในทางที่เป็นประโยชน์กับคุณ",
    "You bought at $300 with a 10% sell-trailing stop. The "
    "price runs to $350, so the stop rides up to $315 "
    "(350 − 10%). If the price then falls 10% from its peak, "
    "you sell — profit locked in, upside left open.":
        "คุณซื้อที่ $300 พร้อม trailing stop ขาย 10% ราคาวิ่งขึ้นไปถึง $350 "
        "สต็อปจึงเลื่อนขึ้นเป็น $315 (350 − 10%) หากราคาตกลง 10% จากจุดสูงสุด "
        "คุณจะขาย — ล็อกกำไรไว้ เปิดโอกาสขาขึ้นต่อ",
    "Note: pending orders here are checked against "
    "~15-min-delayed quotes on each refresh tick, so "
    "fills can lag the exact trigger moment.":
        "หมายเหตุ: คำสั่งค้างที่นี่จะถูกตรวจสอบกับราคาที่ล่าช้าประมาณ 15 นาที "
        "ในการรีเฟรชแต่ละครั้ง การจับคู่จึงอาจช้ากว่าช่วงเวลาที่กระตุ้นจริง",
    "Trade history — all transactions": "ประวัติการซื้อขาย — ธุรกรรมทั้งหมด",
    "Hide trade history": "ซ่อนประวัติการซื้อขาย",
    "Deposited": "ฝากแล้ว",
    "Withdrew": "ถอนแล้ว",
    " from your watchlist? Your holdings are not "
    "affected.":
        " ออกจากรายการเฝ้าดูของคุณ? การถือครองของคุณไม่ได้รับผลกระทบ",
    "Can't delete the only portfolio.": "ลบพอร์ตเดียวที่มีอยู่ไม่ได้",
    "Delete portfolio ": "ลบพอร์ต ",
    " and all its holdings & history? ": " และการถือครองกับประวัติทั้งหมด? ",
    "This cannot be undone.": "การกระทำนี้ย้อนกลับไม่ได้",
    "Removed {ticker} from watchlist": "ลบ {ticker} ออกจากรายการเฝ้าดูแล้ว",
    "Deleted portfolio {name}": "ลบพอร์ต {name} แล้ว",
    "Enter a symbol first.": "ใส่สัญลักษณ์ก่อน",
    "Close position": "ปิดสถานะ",
    "Order entry": "ส่งคำสั่งซื้อขาย",
    "Buy or sell the loaded symbol, or close your whole position.":
        "ซื้อหรือขายหุ้นที่โหลดไว้ หรือปิดสถานะทั้งหมดของคุณ",
    "Buy / Sell": "ซื้อ / ขาย",
    "Place order": "ส่งคำสั่ง",
    "Value: {value} $": "มูลค่า: {value} $",
    "Place order amount": "จำนวนที่จะส่งคำสั่ง",
    "Close table": "ปิดตาราง",
    " Orders wait for market open": " คำสั่งรอจนตลาดเปิด",
    "What does market-hours mode do?": "โหมดเวลาตลาดทำอะไร?",
    "Market-hours fills": "เติมคำสั่งตามเวลาตลาด",
    "When ON, orders only fill while the NYSE "
    "is open (9:30–16:00 ET, Mon–Fri, minus "
    "holidays). A market order placed off-hours "
    "is queued and fills at the first quote "
    "after the next open — like a real broker. "
    "Pending limit/stop/trailing orders also "
    "pause while the market is closed.":
        "เมื่อเปิด คำสั่งจะเติมเฉพาะช่วงที่ตลาด NYSE เปิด (9:30–16:00 ET "
        "จันทร์–ศุกร์ ยกเว้นวันหยุด) คำสั่ง market ที่ส่งนอกเวลาจะถูกจัดคิว "
        "และเติมที่ราคาแรกหลังตลาดเปิดครั้งถัดไป — เหมือนโบรกเกอร์จริง "
        "คำสั่งค้าง limit/stop/trailing จะหยุดทำงานช่วงตลาดปิดด้วย",
    "Crypto (-USD pairs) trades around the "
    "clock and is never queued. When OFF, all "
    "orders fill instantly at the latest "
    "(~15-min delayed) quote.":
        "คริปโต (คู่ -USD) ซื้อขายได้ตลอด 24 ชั่วโมงและไม่ถูกจัดคิว "
        "เมื่อปิดโหมดนี้ คำสั่งทั้งหมดจะเติมทันทีที่ราคาล่าสุด "
        "(ดีเลย์ ~15 นาที)",
    "Turn off market-hours fills?": "ปิดโหมดเติมคำสั่งตามเวลาตลาด?",
    "Turning this off will place your queued "
    "orders straight away at the current "
    "quote. Continue?":
        "การปิดโหมดนี้จะทำให้คำสั่งที่จัดคิวไว้ถูกส่งทันทีที่ราคาปัจจุบัน "
        "ดำเนินการต่อหรือไม่?",
    "Market is closed — this order will be queued and filled at "
    "the next open.":
        "ตลาดปิดอยู่ — คำสั่งนี้จะถูกจัดคิวและเติมเมื่อตลาดเปิดครั้งถัดไป",
    "Select amount type": "เลือกประเภทจำนวน",
    "Select an amount type first.": "เลือกประเภทจำนวนก่อน",
    "Shares/Contracts": "หุ้น/สัญญา",
    "$ amount": "จำนวนเงิน $",
    "You hold {qty} {symbol}.": "คุณถือ {symbol} อยู่ {qty} หน่วย",
    "You are SHORT {qty} {symbol}.": "คุณชอร์ต {symbol} อยู่ {qty} หน่วย",
    "No open position for {symbol}.": "ไม่มีสถานะเปิดสำหรับ {symbol}",
    "⚠ You hold {held} — this sell exceeds your position and will "
    "OPEN A SHORT of {short} {unit}(s).":
        "⚠ คุณถืออยู่ {held} — คำสั่งขายนี้เกินจำนวนที่ถือ "
        "และจะเปิดสถานะชอร์ต {short} {unit}",
    "No listed options for {symbol}.": "ไม่มีออปชันจดทะเบียนสำหรับ {symbol}",
    "Loaded option chain for {symbol}.": "โหลดเชนออปชันของ {symbol} แล้ว",
    "{symbol} not found — check the symbol.":
        "ไม่พบ {symbol} — ตรวจสอบสัญลักษณ์อีกครั้ง",
    "{symbol} loaded — last price ${price}.":
        "โหลด {symbol} แล้ว — ราคาล่าสุด ${price}",
    "Added {symbol} to watchlist.": "เพิ่ม {symbol} ในรายการเฝ้าดูแล้ว",
    "Load stock": "โหลดหุ้น",
    "Cash: ${amount}": "เงินสด: ${amount}",
    "What do these asset types mean?": "ประเภทสินทรัพย์เหล่านี้หมายถึงอะไร?",
    "Asset types explained": "อธิบายประเภทสินทรัพย์",
    "Stock/ETF": "หุ้น/ETF",
    "Crypto": "คริปโต",
    "Option": "ออปชัน",
    "A share of a single company (stock), or a fund that "
    "holds a whole basket of assets under one ticker "
    "(ETF). Trades during US market hours.":
        "หุ้นของบริษัทเดียว (หุ้น) หรือกองทุนที่ถือสินทรัพย์หลายตัวรวมกัน"
        "ในติกเกอร์เดียว (ETF) ซื้อขายในช่วงเวลาทำการของตลาดสหรัฐฯ",
    "AAPL is Apple stock; SPY is an ETF that holds all "
    "S&P 500 companies at once.":
        "AAPL คือหุ้น Apple ส่วน SPY คือ ETF ที่ถือหุ้นทั้งหมดใน S&P 500 พร้อมกัน",
    "A digital currency, quoted as a -USD pair. Trades "
    "around the clock (24/7) and is typically far more "
    "volatile than stocks.":
        "สกุลเงินดิจิทัล แสดงราคาเป็นคู่ -USD ซื้อขายได้ตลอด 24 ชั่วโมงทุกวัน "
        "และโดยทั่วไปผันผวนมากกว่าหุ้นมาก",
    "BTC-USD is Bitcoin priced in dollars; ETH-USD is "
    "Ethereum.":
        "BTC-USD คือบิตคอยน์ในสกุลดอลลาร์ ส่วน ETH-USD คืออีเธอเรียม",
    "A contract giving the right — not the obligation — "
    "to buy (call) or sell (put) 100 shares of the "
    "underlying at a set strike price until expiry. Load "
    "the chain, then pick expiry, call/put and strike.":
        "สัญญาที่ให้สิทธิ์ — แต่ไม่ใช่ข้อผูกมัด — ในการซื้อ (คอล) หรือขาย (พุท) "
        "หุ้นอ้างอิง 100 หุ้นที่ราคาใช้สิทธิ์ที่กำหนดจนถึงวันหมดอายุ "
        "โหลดเชนแล้วเลือกวันหมดอายุ คอล/พุท และราคาใช้สิทธิ์",
    "An AAPL call with strike $300 expiring in December "
    "profits if Apple rises well above $300 before then; "
    "it can also expire worthless.":
        "คอลออปชัน AAPL ราคาใช้สิทธิ์ $300 ที่หมดอายุเดือนธันวาคม จะได้กำไร"
        "ถ้าราคา Apple ขึ้นสูงกว่า $300 มากพอก่อนถึงตอนนั้น "
        "แต่ก็อาจหมดค่าลงได้เช่นกัน",
    "Contract: {under} {expiry} {cp}{strike}": "สัญญา: {under} {expiry} {cp}{strike}",
    # paper figure
    "{name} principal": "เงินต้น {name}",
    "Account equity over time": "มูลค่าสุทธิของบัญชีตามเวลา",
    "Time": "เวลา",
    "Equity (USD)": "มูลค่าสุทธิ (USD)",
}


# ── Per-page overrides ─────────────────────────────────────────────────────────
# Layered ON TOP of TRANSLATIONS_TH above. Each key is a page namespace (bound in
# the page/figure module via ``t = make_t("<namespace>")``); each value is a
# SPARSE dict — put a string here only when this page needs different Thai wording
# than the shared base. Anything absent falls through to TRANSLATIONS_TH, then to
# English. Add entries page by page without touching the shared dict.
TRANSLATIONS_TH_BY_PAGE: dict[str, dict[str, str]] = {
    # ── Home ───────────────────────────────────────────────────────────────────
    "home": {},
    # ── Money Flow ─────────────────────────────────────────────────────────────
    "flow": {},
    # ── Income / Expense ───────────────────────────────────────────────────────
    "pie": {},
    # ── Transactions (list + edit) ─────────────────────────────────────────────
    "transactions": {},
    # ── Budget ─────────────────────────────────────────────────────────────────
    "budget": {},
    # ── Financial Goals ────────────────────────────────────────────────────────
    "goals": {},
    # ── Income Tax ─────────────────────────────────────────────────────────────
    "income_tax": {},
    # ── Retirement Planning / Compound ─────────────────────────────────────────
    "compound": {},
    # ── Investing Simulator ────────────────────────────────────────────────────
    "invest": {},
    # ── Paper Trading ──────────────────────────────────────────────────────────
    "paper": {},
    # ── Stock Intrinsic Valuation ──────────────────────────────────────────────
    "valuation": {},
    # ── Account Settings ───────────────────────────────────────────────────────
    "settings": {},
    # ── Backup & Restore ───────────────────────────────────────────────────────
    "backup": {},
    # ── Import Data ────────────────────────────────────────────────────────────
    "import": {},
    # ── Manage accounts & categories ───────────────────────────────────────────
    "manage": {},
    # ── Reconcile Balances ─────────────────────────────────────────────────────
    "reconcile": {},
    # ── Remove Transactions ────────────────────────────────────────────────────
    "remove": {},
}
