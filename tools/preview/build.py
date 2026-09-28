#!/usr/bin/env python3
"""สร้าง "หน้าตัวอย่าง" ของเว็บ สำหรับเจ้าของเว็บดูและ comment ได้ทุกอุปกรณ์ (Claude Artifact)

ใช้:  python3 tools/preview/build.py [โฟลเดอร์ปลายทาง]      (ค่าเริ่มต้น _preview/ — อยู่ใน .gitignore)
ได้:  index.html   หน้าหลักสำหรับ publish (ไม่มี <html>/<head>/<body> — ระบบ Artifact ครอบให้เอง)
      local.html   หน้าเดียวกันแบบเต็ม ไว้เปิดทดสอบในเครื่อง (tests/ui/smoke.js)
      assets/ js/ fixtures.json   ไฟล์ประกอบ (publish ผ่าน files)

ความปลอดภัย / PDPA:
- ใช้ Supabase จำลอง (tests/ui/mock_supabase.js) + ข้อมูลสมมติ (tests/ui/fixtures.json) เท่านั้น ไม่แตะข้อมูลจริง
- เปลี่ยนชื่อโรงพยาบาล อำเภอ จังหวัด รพ.สต. และเบอร์โทรจริงเป็นชื่อสมมติ แล้วตรวจซ้ำว่าไม่หลุด
"""
import json
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "_preview"

# ชื่อจริง → ชื่อสมมติ (ยาวก่อนสั้น)
NAMES = [
    ("โรงพยาบาลควนกาหลง", "โรงพยาบาลตัวอย่าง"), ("ควนกาหลง", "ตัวอย่าง"),
    ("จังหวัดสตูล", "จังหวัดตัวอย่าง"), ("จ.สตูล", "จ.ตัวอย่าง"), ("สตูล", "ตัวอย่าง"),
    ("074-752-081", "0xx-xxx-xxx"),
]
UNIT_ALIAS = "หน่วยที่ {}"            # รพ.สต. จริงทุกแห่ง → "หน่วยที่ 1…7"
FORBIDDEN = re.compile(r"ควนกาหลง|สตูล|074-752-081")

ROLE_BAR = """<title>ตัวอย่างเว็บเภสัชปฐมภูมิ</title>
<style>
.pv-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:8px 16px;background:var(--sunken);border-bottom:1px solid var(--line);color:var(--ink);font:500 13px/1.4 'IBM Plex Sans Thai','IBM Plex Sans',system-ui,sans-serif}
.pv-bar b{font-weight:700;color:var(--primary)}
.pv-bar .pv-roles{display:flex;flex-wrap:wrap;gap:6px}
.pv-bar button{appearance:none;min-height:36px;padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:inherit;cursor:pointer}
.pv-bar button[aria-pressed="true"]{background:var(--primary);border-color:var(--primary);color:var(--on-primary)}
.pv-bar button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.pv-bar code{font:12px ui-monospace,monospace;color:var(--muted);overflow-wrap:anywhere}
</style>
<div class="pv-bar" id="pvBar" role="region" aria-label="แถบหน้าตัวอย่าง">
  <span><b>หน้าตัวอย่าง</b> · ข้อมูลสมมติ ไม่กระทบเว็บจริง</span>
  <span class="pv-roles" role="group" aria-label="ดูในฐานะ">
    <button type="button" data-pv-role="">ผู้เยี่ยมชม</button>
    <button type="button" data-pv-role="citizen">ประชาชน</button>
    <button type="button" data-pv-role="staff">เจ้าหน้าที่ รพ.สต.</button>
    <button type="button" data-pv-role="admin">ผู้ดูแล</button>
  </span>
  <span>หน้า: <code id="pvRoute">#/</code></span>
</div>
<script>
(function () {
  var KEY = 'pv-role', HOME = { '': '#/', citizen: '#/me', staff: '#/staff', admin: '#/admin' };
  function get() {
    try { var v = localStorage.getItem(KEY); if (v !== null) return v; } catch (e) {}
    var m = /(?:^|;)pv-role=([a-z0-9]*)/.exec(window.name || ''); return m ? m[1] : '';
  }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} window.name = 'pv-role=' + v; }
  window.__previewRole = function () { return get() || null; };
  // หน้าตัวอย่างแสดงกล่อง confirm/alert ไม่ได้ — ให้ยืนยันอัตโนมัติ (ข้อมูลสมมติ)
  window.confirm = function () { return true; };
  window.alert = function (m) { console.log(m); };
  var cur = get();
  [].forEach.call(document.querySelectorAll('[data-pv-role]'), function (b) {
    b.setAttribute('aria-pressed', String(b.getAttribute('data-pv-role') === cur));
    b.addEventListener('click', function () { var r = b.getAttribute('data-pv-role'); set(r); location.hash = HOME[r]; location.reload(); });
  });
  function show() { document.getElementById('pvRoute').textContent = location.hash || '#/'; }
  window.addEventListener('hashchange', show); show();
})();
</script>
"""


def must_sub(text, old, new, where):
    if old not in text:
        sys.exit(f"preview: หา '{old[:60]}' ใน {where} ไม่เจอ — โค้ดเปลี่ยนไป ต้องแก้ tools/preview/build.py")
    return text.replace(old, new)


def rename(text):
    for a, b in NAMES:
        text = text.replace(a, b)
    return re.sub(r"\?v=[0-9A-Za-z.\-]+", "", text)   # หน้าตัวอย่างไม่ต้องกันแคช


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "assets").mkdir(parents=True)

    # ข้อมูลสมมติ: เปลี่ยนชื่อ รพ.สต. / สถานที่จริงทั้งหมด
    fx = (ROOT / "tests/ui/fixtures.json").read_text(encoding="utf-8")
    units = json.loads(fx)["units"]
    for u in sorted(units, key=lambda u: -len(u["name"])):
        if u["id"] == 0:
            continue
        fx = fx.replace(u["name"], UNIT_ALIAS.format(u["id"]))
    data = json.loads(rename(fx))
    for u in data["units"]:
        u["phone"] = "0xx-xxx-xxx" if u.get("phone") else None
        u["address"] = f"ที่อยู่สมมติ หน่วยที่ {u['id']}" if u.get("address") else None
    (OUT / "fixtures.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    shutil.copy(ROOT / "assets/app.css", OUT / "assets/app.css")
    for f in (ROOT / "js").rglob("*.js"):
        dst = OUT / f.relative_to(ROOT)
        dst.parent.mkdir(parents=True, exist_ok=True)
        text = rename(f.read_text(encoding="utf-8"))
        if f.name == "supabase.js":
            text = must_sub(text, "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm", "./mock-supabase.js", "js/supabase.js")
        if f.name == "config.js":
            text = re.sub(r"https://[a-z0-9]+\.supabase\.co", "https://preview.invalid", text)
            text = re.sub(r"sb_publishable_[A-Za-z0-9_-]+", "preview-key", text)
        dst.write_text(text, encoding="utf-8")

    mock = (ROOT / "tests/ui/mock_supabase.js").read_text(encoding="utf-8")
    mock = must_sub(mock, "fetch('/tests/ui/fixtures.json')", "fetch('fixtures.json')", "mock_supabase.js")
    mock = must_sub(mock, "new URLSearchParams(location.search).get('mockrole')", "window.__previewRole()", "mock_supabase.js")
    (OUT / "js/mock-supabase.js").write_text(mock, encoding="utf-8")

    # หน้าหลัก: ตัด <html>/<head>/<body> ออก (Artifact ครอบให้เอง) + แถบเลือกบทบาทไว้บนสุด
    html = rename((ROOT / "index.html").read_text(encoding="utf-8"))
    html = re.sub(r"<title>.*?</title>\n?", "", html, flags=re.S)
    for tag in (r"<!doctype html>", r"<html[^>]*>", r"</html>", r"<head>", r"</head>", r"</body>", r'<meta charset="utf-8">', r'<meta name="viewport"[^>]*>'):
        html = re.sub(tag + r"\n?", "", html, flags=re.I)
    html = must_sub(html, "<body>\n", "", "index.html")
    page = ROLE_BAR + html.strip() + "\n"
    (OUT / "index.html").write_text(page, encoding="utf-8")
    (OUT / "local.html").write_text('<!doctype html>\n<html lang="th">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + page + "</html>\n", encoding="utf-8")

    leaks = [str(p.relative_to(OUT)) for p in OUT.rglob("*") if p.is_file() and FORBIDDEN.search(p.read_text(encoding="utf-8"))]
    leaks += [u["name"] for u in units if u["id"] and any(u["name"] in p.read_text(encoding="utf-8") for p in OUT.rglob("*") if p.is_file())]
    if leaks:
        sys.exit(f"preview: ยังมีชื่อจริงหลุด: {leaks}")
    print(f"preview: {sum(1 for p in OUT.rglob('*') if p.is_file())} ไฟล์ → {OUT}")


main()
