"""สร้างรายงาน Audit (HTML ภาษาไทย 13 หัวข้อ) จากผลทดสอบจริงใน unit-results.json / ui-results.json / db-results.json
ใช้:  python3 audit/dose/build_report.py  → audit/dose/report.html
"""
import json, html, pathlib, subprocess

D = pathlib.Path(__file__).parent
E = lambda s: html.escape(str(s if s is not None else ""))
commit = subprocess.run(["git", "rev-parse", "--short", "e5ff4a6"], capture_output=True, text=True, cwd=D).stdout.strip() or "e5ff4a6"

PRE = {"unit": "Node 22 · โหลด js/pages/dose.js (ตัด import) · ไม่มี DOM · สูตรอ้างอิงเขียนแยกใน unit.mjs",
       "ui": "Chromium (Playwright) · Supabase จำลอง (tests/ui/mock_supabase.js) · ยาสังเคราะห์ AUDIT-…",
       "db": "Postgres ในเครื่อง ฐาน audit_dose จาก supabase/*.sql · คำตอบ openFDA/RxNorm/Gemini จำลอง"}


def norm_unit(c):
    return dict(id=c["id"], suite="unit", fn=c.get("fn"), title=c.get("input"), input=c.get("input"), expected=c.get("expected"), unit=c.get("unit"),
                ref=c.get("ref"), rationale=(c.get("why") or "") + (" · " + c["note"] if c.get("note") else ""), actual=c.get("actual"), result=c.get("status"), risk=c.get("risk"))


cases = [norm_unit(c) for c in json.load(open(D / "unit-results.json"))]
for name in ("ui", "db"):
    for c in json.load(open(D / f"{name}-results.json"))["cases"]:
        cases.append(dict(suite=name, **{k: c.get(k) for k in ("id", "fn", "title", "input", "expected", "unit", "ref", "rationale", "actual", "result", "risk")}))
BY = {c["id"]: c for c in cases}
cnt = lambda r, xs=cases: sum(1 for c in xs if c["result"] == r)


def chip(r):
    return f'<span class="chip r-{E(r).lower()}">{E(r)}</span>'


def risk(r):
    return f'<span class="sev s-{E(r).lower()}">{E(r)}</span>'


def refs(ids):
    return " ".join(f'<a href="#tc-{E(i)}" class="tref">{E(i)}</a>{chip(BY[i]["result"]) if i in BY else ""}' for i in ids)


# ---------- ข้อค้นพบ ----------
F = [
 ("F-01", "Critical", "ประเมินไตไม่สำเร็จแต่ระบบแสดงผลเหมือนไตปกติ", "js/pages/dose.js:228–245 (let renal = 'normal' · kidney() คืน msg)",
  ["UI-08a", "UI-08b", "UI-08c"],
  "ติ๊ก “คำนวณการทำงานของไต” → ไม่กรอก Cr (หรืออายุ/ส่วนสูงเด็ก) → กรอกน้ำหนัก 60 กก. → ผลคำนวณแสดงขนาดยาเต็ม ไม่มีกล่องเตือน มีเพียงข้อความเล็กสีจาง “กรอกค่า Serum creatinine”",
  "ผู้ใช้เข้าใจว่าตรวจไตแล้วและขนาดยาเหมาะกับไต (ฝ่าข้อกำหนด 3.3)", "สูง (ทำซ้ำได้ในเบราว์เซอร์)",
  "แยกสถานะไต 'unknown' ออกจาก 'normal' · แสดงกล่องเตือน “ยังประเมินไตไม่ได้: <เหตุผล>” · ระบุว่าตัวเลขยังไม่ได้ปรับตามไต · ห้ามแสดงข้อความ “ไม่จำเป็นต้องปรับขนาดยา”",
  "UI-08a/b/c ต้องเป็น PASS · UI-12 ยัง PASS"),
 ("F-02", "Critical", "ขนาดยาแบบ “ต่อวัน ÷ จำนวนครั้ง” ไม่ถูกจำกัดด้วยขนาดสูงสุดต่อครั้ง (cap)", "js/pages/dose.js:192–201 (cap ใช้เฉพาะ per ≠ day)",
  ["UI-03"], "ข้อบ่งใช้ 30 มก./กก./วัน แบ่ง 3 ครั้ง cap 500 มก. · น้ำหนัก 60 กก. → แสดง 600 มก./ครั้ง",
  "เกินขนาดสูงสุดต่อครั้งที่ผู้ดูแลกรอกไว้ โดยไม่มีคำเตือน", "สูง (ทำซ้ำได้)",
  "ใช้ cap กับขนาดต่อครั้งหลังหาร + แสดงว่า “ถูกจำกัดที่ขนาดสูงสุด” · เพิ่มขนาดสูงสุดต่อวัน", "UI-03 PASS · UI-01/02/19 ยัง PASS"),
 ("F-03", "Critical", "ยาสูตรผสมที่อ่านความแรงจากชื่อ (“400/80 MG”) ได้เลขตัวหลังเป็นความแรงเดี่ยว", "js/pages/dose.js:60–67 strengthOf() (regex ชื่อยา)",
  ["ST-04", "ST-05", "UI-15", "UI-15b"],
  "ยา รพ.สต. ชื่อ “… 400/80 MG” TAB ที่ยังไม่กรอกสารสำคัญ → ความแรง 80 มก./เม็ด · ข้อบ่งใช้คิดจาก Sulfamethoxazole 80 มก. → 1.00 เม็ด (ที่ถูก 0.20 เม็ด = เกิน 5 เท่า)",
  "จำนวนเม็ดผิดหลายเท่าในยาสูตรผสม (ข้อกำหนด 3.5 ห้ามพึ่งการอ่านชื่อ)", "สูง (ทำซ้ำได้ · ข้อมูลจริงมี co-trimoxazole ที่กรอกสารแล้ว แต่ยาที่ยังไม่กรอกจะเข้าทางนี้)",
  "ชื่อที่มีรูปแบบ “ตัวเลข/ตัวเลข MG” → ไม่คืนความแรง (บังคับกรอก ingredients) · พิจารณาเลิกอ่านความแรงจากชื่อทั้งหมด ให้ผู้ดูแลยืนยันค่า", "ST-04/05, UI-15/15b PASS · ST-01/02/06/10/11 ยัง PASS"),
 ("F-04", "Critical", "ปุ่ม “ตรวจแล้ว · แสดง” อนุมัติร่าง AI คลิกเดียว ไม่ผ่านการตรวจข้อมูล และไม่บันทึกผู้อนุมัติ", "js/pages/admin-settings.js:437–439 (onDrugList) · supabase/01:668 (indications ไม่มี check)",
  ["UI-20", "DB-05", "DB-08"],
  "ร่าง per=day min=20 max=10 ไม่มี times → ผู้ดูแลกดปุ่มในรายการ → active=true (ฐานข้อมูลรับ) · ไม่มี reviewed_by/approved_at",
  "ข้อมูลขนาดยาที่ไม่สมบูรณ์/ขัดแย้งขึ้นหน้าคำนวณสาธารณะได้ · ตรวจย้อนหลังไม่ได้ว่าใครอนุมัติ", "สูง (ทำซ้ำได้ทั้งหน้าเว็บและฐานข้อมูล)",
  "ให้อนุมัติได้ทางฟอร์มตรวจ (readInds) เท่านั้น · เพิ่ม check/trigger ตรวจ indications ในฐานข้อมูล · เพิ่ม approved_by/approved_at", "UI-20, DB-05, DB-08 PASS · DB-01..04 ยัง PASS"),
 ("F-05", "Critical", "AI pipeline ไม่ตรวจว่า quote/หน่วยที่ AI ตอบ มีอยู่จริงในฉลาก", "supabase/66_combo_drugs.sql ai_dose_step (ส่วนแปลงคำตอบ AI)",
  ["AI-01", "AI-02"],
  "ฉลาก 25 mg/kg/day · AI ตอบ 50 พร้อม quote ที่แต่งขึ้น → ร่างรับไว้ · AI ตอบ unit=mg แต่ quote เป็น mcg/kg → เก็บเป็น มก.",
  "ร่างผิด 2 เท่า หรือ 1000 เท่า ดูน่าเชื่อเพราะมี “ข้อความจากฉลาก” · พึ่งการตรวจของคนเพียงชั้นเดียว (และชั้นนั้นข้ามได้ตาม F-04)", "สูง (จำลองคำตอบ AI)",
  "ตรวจ quote เป็นข้อความย่อยของฉลาก (ปรับช่องว่าง/ตัวพิมพ์) · ตรวจตัวเลข min/max/หน่วยอยู่ใน quote · ไม่ผ่าน = ไม่รับข้อนั้น + บอกเหตุผล", "AI-01, AI-02 PASS · AI-04/05/09 ยัง PASS"),
 ("F-06", "High", "ขนาดยาเล็กถูกปัดเป็น 0.0 มก.", "js/pages/dose.js:120 rng() · :218 (ทศนิยม 1 ตำแหน่งเมื่อ < 10)", ["UI-05"],
  "0.01 มก./กก. × 3 กก. → “0.0 มก.”", "ผู้ใช้เห็นขนาดเป็นศูนย์หรืออ่านผิด (ข้อกำหนด 3.5)", "สูง (ทำซ้ำได้)",
  "แสดงตามเลขนัยสำคัญ (เช่น 3 หลัก) หรือแปลงเป็น mcg เมื่อ < 1 มก.", "UI-05 PASS"),
 ("F-07", "High", "ข้อบ่งใช้ “ต่อวัน” ที่ไม่มีจำนวนครั้ง ถูกแสดงเป็น “วันละครั้ง”", "js/pages/dose.js:198–200 (n = i.times || 1) · supabase/67 ai_dose_convert",
  ["UI-04", "AI-08"], "ร่าง AI per=day ไม่มี times → อนุมัติด้วยปุ่มเดียว (F-04) → หน้าคำนวณแสดง 200 มก. “ต่อวัน (วันละครั้ง)”",
  "ผู้ใช้อาจให้ขนาดรวมทั้งวันในครั้งเดียว", "สูง (ทำซ้ำได้)",
  "ไม่แสดงขนาดเมื่อไม่มีจำนวนครั้ง + ข้อความ “ข้อมูลไม่ครบ” · convert ติดธงหรือไม่รับข้อนั้น", "UI-04, AI-08 PASS"),
 ("F-08", "High", "ไม่ตรวจช่วงค่าที่เป็นไปได้ของข้อมูลผู้ป่วย และไม่มีหน่วย µmol/L", "js/pages/dose.js:124–155 kidney(), :176 render() · index.html:154, 173",
  ["CG-10", "CG-11", "UI-06c", "UI-09", "UI-10"],
  "อายุ 150 ปี → CrCl ติดลบถูกจัดเป็น “ไตเสื่อมรุนแรง” · Cr 88 (µmol/L) → CrCl ≈ 0.8 · น้ำหนัก 500 กก. คำนวณได้ปกติ",
  "พิมพ์ผิดหรือใส่หน่วยผิดกลายเป็นคำแนะนำทางคลินิก", "สูง (ทำซ้ำได้)",
  "กำหนดช่วงอายุ/น้ำหนัก/ส่วนสูง/Cr ที่รับได้ · ปฏิเสธผลติดลบ · ตัวเลือกหน่วย มก./ดล. ⇄ µmol/L (÷ 88.4)", "CG-10, CG-11, UI-06c, UI-09, UI-10 PASS"),
 ("F-09", "High", "ข้อมูลขนาดยาไม่มีช่วงอายุ ช่องทางให้ยา และขนาดสูงสุดต่อวัน", "supabase/01_schema_and_seed.sql:668 · indications jsonb (ไม่มี age/route/max_day)",
  ["UI-07", "DB-10"], "ผู้ใหญ่ 70 กก. กับข้อบ่งใช้ 50 มก./กก. ที่ไม่มี cap → 3500 มก. ไม่มีคำเตือน",
  "ผู้ใหญ่/วัยรุ่นได้ขนาดตามน้ำหนักเกินขนาดผู้ใหญ่ (ข้อกำหนด 3.4)", "สูง",
  "เพิ่ม age_min/age_max, max_per_day, adult_max ใน indications + บังคับกรอกเมื่อ per=มก./กก. · คำนวณเฉพาะกลุ่มที่ตรง", "UI-07, DB-10 PASS"),
 ("F-10", "High", "ระดับไตไม่เปลี่ยนตัวเลขขนาดยา (คำแนะนำไตเป็นข้อความอิสระ)", "js/pages/dose.js:236–243",
  ["UI-13"], "เลือกไตเสื่อมรุนแรง → ยังแสดง 600 มก. เป็นผลหลัก + ข้อความโรคไตด้านล่าง",
  "ตัวเลขเด่นกว่าคำเตือน ผู้ใช้อาจใช้ตัวเลขปกติ", "สูง",
  "ระบุบนตัวเลขว่า “ขนาดปกติ — ยังไม่ปรับตามไต” จนกว่าจะมีกฎปรับขนาดแบบมีโครงสร้าง (ช่วง CrCl → ลด %/ยืดเวลา)", "UI-13 PASS"),
 ("F-11", "High", "ค้นฉลาก openFDA ใช้ผลแรกผลเดียว ไม่กรองช่องทางให้ยา", "supabase/50_ai_dose.sql:49–56 ai_dose_fda() (limit 1)",
  ["AI-07"], "URL คำขอ: …label.json?limit=1&search=openfda.generic_name.exact:\"…\" (ไม่มี route)",
  "AI อาจร่างขนาดยาจากฉลากยาฉีด/ยาทาของสารเดียวกัน", "สูง (อ่านจาก URL คำขอจริงในฐานทดสอบ)",
  "เพิ่ม route:ORAL + ดึงหลายฉลากให้ผู้ดูแลเลือก + แสดงชื่อฉลากที่ใช้ในกล่องตรวจ", "AI-07 PASS"),
 ("F-12", "High", "ไม่มีเพดานความสมเหตุสมผลของตัวเลขขนาดยา (AI และผู้ดูแล)", "supabase/66 ai_dose_step (ตรวจแค่เป็นตัวเลข, max ≥ min) · dose_drugs.indications",
  ["AI-03", "DB-06"], "AI ตอบ 5000 มก./กก./ครั้ง → รับไว้ · ผู้ดูแลบันทึก min −5 / max 100000 ได้ (ฐานข้อมูลไม่ตรวจ)",
  "ตัวเลขผิดหลักหน่วยขึ้นหน้าคำนวณได้", "สูง",
  "check ในฐานข้อมูล (min ≥ 0, max ≤ เพดานต่อหน่วย, times 1–12) + ธงเตือนค่าผิดปกติในกล่องตรวจ", "AI-03, DB-06 PASS"),
 ("F-13", "High", "ไม่มีประวัติการแก้ไข/รุ่นข้อมูลของขนาดยา", "write_audit() ผูกเฉพาะ patients/visits ฯลฯ (ไม่รวม dose_drugs/local_drugs)",
  ["DB-07", "DB-08", "DB-09"], "ผู้ดูแลแก้ indications ของยาที่แสดงอยู่ → audit_log ไม่เพิ่ม · ไม่มีตารางประวัติ",
  "ย้อนดูไม่ได้ว่าตัวเลขเปลี่ยนเมื่อไร/โดยใคร/จากค่าใด", "สูง",
  "trigger บันทึกประวัติ (ค่าเดิม + ผู้แก้ + เวลา) ของ dose_drugs และความแรง/สารสำคัญใน local_drugs", "DB-07, DB-08, DB-09 PASS"),
 ("F-14", "Medium", "Cockcroft-Gault ยังให้ตัวเลขในเด็ก (มีแค่หมายเหตุ)", "js/pages/dose.js:154", ["CG-12"],
  "เด็ก 10 ปี → CrCl 108 มล./นาที พร้อมหมายเหตุเล็ก", "ใช้สูตรผู้ใหญ่กับเด็ก", "สูง",
  "อายุ < 18 ปี ไม่คำนวณ CG ให้ใช้ eGFR (Schwartz) เท่านั้น", "CG-12 PASS"),
 ("F-15", "Medium", "Bedside Schwartz ใช้กับทารก < 1 ปี", "js/pages/dose.js:127–131", ["EG-06"],
  "ทารก 3 เดือน → eGFR 82.6 ไม่มีคำเตือน", "สูตรพัฒนาจากเด็ก CKD อายุ 1–16 ปี (Schwartz 2009)", "ปานกลาง",
  "อายุ < 1 ปี: ไม่คำนวณหรือเตือนชัดเจน", "EG-06 PASS"),
 ("F-16", "Medium", "eGFR (ต่อ 1.73 ตร.ม.) ใช้เกณฑ์เดียวกับ CrCl และข้อความ “ไม่จำเป็นต้องปรับขนาดยา” ใช้กับทุกยา", "js/pages/dose.js:235, 245",
  ["UI-11"], "eGFR 91.7 → “การทำงานของไตปกติ (≥ 60) — ไม่จำเป็นต้องปรับขนาดยา”",
  "เกณฑ์ปรับขนาดยาเป็นรายยา และฉลากส่วนใหญ่อิง CrCl", "ปานกลาง (ต้องมีแหล่งอ้างอิงรายยา)",
  "เปลี่ยนข้อความเป็นกลาง + ระบุว่าเกณฑ์อิง CrCl/eGFR · ระยะยาวเก็บเกณฑ์ไตรายยา", "UI-11 ต้องมีผู้เชี่ยวชาญยืนยันค่าคาดหวัง"),
 ("F-17", "Medium", "AI pipeline ไม่ติดธงฉลากเก่า", "supabase/66 ai_dose_step · 67 dose_ref()", ["AI-06"],
  "ฉลาก effective_time 1999 → ร่างปกติ (วันที่อยู่ในชื่อที่มาเท่านั้น)", "ใช้ขนาดยาจากฉลากที่ล้าสมัย", "ปานกลาง",
  "ติดธง “ฉลากเก่ากว่า N ปี” ในกล่องตรวจ (N ให้เภสัชกรกำหนด)", "AI-06 PASS"),
 ("F-18", "Medium", "ข้อมูลคำนวณผูกกับยา รพ.สต. ด้วยการจับคู่ชื่ออัตโนมัติ", "js/pages/dose.js:331–334 (ไม่มี dose_id → ใช้ชื่อจาก monograph)", [],
  "ยาที่ชื่อสามัญตรงกันแต่รูปแบบ/ข้อบ่งใช้ต่างกัน ได้ข้อมูลคำนวณชุดเดียวกัน", "ข้อบ่งใช้/ความแรงไม่ตรงรูปแบบยา", "ปานกลาง (อ่านโค้ด · ยังไม่ได้ทดสอบกับข้อมูลจริง = UNVERIFIED)",
  "แสดงเฉพาะยาที่ผู้ดูแลผูก dose_id แล้ว หรือแสดงป้าย “จับคู่อัตโนมัติ”", "เพิ่มกรณีทดสอบ UI ใหม่หลังได้รายการยาที่ควรแยก"),
 ("F-19", "Medium", "จำนวนเม็ดแสดงทศนิยม 2 ตำแหน่ง (เช่น 0.33 เม็ด)", "js/pages/dose.js:217", ["UI-18"],
  "5 มก./กก. × 10 กก. ÷ เม็ด 150 มก. → 0.33 เม็ด", "แบ่งเม็ดจริงไม่ได้", "ปานกลาง (ต้องมีนโยบายการแบ่งเม็ด)",
  "ปัดเป็นสัดส่วนที่แบ่งได้ (½, ¼) ตามนโยบายที่เภสัชกรกำหนด + บอกขนาดที่ได้จริงหลังปัด", "UI-18 ต้องมีนโยบายก่อน"),
 ("F-20", "Low", "ความแรงยาน้ำ “X MG/ML” ที่ไม่มีเลขหน้า ML อ่านไม่ได้", "js/pages/dose.js:64", ["ST-03"],
  "“X 100 MG/ML 15 ML” → ไม่มีความแรง (ยาใช้คำนวณ มล. ไม่ได้)", "ทิศทางปลอดภัย (ไม่แสดงปริมาตร) แต่ยาใช้งานไม่ได้", "สูง",
  "ให้ผู้ดูแลกรอกความแรงเชิงโครงสร้าง (แก้ร่วมกับ F-03)", "ST-03 PASS หรือยอมรับเป็นข้อจำกัด"),
 ("F-21", "Medium", "IBW (Devine) ในคนเตี้ยมากได้ค่าต่ำผิดปกติ", "js/pages/dose.js:143", ["CG-13"],
  "ผู้ใหญ่ชายสูง 100 ซม. 80 กก. → IBW ≈ 2.6 กก. → ใช้ AdjBW ≈ 33.5 กก. → CrCl 37.3 (ไม่มีคำเตือน)", "สูตรไม่ได้ออกแบบสำหรับส่วนสูง < 152 ซม.", "ปานกลาง (ไม่มีมาตรฐานเดียวที่ยืนยันได้)",
  "เตือนเมื่อส่วนสูง < 152 ซม. หรือใช้น้ำหนักจริงแทน (ให้เภสัชกรเลือก)", "CG-13 ต้องมีแหล่งอ้างอิง"),
]
SEVORD = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}

# ---------- HTML ----------
css = """
:root{--bg:#f5f7f7;--panel:#ffffff;--ink:#14232a;--muted:#5a6b72;--line:#d9e1e3;--accent:#0b6e74;--accent-soft:#e3f1f1;
--crit:#b3261e;--crit-bg:#fbe9e7;--high:#b45309;--high-bg:#fdf0e1;--med:#7a6400;--med-bg:#f8f2d4;--low:#3d6b3d;--low-bg:#e7f2e5;
--pass:#1f6f43;--pass-bg:#e2f3e8;--fail:#b3261e;--fail-bg:#fbe9e7;--unv:#5b4a9a;--unv-bg:#ece8f8;
--f-head:"IBM Plex Sans Thai",system-ui,sans-serif;--f-body:"Sarabun","IBM Plex Sans Thai",system-ui,sans-serif;--f-mono:"IBM Plex Mono",ui-monospace,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f1719;--panel:#152125;--ink:#e3ecee;--muted:#9db0b6;--line:#2a3a3f;--accent:#5cc2c7;--accent-soft:#17343a;
--crit:#ff8a80;--crit-bg:#3a1a18;--high:#f5a35b;--high-bg:#3a2612;--med:#e3cb5a;--med-bg:#33300f;--low:#9fd19a;--low-bg:#1c3220;
--pass:#7fd6a2;--pass-bg:#14301f;--fail:#ff8a80;--fail-bg:#3a1a18;--unv:#b9a8f5;--unv-bg:#271f42;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0f1719;--panel:#152125;--ink:#e3ecee;--muted:#9db0b6;--line:#2a3a3f;--accent:#5cc2c7;--accent-soft:#17343a;
--crit:#ff8a80;--crit-bg:#3a1a18;--high:#f5a35b;--high-bg:#3a2612;--med:#e3cb5a;--med-bg:#33300f;--low:#9fd19a;--low-bg:#1c3220;
--pass:#7fd6a2;--pass-bg:#14301f;--fail:#ff8a80;--fail-bg:#3a1a18;--unv:#b9a8f5;--unv-bg:#271f42;color-scheme:dark}
body{background:var(--bg);color:var(--ink);font:16px/1.7 var(--f-body)}
.wrap{max-width:1080px;margin:0 auto;padding-block:28px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:28px}
h1,h2,h3{font-family:var(--f-head);text-wrap:balance;line-height:1.3;margin:0}
h1{font-size:1.9rem}h2{font-size:1.35rem;display:flex;gap:.6rem;align-items:baseline}h2 .no{color:var(--accent);font-family:var(--f-mono);font-size:1rem}
h3{font-size:1.05rem;margin-top:.4rem}
p{margin:0;max-width:72ch}.muted{color:var(--muted)}.small{font-size:.88rem}
header.top{display:grid;gap:10px;border-bottom:2px solid var(--ink);padding-bottom:18px}
.eyebrow{font:600 .78rem/1 var(--f-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
.meta{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:.88rem;color:var(--muted)}
section{display:grid;gap:12px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px;display:grid;gap:10px;min-width:0}
.verdict{border-left:6px solid var(--crit);background:var(--crit-bg)}
.tally{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.tally div{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.tally b{display:block;font:600 1.6rem/1.1 var(--f-mono);font-variant-numeric:tabular-nums}
.tally span{font-size:.85rem;color:var(--muted)}
.chip{display:inline-block;font:600 .72rem/1 var(--f-mono);padding:4px 7px;border-radius:4px;letter-spacing:.03em;white-space:nowrap}
.r-pass{color:var(--pass);background:var(--pass-bg)}.r-fail{color:var(--fail);background:var(--fail-bg)}.r-unverified{color:var(--unv);background:var(--unv-bg)}
.sev{display:inline-block;font:600 .72rem/1 var(--f-head);padding:4px 8px;border-radius:999px;white-space:nowrap}
.s-critical{color:var(--crit);background:var(--crit-bg)}.s-high{color:var(--high);background:var(--high-bg)}.s-medium{color:var(--med);background:var(--med-bg)}.s-low{color:var(--low);background:var(--low-bg)}
.tw{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
table{border-collapse:collapse;width:100%;font-size:.86rem}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}
th{font-family:var(--f-head);font-weight:600;background:var(--accent-soft);position:sticky;top:0}
tr:last-child td{border-bottom:0}
td.mono,code{font-family:var(--f-mono);font-size:.82rem}
.cases td{min-width:110px}.cases td:first-child{min-width:70px;white-space:nowrap}
.finding{border-left:5px solid var(--line)}
.finding.s-critical-b{border-left-color:var(--crit)}.finding.s-high-b{border-left-color:var(--high)}.finding.s-medium-b{border-left-color:var(--med)}.finding.s-low-b{border-left-color:var(--low)}
.finding .hd{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.finding .hd b{font-family:var(--f-mono)}
dl{display:grid;grid-template-columns:minmax(110px,max-content) 1fr;gap:4px 14px;margin:0;font-size:.9rem}
dt{color:var(--muted)}dd{margin:0;min-width:0}
.tref{font-family:var(--f-mono);font-size:.8rem;color:var(--accent);margin-right:2px}
a{color:var(--accent)}a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
ul,ol{margin:0;padding-left:1.3rem;display:grid;gap:4px}
details>summary{cursor:pointer;font-family:var(--f-head);font-weight:600}
.stages{counter-reset:s}
@media (max-width:560px){.tally div:last-child{grid-column:1/-1}dl{grid-template-columns:1fr}dt{margin-top:6px}h1{font-size:1.5rem}}
"""


def table(rows, cols, cls=""):
    h = "".join(f"<th>{E(c)}</th>" for c in cols)
    return f'<div class="tw"><table class="{cls}"><thead><tr>{h}</tr></thead><tbody>' + "".join(rows) + "</tbody></table></div>"


def case_rows(ids_or_cases):
    out = []
    for c in ids_or_cases:
        c = BY[c] if isinstance(c, str) else c
        out.append(f'<tr id="tc-{E(c["id"])}"><td class="mono">{E(c["id"])}</td><td class="mono">{E(c["fn"])}</td><td>{E(c["input"] or c["title"])}</td>'
                   f'<td>{E(PRE[c["suite"]])}</td><td>{E(c["expected"])}</td><td>{E(c["unit"])}</td><td>{E(c["ref"])}</td><td>{E(c["rationale"])}</td>'
                   f'<td>{E(c["actual"])}</td><td>{chip(c["result"])}</td><td>{risk(c["risk"])}</td></tr>')
    return out


CASECOLS = ["ID", "ฟังก์ชัน", "Input", "เงื่อนไขก่อนทดสอบ", "ค่าคาดหวัง", "หน่วย", "แหล่งอ้างอิง", "เหตุผล", "ผลจริง", "ผล", "ความเสี่ยง"]


def short_rows(ids):
    return table([f'<tr><td class="mono"><a href="#tc-{E(i)}">{E(i)}</a></td><td>{E(BY[i]["title"] or BY[i]["input"])}</td><td>{E(BY[i]["expected"])}</td><td>{E(BY[i]["actual"])}</td><td>{chip(BY[i]["result"])}</td></tr>' for i in ids],
                 ["ID", "กรณี", "ค่าคาดหวัง", "ผลจริง", "ผล"])


crit = [f for f in F if f[1] == "Critical"]
n_by_sev = {s: sum(1 for f in F if f[1] == s) for s in SEVORD}

S = []
S.append(f"""<header class="top"><span class="eyebrow">Audit Report · Phase 1 · ตรวจอย่างเดียว</span>
<h1>รายงานตรวจสอบเครื่องคำนวณขนาดยา</h1>
<p class="muted">ระบบ Primary Care Pharmacy Services (รพ.ควนกาหลง และ รพ.สต. 7 แห่ง) · ส่วน “ข้อมูลยา / คำนวณขนาดยา” และข้อมูลยาเบื้องหลัง</p>
<div class="meta"><span>ตรวจวันที่ 19 ต.ค. 2569</span><span>โค้ดรุ่น <code>{E(commit)}</code> (รุ่นเดียวกับที่ขึ้นเว็บล่าสุด)</span><span>บทบาทผู้ตรวจ: Clinical Pharmacist Informatics · Software Verification · Healthcare Architecture</span><span>ผลทดสอบ {len(cases)} กรณี</span></div></header>""")

S.append(f"""<section id="s1"><h2><span class="no">1</span>Executive Summary</h2>
<div class="panel verdict"><p><b>ผลรวม: ยังไม่ผ่าน (NOT PASS)</b> — พบข้อบกพร่องระดับ Critical {n_by_sev['Critical']} ข้อ และ High {n_by_sev['High']} ข้อ ที่ทำซ้ำได้ด้วยชุดทดสอบ
ไม่สามารถสรุปว่าเครื่องคำนวณปลอดภัยสำหรับใช้ทางคลินิกจนกว่าจะแก้ข้อ Critical/High และรันชุดทดสอบซ้ำผ่านตามเกณฑ์หัวข้อ 13</p></div>
<div class="tally"><div><b>{len(cases)}</b><span>กรณีทดสอบที่รันจริง</span></div><div><b style="color:var(--pass)">{cnt('PASS')}</b><span>PASS</span></div>
<div><b style="color:var(--fail)">{cnt('FAIL')}</b><span>FAIL</span></div><div><b style="color:var(--unv)">{cnt('UNVERIFIED')}</b><span>UNVERIFIED (ไม่มีแหล่งอ้างอิงยืนยัน)</span></div>
<div><b>{len(F)}</b><span>ข้อค้นพบ (C {n_by_sev['Critical']} · H {n_by_sev['High']} · M {n_by_sev['Medium']} · L {n_by_sev['Low']})</span></div></div>
<div class="panel"><h3>ประเด็น Critical</h3><ol>{''.join(f'<li><b>{E(f[0])}</b> {E(f[2])} <span class="small muted">({", ".join(f[4])})</span></li>' for f in crit)}</ol></div>
<div class="panel"><h3>ส่วนที่ทำงานถูกต้องตามที่ทดสอบ</h3><ul>
<li>สูตร Cockcroft-Gault, CKD-EPI 2021 และ Bedside Schwartz ให้ค่าตรงกับสูตรอ้างอิงที่เขียนแยก (CG-01…05, EG-01…04)</li>
<li>ปฏิเสธ Cr = 0/ติดลบ/ไม่ใช่ตัวเลข, น้ำหนัก ≤ 0, อายุว่าง (CG-06…09, UI-06a/b)</li>
<li>ขนาดยาต่อครั้งใช้ cap ถูกต้อง · แปลง mcg → มก. ถูกต้อง · ยาสูตรผสมที่กรอกสารสำคัญแล้วและไม่ระบุสารที่ใช้คิด จะไม่คิดจำนวนเม็ด (UI-01, 02, 14, 16)</li>
<li>ร่าง AI ไม่ขึ้นหน้าสาธารณะ · เจ้าหน้าที่/ประชาชนอนุมัติร่างไม่ได้ · ข้อความจากฐานข้อมูลถูก escape (UI-21, UI-22, DB-01…04, DB-11)</li>
<li>AI pipeline ส่งเฉพาะชื่อยา + ฉลากสาธารณะ ไม่มีคีย์ในเนื้อหา · API ล่ม/ตอบว่างไม่สร้างร่าง (AI-04, 05, 09)</li></ul>
<p class="small muted">PASS ข้างต้นหมายถึงผ่านกรณีที่ทดสอบเท่านั้น ไม่ใช่การรับรองความถูกต้องทางคลินิกของตัวเลขขนาดยาแต่ละตัวในฐานข้อมูลจริง (ดูหัวข้อ 11)</p></div></section>""")

S.append("""<section id="s2"><h2><span class="no">2</span>ขอบเขตที่ตรวจสอบจริง</h2><div class="panel"><ul>
<li><b>อ่านโค้ด:</b> js/pages/dose.js ทั้งไฟล์ (เครื่องคำนวณ, kidney(), strengthOf(), การผูกยา รพ.สต.), js/pages/admin-settings.js (ฟอร์ม/ตรวจ/อนุมัติ readInds, onDrugList), index.html ส่วนฟอร์มคำนวณ</li>
<li><b>อ่าน SQL:</b> 01 (dose_drugs, RLS), 50/56 (ai_dose_start, ai_dose_fda), 63 (ai_auto_tick, dose_has), 65/66 (ai_dose_step), 67 (ai_dose_convert, dose_ref), 58 (local_drugs)</li>
<li><b>ชุดทดสอบเดิม:</b> tests/ui/smoke.js (กรณีคำนวณยา), tests/rls_test.py (สิทธิ์ dose_drugs + AI dose pipeline) — ใช้เป็นฐาน ไม่ได้แก้</li>
<li><b>ประวัติ git:</b> js/pages/dose.js มี 20 commit (15–19 ต.ค. 2569) ฟีเจอร์ mcg, ยาสูตรผสม, ข้อบ่งใช้หลายข้อ, ร่าง AI เพิ่มเร็วในช่วงสั้น</li>
<li><b>ทดสอบที่รันจริง 3 ชุด:</b> unit (Node), UI (Chromium + Supabase จำลอง), DB + AI pipeline (Postgres ในเครื่อง + คำตอบ API จำลอง)</li>
<li><b>ไม่ได้แตะ:</b> ไฟล์ Production, ฐานข้อมูลจริง, การ deploy, ข้อมูลผู้ป่วย, ค่าลับ — งานทั้งหมดอยู่ในโฟลเดอร์ <code>audit/dose/</code> บน branch ในเครื่อง <code>audit/dose-calc</code> (ไม่ push)</li></ul></div></section>""")

files = [("js/pages/dose.js", "strengthOf() :60 · fillConc()/conc() :88–113 · indsOf() :116 · rng() :120 · kidney() :124 · ageOf() :158 · render()/doseOf()/doseCore() :176–256 · loadInfo() การผูกยา :300–336", "เครื่องคำนวณหน้าสาธารณะ"),
         ("js/pages/admin-settings.js", "readInds() :69 · onDrugList() :432 (ปุ่ม “ตรวจแล้ว · แสดง”) · saveReview (กล่องร่างรอตรวจ)", "ผู้ดูแลกรอก/ตรวจ/อนุมัติ"),
         ("index.html", ":153–173 ช่องอายุ/น้ำหนัก/ส่วนสูง/Cr (มก./ดล. อย่างเดียว)", "ฟอร์มรับข้อมูล"),
         ("supabase/01_schema_and_seed.sql", ":668 dose_drugs · policy dose_read/dose_admin · seed 5 ยา :1016", "โครงสร้าง + สิทธิ์"),
         ("supabase/50_ai_dose.sql · 56", "ai_dose_fda() · ai_dose_start() (ผู้ดูแลเท่านั้น · 100 ครั้ง/วัน) · constraint ai_draft", "ขั้นเริ่ม AI"),
         ("supabase/63_ai_auto.sql", "ai_auto_tick() · ai_dose_tick() · dose_has()", "AI อัตโนมัติ (pg_cron)"),
         ("supabase/66_combo_drugs.sql", "ai_dose_step() (prompt + แปลงคำตอบ AI)", "สกัดขนาดยาจากฉลาก"),
         ("supabase/67_dose_ref.sql", "ai_dose_convert() · dose_ref()", "สร้างร่างใน dose_drugs"),
         ("tests/ui/smoke.js · tests/rls_test.py", "กรณีคำนวณยา / สิทธิ์ / AI dose", "ชุดทดสอบเดิม")]
S.append('<section id="s3"><h2><span class="no">3</span>ไฟล์และฟังก์ชันที่ตรวจพบ</h2>' + table([f"<tr><td class='mono'>{E(a)}</td><td>{E(b)}</td><td>{E(c)}</td></tr>" for a, b, c in files], ["ไฟล์", "ฟังก์ชัน/บรรทัด", "บทบาท"]) + "</section>")

fr = []
for f in sorted(F, key=lambda x: SEVORD[x[1]]):
    fid, sev, title, loc, ev, repro, impact, conf, fix, retest = f
    fr.append(f"""<div class="panel finding s-{sev.lower()}-b" id="{E(fid)}"><div class="hd"><b>{E(fid)}</b>{risk(sev)}<span>{E(title)}</span></div>
<dl><dt>ไฟล์/บรรทัด</dt><dd><code>{E(loc)}</code></dd><dt>หลักฐาน</dt><dd>{refs(ev) if ev else '<span class="muted">อ่านโค้ด (ยังไม่มีกรณีทดสอบ)</span>'}</dd>
<dt>วิธีทำซ้ำ</dt><dd>{E(repro)}</dd><dt>ผลกระทบ</dt><dd>{E(impact)}</dd><dt>ความมั่นใจ</dt><dd>{E(conf)}</dd><dt>แนวทางแก้</dt><dd>{E(fix)}</dd><dt>ทดสอบซ้ำ</dt><dd>{E(retest)}</dd></dl></div>""")
S.append('<section id="s4"><h2><span class="no">4</span>ตารางข้อค้นพบเรียงตามความเสี่ยง</h2>'
         + table([f'<tr><td class="mono"><a href="#{E(f[0])}">{E(f[0])}</a></td><td>{risk(f[1])}</td><td>{E(f[2])}</td><td class="mono">{E(f[3])}</td><td>{refs(f[4]) if f[4] else "อ่านโค้ด"}</td></tr>' for f in sorted(F, key=lambda x: SEVORD[x[1]])],
                 ["ID", "ระดับ", "ข้อค้นพบ", "ตำแหน่ง", "หลักฐาน (กรณีทดสอบ)"])
         + '<details class="panel"><summary>รายละเอียดทุกข้อ (ไฟล์/บรรทัด · หลักฐาน · วิธีทำซ้ำ · ผลกระทบ · ความมั่นใจ · แนวทางแก้ · ทดสอบซ้ำ)</summary><div style="display:grid;gap:12px;margin-top:12px">' + "".join(fr) + "</div></details></section>")

renal_ids = [c["id"] for c in cases if c["id"].startswith(("CG-", "EG-"))] + ["UI-08a", "UI-08b", "UI-08c", "UI-09", "UI-10", "UI-11", "UI-12", "UI-13"]
S.append(f"""<section id="s5"><h2><span class="no">5</span>ผลตรวจสูตร CrCl และ eGFR</h2>
<div class="panel"><ul><li><b>Cockcroft-Gault</b> (Cockcroft & Gault, Nephron 1976): (140 − อายุ) × น้ำหนัก × 0.85 (หญิง) ÷ (72 × SCr มก./ดล.) — ตรงกับอ้างอิงทุกกรณีที่ข้อมูลถูกต้อง · การเลือกน้ำหนักตาม BMI (< 18.5 จริง · 18.5–24.9 IBW/จริงที่น้อยกว่า · ≥ 25 AdjBW 0.4) ตรงกับแนวทาง MDCalc</li>
<li><b>CKD-EPI 2021</b> (Inker et al., NEJM 2021; κ 0.7/0.9, α −0.241/−0.302, ×1.012 หญิง, 0.9938^อายุ, ไม่มีตัวแปรเชื้อชาติ) — ตรงกับอ้างอิง</li>
<li><b>Bedside Schwartz</b> (Schwartz et al., JASN 2009; 0.413 × ส่วนสูง ซม. ÷ SCr) — ตรงกับอ้างอิง แต่ใช้กับทารก &lt; 1 ปีด้วย (F-15)</li>
<li><b>การแยก CrCl/eGFR:</b> แยกสูตรได้ แต่ใช้เกณฑ์ ≥ 60 / 30–59 / 10–29 / &lt; 10 ชุดเดียวกัน และ CG ยังคำนวณในเด็ก (F-14, F-16)</li>
<li><b>หน่วย:</b> รับเฉพาะ มก./ดล. ไม่มี µmol/L และไม่ตรวจช่วงค่า (F-08)</li>
<li><b>ข้อกำหนด 3.3 (ล้มเหลวต้องไม่เท่ากับปกติ):</b> FAIL — ค่าเริ่มต้นคือ 'normal' (F-01)</li></ul></div>
{short_rows(renal_ids)}</section>""")

ped = ["UI-01", "UI-02", "UI-03", "UI-04", "UI-05", "UI-06a", "UI-06b", "UI-06c", "UI-07", "UI-19", "CG-12", "EG-04", "EG-05", "EG-06"]
S.append(f"""<section id="s6"><h2><span class="no">6</span>ผลตรวจผู้ป่วยเด็กและการคำนวณตามน้ำหนัก</h2>
<div class="panel"><ul><li>ต่อครั้ง (per = dose): น้ำหนัก × มก./กก. แล้วจำกัดด้วย cap — ถูกต้อง</li>
<li>ต่อวัน (per = day): น้ำหนัก × มก./กก./วัน ÷ จำนวนครั้ง — เลขคณิตถูก แต่ <b>ไม่จำกัดด้วย cap</b> (F-02) และไม่มีจำนวนครั้ง = สันนิษฐาน “วันละครั้ง” (F-07)</li>
<li>ไม่มีขนาดสูงสุดต่อวัน ไม่มีช่วงอายุของข้อบ่งใช้ ผู้ใหญ่ได้ขนาดตามน้ำหนักไม่จำกัด (F-09)</li>
<li>ค่านอกช่วง: น้ำหนัก ≤ 0 ถูกปฏิเสธ · น้ำหนัก 500 กก. ไม่เตือน (F-08) · ขนาดเล็กปัดเป็น 0.0 (F-06)</li>
<li>การประมาณน้ำหนักเด็กจาก WHO 2006 และกราฟการเจริญเติบโต: มีทดสอบใน smoke.js เดิม แต่ <b>ไม่อยู่ในขอบเขตรอบนี้</b> (ดูหัวข้อ 11)</li></ul></div>
{short_rows(ped)}</section>""")

st_ids = [c["id"] for c in cases if c["id"].startswith("ST-")] + ["UI-14", "UI-15", "UI-15b", "UI-16", "UI-17", "UI-18"]
S.append(f"""<section id="s7"><h2><span class="no">7</span>ผลตรวจความแรงและการแปลงหน่วย</h2>
<div class="panel"><ul><li>ลำดับที่ระบบใช้: สารสำคัญ (ingredients) → ความแรงที่ผู้ดูแลกรอก (strength) → <b>อ่านจากชื่อยา</b> (regex) — ทางสุดท้ายยังเปิดอยู่ (ข้อกำหนด 3.5 ไม่ให้พึ่ง)</li>
<li>mcg → มก. (÷ 1000) ถูกต้องทั้งในความแรงและขนาดยา · IU และ กรัม ไม่ถูกอ่าน (คืน null = ไม่คำนวณ ซึ่งปลอดภัย)</li>
<li>ยาสูตรผสมจากชื่อ “400/80 MG” ได้ 80 มก. (F-03) · ยาผงผสมน้ำ: ไม่มีช่องระบุ “หลังผสม” แยก — ใช้ตามชื่อ (UNVERIFIED ST-09)</li>
<li>ไม่ทราบความแรง → ตัวเลือกถูกปิด ไม่แสดง มล./เม็ด (PASS) · เม็ดแสดงทศนิยม 2 ตำแหน่ง ไม่ปัดเป็นสัดส่วนที่แบ่งได้ (F-19)</li></ul></div>
{short_rows(st_ids)}</section>""")

S.append(f"""<section id="s8"><h2><span class="no">8</span>ผลตรวจข้อบ่งใช้และฐานข้อมูลยา</h2>
<div class="panel"><ul>
<li>ข้อบ่งใช้หลายข้อต่อยา (indications jsonb) แสดงแยก ≤ 3 ข้อ ที่เหลือพับ · แบ่งให้หลายแบบ (times + times_alt) คำนวณแยกถูกต้อง (UI-19)</li>
<li>ช่องเดิม mg_per_kg_min/max มี check ในฐานข้อมูล แต่ <b>indications ที่หน้าคำนวณใช้จริงไม่มี check</b> (DB-05, DB-06) — การตรวจอยู่ที่ฟอร์ม readInds() ซึ่งปุ่มอนุมัติในรายการข้ามได้ (F-04)</li>
<li>ยาชื่อเดียวกันหลายรูปแบบ: ยา รพ.สต. หลายรายการผูกข้อมูลคำนวณชุดเดียวกันได้ (ผู้ใช้เลือกความแรงเอง) · ไม่มี dose_id ใช้การจับคู่ชื่ออัตโนมัติ (F-18) · dose_drugs.name ไม่มี unique — การเพิ่มเองซ้ำได้ (เส้นทาง AI กันซ้ำด้วย dose_has())</li>
<li>ไม่มีช่องทางให้ยา/ช่วงอายุในข้อบ่งใช้ จึงตรวจความขัดแย้ง “ชื่อเดียวกัน ต่างรูปแบบ/ข้อบ่งใช้” ไม่ได้ในระดับข้อมูล (F-09, DB-10)</li>
<li>สิทธิ์: อ่านได้เฉพาะ active (หรือผู้ดูแล) · เขียนได้เฉพาะผู้ดูแล — PASS (DB-01…04)</li>
<li>ไม่มีประวัติแก้ไข/ผู้อนุมัติ (F-13)</li></ul></div>
{short_rows(["UI-19", "UI-20", "UI-22", "DB-01", "DB-02", "DB-03", "DB-04", "DB-05", "DB-06", "DB-07", "DB-08", "DB-09", "DB-10"])}</section>""")

stages = [
 ("1 เริ่มงาน", "ai_dose_start (ผู้ดูแล · ชื่ออังกฤษ · 100/วัน) · ai_auto_tick (pg_cron ทีละ 1)", ["DB-11a", "DB-11b"], "PASS"),
 ("2 ดึงแหล่งข้อมูล", "RxNorm + openFDA ผ่าน pg_net · openFDA limit 1 ไม่กรอง route", ["AI-07"], "FAIL"),
 ("3 เตรียมข้อความ", "ตัดฉลาก dosage ≤ 12,000 ตัวอักษร (ส่วนท้ายฉลากยาวอาจหาย · ยังไม่มีกรณีทดสอบ)", [], "UNVERIFIED"),
 ("4 เรียก AI", "Gemini temperature 0 · JSON · ส่งเฉพาะชื่อยา + ฉลากสาธารณะ · คีย์อยู่ใน header", ["AI-09"], "PASS"),
 ("5 ตรวจคำตอบ AI", "ตรวจแค่ตัวเลข/max ≥ min/times 1–12 · ไม่ตรวจ quote/หน่วย/เพดาน", ["AI-01", "AI-02", "AI-03"], "FAIL"),
 ("6 ลองใหม่/ล้มเหลว", "503/429 ส่งรุ่นสำรอง · ว่าง/ล่ม = ไม่สร้างร่าง + บอกเหตุผล", ["AI-04", "AI-05"], "PASS"),
 ("7 สร้างร่าง", "dose_drugs ai_draft = true, active = false (constraint) · per=day ไม่มี times ผ่านได้", ["DB-01", "DB-04", "AI-08"], "FAIL"),
 ("8 ตรวจ/อนุมัติโดยคน", "กล่องตรวจใช้ readInds · ปุ่มในรายการอนุมัติคลิกเดียว · ไม่บันทึกผู้อนุมัติ", ["UI-20", "DB-05", "DB-08"], "FAIL"),
 ("9 หลังอนุมัติ", "แก้ได้โดยไม่มีประวัติ · ไม่ติดธงฉลากเก่า · ป้าย “ผู้ดูแลตรวจแล้ว” ยังแสดงหลังแก้", ["DB-07", "DB-09", "AI-06"], "FAIL"),
]
S.append('<section id="s9"><h2><span class="no">9</span>ผลตรวจ AI Data Pipeline</h2><div class="panel"><p>ทดสอบบนฐานข้อมูลในเครื่องด้วยคำตอบ openFDA/RxNorm/Gemini จำลอง ครอบคลุม hallucination, หน่วยผิด, ความแรง/ตัวเลขผิดปกติ, API ว่าง/ล่ม, แหล่งข้อมูลเก่า, การอนุมัติโดยไม่มีสิทธิ์ และการแก้ไขหลังอนุมัติ</p></div>'
         + table([f"<tr><td>{E(a)}</td><td>{E(b)}</td><td>{refs(c) if c else '—'}</td><td>{chip(d)}</td></tr>" for a, b, c, d in stages], ["ขั้น", "สิ่งที่ระบบทำ / ช่องโหว่", "กรณีทดสอบ", "ผลขั้นนี้"])
         + "</section>")

S.append(f"""<section id="s10"><h2><span class="no">10</span>Test Cases พร้อมผล PASS/FAIL/UNVERIFIED</h2>
<div class="panel small"><p>ค่าคาดหวังเชิงตัวเลขคิดจากสูตรอ้างอิงที่เขียนแยกจากโค้ดระบบ (unit.mjs) หรือเลขคณิตจากพารามิเตอร์สังเคราะห์ (ui.cjs) · ค่าคาดหวังเชิงความปลอดภัยมาจากข้อกำหนดในคำสั่งตรวจ · กรณีที่ไม่มีแหล่งอ้างอิงยืนยันได้ = UNVERIFIED · ข้อมูลยาในการทดสอบเป็นข้อมูลสังเคราะห์ (AUDIT-…) ไม่ใช่ข้อมูลคลินิกที่สร้างขึ้นให้ผ่าน</p>
<p>unit {len([c for c in cases if c['suite']=='unit'])} กรณี (PASS {cnt('PASS',[c for c in cases if c['suite']=='unit'])} · FAIL {cnt('FAIL',[c for c in cases if c['suite']=='unit'])} · UNVERIFIED {cnt('UNVERIFIED',[c for c in cases if c['suite']=='unit'])}) ·
UI {len([c for c in cases if c['suite']=='ui'])} กรณี (PASS {cnt('PASS',[c for c in cases if c['suite']=='ui'])} · FAIL {cnt('FAIL',[c for c in cases if c['suite']=='ui'])} · UNVERIFIED {cnt('UNVERIFIED',[c for c in cases if c['suite']=='ui'])}) ·
DB/AI {len([c for c in cases if c['suite']=='db'])} กรณี (PASS {cnt('PASS',[c for c in cases if c['suite']=='db'])} · FAIL {cnt('FAIL',[c for c in cases if c['suite']=='db'])})</p></div>
{table(case_rows(cases), CASECOLS, "cases")}</section>""")

S.append("""<section id="s11"><h2><span class="no">11</span>ข้อจำกัดของการตรวจสอบ</h2><div class="panel"><ul>
<li><b>ไม่ได้ตรวจข้อมูลจริงในฐานข้อมูล Production</b> (ไม่มีสิทธิ์เข้าถึงจากเครื่อง Claude) — ไม่ทราบว่ามีข้อบ่งใช้ที่ per=day ไม่มี times, ค่าผิดปกติ หรือยาที่ผูกด้วยชื่ออัตโนมัติอยู่จริงกี่รายการ</li>
<li><b>ไม่ได้รับรองตัวเลขขนาดยาทางคลินิก</b> ของยาแต่ละตัวในระบบ (ต้องให้เภสัชกรเทียบกับเอกสารอ้างอิง เช่น ฉลากยา/แนวทางการรักษาของไทย)</li>
<li>คำตอบ openFDA/RxNorm/Gemini เป็นข้อความจำลอง — พฤติกรรมของ API จริง (รูปแบบฉลากหลากหลาย, การตัดข้อความ 12,000 ตัวอักษร) ยังไม่ได้ทดสอบ</li>
<li>ทดสอบหน้าเว็บด้วย Chromium จอ 1280 px เท่านั้น ไม่ได้ทดสอบ Safari/มือถือจริง และใช้ Supabase จำลอง</li>
<li>ไม่อยู่ในขอบเขต: คำนวณสารน้ำ (fluid.js), Drug interaction (ddi.js), การประมาณน้ำหนัก WHO/กราฟการเจริญเติบโต, หน้าข้อมูลยา/ฉลากแปลไทย</li>
<li>UNVERIFIED 4 กรณี (CG-13, ST-09, UI-11, UI-18) รอแหล่งอ้างอิงหรือนโยบายจากเภสัชกร</li>
<li>ข้อมูลทดสอบ UI (fixtures.json) เก็บเครื่องหมาย “&lt;” เป็น “&amp;lt;” จากการส่งออก XML ของสคริปต์ทดสอบ — กระทบเฉพาะชุดทดสอบ ไม่ใช่เว็บจริง</li></ul></div></section>""")

plan = [("P0 · ก่อนใช้ทางคลินิกต่อ", ["F-01", "F-02", "F-03", "F-04", "F-05"]),
        ("P1 · ถัดไป", ["F-06", "F-07", "F-08", "F-09", "F-10", "F-11", "F-12", "F-13"]),
        ("P2 · ปรับปรุง (บางข้อรอนโยบาย/แหล่งอ้างอิง)", ["F-14", "F-15", "F-16", "F-17", "F-18", "F-19", "F-20", "F-21"])]
FM = {f[0]: f for f in F}
S.append('<section id="s12"><h2><span class="no">12</span>แผนแก้ไขเรียงตามลำดับความสำคัญ</h2><div class="panel"><p>แก้ทีละประเด็น 1 ข้อ = 1 branch ในเครื่อง (เช่น <code>fix/dose-F-01</code>) → เพิ่ม/ปรับกรณีทดสอบให้ FAIL เดิมกลายเป็น PASS → รัน <code>audit/dose/*</code> + <code>bash tests/run_all.sh</code> ทั้งหมด → ให้เจ้าของเว็บดูในหน้าตัวอย่าง → push ไป branch <code>claude/…</code> เมื่ออนุมัติเท่านั้น (branch <code>claude/…</code> จะรวมเข้า main และขึ้นเว็บเองอัตโนมัติ)</p>'
         '<p class="small muted">ระหว่างรอแก้ ควรพิจารณาแสดงข้อความเตือนบนหน้าคำนวณว่า “อยู่ระหว่างตรวจสอบ ใช้ประกอบการตัดสินใจเท่านั้น” (ต้องได้รับอนุมัติก่อน เพราะเป็นการแก้ระบบจริง)</p></div>'
         + table([f'<tr><td>{E(p)}</td><td class="mono"><a href="#{E(i)}">{E(i)}</a></td><td>{risk(FM[i][1])}</td><td>{E(FM[i][2])}</td><td>{E(FM[i][8])}</td><td>{E(FM[i][9])}</td></tr>' for p, ids in plan for i in ids],
                 ["ลำดับ", "ID", "ระดับ", "ประเด็น", "แนวทางแก้", "เกณฑ์ทดสอบซ้ำ"]) + "</section>")

S.append("""<section id="s13"><h2><span class="no">13</span>Acceptance Criteria สำหรับอนุมัติให้เริ่มแก้ไข</h2>
<div class="panel"><h3>ก่อนเริ่มแก้ (เจ้าของเว็บ/เภสัชกรยืนยัน)</h3><ol>
<li>ยอมรับรายการข้อค้นพบและระดับความเสี่ยงในหัวข้อ 4 (หรือแจ้งข้อที่ไม่เห็นด้วย)</li>
<li>ยืนยันลำดับ P0 → P1 → P2 และวิธีทำงาน 1 ประเด็นต่อ 1 branch</li>
<li>เภสัชกรกำหนดนโยบายที่ระบบต้องใช้: การปัดจำนวนเม็ด (F-19), ช่วงค่าที่รับได้ของอายุ/น้ำหนัก/Cr (F-08), เพดานขนาดยาต่อ กก. (F-12), อายุฉลากที่ถือว่าเก่า (F-17), การใช้ IBW ในคนเตี้ย (F-21)</li>
<li>อนุมัติว่าการแก้ F-04/F-09/F-12/F-13 ต้องเพิ่มคอลัมน์/ตาราง/trigger ในฐานข้อมูล (SQL ไฟล์ใหม่ เพิ่มอย่างเดียว ไม่ลบข้อมูล)</li>
<li>ผู้ดูแลตรวจข้อมูลขนาดยาจริงที่แสดงอยู่ทุกตัว (ระบบจะช่วยทำรายการข้อบ่งใช้ที่ไม่มีจำนวนครั้ง/ไม่มี cap/ค่าผิดปกติให้ตรวจ หลังได้รับอนุมัติ)</li></ol></div>
<div class="panel"><h3>ก่อนสรุปว่า PASS และนำขึ้น Production</h3><ol>
<li>กรณี FAIL ระดับ Critical และ High ทุกข้อในรายงานนี้ เปลี่ยนเป็น PASS เมื่อรันชุดทดสอบ audit ซ้ำ</li>
<li>กรณีที่ PASS อยู่แล้วยังคง PASS (ไม่มีการถดถอย) และ <code>bash tests/run_all.sh</code> ผ่านทั้งหมด</li>
<li>กรณี UNVERIFIED ได้ค่าคาดหวังจากแหล่งอ้างอิงที่เภสัชกรยืนยัน แล้วจึงตัดสิน PASS/FAIL</li>
<li>เภสัชกรตรวจหน้าตัวอย่างและลงความเห็นว่าข้อความเตือน/ผลคำนวณสื่อความถูกต้อง</li>
<li>หลังขึ้นเว็บ ตรวจเว็บจริงว่าเป็นรุ่นใหม่ และไม่มีข้อมูลขนาดยาที่ผิดเงื่อนไขใหม่ค้างอยู่</li></ol>
<p class="small muted">การอ่านโค้ดเพียงอย่างเดียวไม่ใช้เป็นเหตุผลในการสรุป PASS</p></div></section>""")

page = f"""<title>Audit เครื่องคำนวณขนาดยา</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans+Thai:wght@500;600&family=Sarabun:wght@400;600&display=swap">
<style>{css}</style>
<main class="wrap">{''.join(S)}</main>"""
(D / "report.html").write_text(page, encoding="utf-8")
print("report.html", len(page), "bytes ·", len(cases), "cases ·", len(F), "findings ·", cnt("PASS"), cnt("FAIL"), cnt("UNVERIFIED"))
