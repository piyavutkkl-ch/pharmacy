#!/usr/bin/env python3
"""ทดสอบการทำงานต่อใน Google Antigravity (GEMINI.md)

  python3 tests/gemini/test_tools.py

① tests/structure_guard.py จับการเปลี่ยนโครงสร้างแบบที่ AI ถนัด React มักทำ (npm/metadata.json/.tsx/importmap/CDN ไม่ระบุรุ่น)
② GEMINI.md ใช้ได้จริงใน Antigravity (≤ 24,000 bytes ไม่ถูกตัด) และตรงกับ ci-deploy.yml (branch gemini/… ทดสอบ/ขึ้นเว็บเหมือนงานของ Claude)
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests"))
import structure_guard as G  # noqa: E402

ok = bad = 0


def check(name, cond, detail=""):
    global ok, bad
    if cond:
        ok += 1
        print("PASS " + name)
    else:
        bad += 1
        print("FAIL " + name + (f" — {detail}" if detail else ""))


# ---------- ① structure_guard ----------
REAL_INDEX = (ROOT / "index.html").read_text(encoding="utf-8")


def probs(extra_files=(), texts=None):
    texts = dict(texts or {})
    texts.setdefault("index.html", REAL_INDEX)
    files = ["index.html", "js/main.js", "tests/ui/package.json", *extra_files, *[k for k in texts if k != "index.html"]]
    return G.problems(sorted(set(files)), lambda p: texts.get(p, ""))


check("โครงสร้างปัจจุบันผ่าน", probs() == [], probs())
check("package.json ของเครื่องมือทดสอบ (tests/ui) ใช้ได้", not any("tests/ui/package.json" in m for m in probs()))
for f in ["package.json", "package-lock.json", "metadata.json", "tsconfig.json", "index.tsx", "App.tsx",
          "vite.config.ts", ".env", ".env.local", "src/App.tsx", "src/components/Nav.jsx", "js/pages/new.ts",
          "server.js", "node_modules/react/index.js", "js/package.json"]:
    check(f"ปฏิเสธไฟล์แบบโปรเจกต์ build: {f}", any(m.startswith(f) for m in probs([f])), probs([f]))

react_index = """<!doctype html><html><head><script type="importmap">{"imports":{"react":"https://esm.sh/react@19"}}</script>
<link rel="stylesheet" href="index.css"></head><body><div id="root"></div><script type="module" src="/index.tsx"></script></body></html>"""
msgs = probs(texts={"index.html": react_index})
check("ปฏิเสธ index.html ที่ถูกเขียนใหม่เป็น React", any("main.js" in m for m in msgs) and any("data-view" in m for m in msgs), msgs)
check("ปฏิเสธ importmap", any("importmap" in m for m in msgs), msgs)
check("แก้ index.html บางส่วน (เพิ่มปุ่ม) ผ่าน", probs(texts={"index.html": REAL_INDEX.replace("</body>", '<button id="gmTest">ทดสอบ</button></body>')}) == [])

cdn_cases = {
    "import x from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'": False,
    "import x from 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/+esm'": True,
    "import x from 'https://cdn.jsdelivr.net/npm/chart.js/+esm'": False,
    "import x from 'https://esm.sh/react@19.0.0'": False,
    "import x from 'https://unpkg.com/lodash@4.17.21/lodash.js'": False,
    "const X = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')": True,
    "s.src = 'https://cdn.jsdelivr.net/npm/tabulator-tables@6.3.1/dist/js/tabulator.min.js'": True,
}
for code, allowed in cdn_cases.items():
    m = probs(texts={"js/pages/x.js": code})
    check(f"CDN {'ใช้ได้' if allowed else 'ปฏิเสธ'}: {code[code.index('http'):][:60]}", (m == []) == allowed, m)

# ---------- ② GEMINI.md ↔ Antigravity / ci-deploy ----------
gm = (ROOT / "GEMINI.md").read_text(encoding="utf-8")
ci = (ROOT / ".github/workflows/ci-deploy.yml").read_text(encoding="utf-8")
trig = re.search(r"push:\s*\n\s*branches:\s*\[([^\]]*)\]", ci)
check("ci-deploy รับ branch gemini/** (ทดสอบ → รวม → ขึ้นเว็บ)", trig and "'gemini/**'" in trig.group(1), trig and trig.group(1))
check("ขั้นรวมเข้า main ใช้กับทุก branch ที่ไม่ใช่ main", "if: github.ref != 'refs/heads/main'\n        env:\n          GH_TOKEN" in ci)
check("GEMINI.md สั่งให้ push ไป gemini/… และห้าม main/force push", "git push -u origin gemini/<" in gm and "ห้าม push เข้า `main`" in gm and "push --force" in gm)
check("GEMINI.md ให้อ่าน CLAUDE.md ก่อน", "อ่าน CLAUDE.md ให้ครบ" in gm)
size = len(gm.encode("utf-8"))
check(f"GEMINI.md ไม่เกิน 24,000 bytes ที่ Antigravity โหลดได้ทั้งไฟล์ ({size:,} bytes)", size <= 24000)
check("ไม่มี AGENTS.md ซ้ำซ้อน (Antigravity โหลดทั้งสองไฟล์รวมกัน)", not (ROOT / "AGENTS.md").exists())
check("GEMINI.md: push เมื่อเจ้าของเว็บสั่ง \"ขึ้นเว็บ\" เท่านั้น", "\"ขึ้นเว็บ\" เท่านั้น" in gm)
check("GEMINI.md: ทดสอบด้วย run_all.sh ก่อน push", "bash tests/run_all.sh" in gm)
check("GEMINI.md: ห้ามแตะไฟล์นอก repo/ฐานข้อมูลจริง/ค่าลับ", "นอก repo" in gm and "Supabase จริง" in gm and ".env" in gm)
check("GEMINI.md: ข้อมูลผู้ป่วย/MIMS ห้ามส่งให้ AI", "ข้อมูลผู้ป่วยจริง" in gm and "MIMS" in gm)
for cmd in ["tests/setup_env.sh", "tools/preview/build.py", "gh run view"]:
    check(f"GEMINI.md อ้างคำสั่ง/ไฟล์ที่มีจริง: {cmd}", cmd in gm and (cmd.startswith("gh ") or (ROOT / cmd).exists()))
setup = (ROOT / "tests/setup_env.sh").read_text(encoding="utf-8")
check("setup_env.sh ไม่เรียก sudo apt-get บน Mac/Windows (ไม่ค้างรอรหัสผ่าน)", "command -v apt-get" in setup)
check("CLAUDE.md อ้างถึง GEMINI.md", "GEMINI.md" in (ROOT / "CLAUDE.md").read_text(encoding="utf-8"))

print(f"gemini: {ok} passed, {bad} failed")
sys.exit(1 if bad else 0)
