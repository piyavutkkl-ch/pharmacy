#!/usr/bin/env python3
"""ตรวจโค้ดแบบไม่ต้องเปิดเว็บ (เร็ว) — รันก่อนทุกครั้งที่จะส่งขึ้น GitHub

  python3 tests/static_checks.py

ตรวจ: ไวยากรณ์ JS/Python/Bash · แท็ก HTML ปิดครบ · id ซ้ำใน index.html · import ในโปรเจกต์ใช้ ?v= เดียวกัน
      ไฟล์ที่ index.html อ้างถึงมีอยู่จริง · ไม่มีค่าลับ (secret key, รหัสผ่าน, token) หลุดในไฟล์ใด ๆ
"""
import ast, pathlib, re, subprocess, sys
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parent.parent
fails = []


def fail(msg):
    fails.append(msg)
    print("FAIL " + msg)


def tracked():
    try:
        out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
        files = [ROOT / f for f in out]
        # รวมไฟล์ใหม่ที่ยังไม่ได้ git add
        extra = subprocess.run(["git", "ls-files", "--others", "--exclude-standard"], cwd=ROOT, capture_output=True, text=True).stdout.split()
        return [f for f in files + [ROOT / f for f in extra] if f.is_file()]
    except Exception:
        return [p for p in ROOT.rglob("*") if p.is_file() and ".git" not in p.parts and "node_modules" not in p.parts and "_preview" not in p.parts]


FILES = [f for f in tracked() if not {"shots", "__pycache__", "node_modules"} & set(f.parts)]
rel = lambda f: str(f.relative_to(ROOT))

# ---------- 1) ไวยากรณ์ ----------
for f in FILES:
    r = None
    if f.suffix == ".js":
        r = subprocess.run(["node", "--check", str(f)], capture_output=True, text=True)
    elif f.suffix == ".py":
        try:
            ast.parse(f.read_text(encoding="utf-8"), str(f))
        except SyntaxError as e:
            fail(f"syntax {rel(f)}: {e}")
    elif f.suffix == ".sh":
        r = subprocess.run(["bash", "-n", str(f)], capture_output=True, text=True)
    if r is not None and r.returncode:
        fail(f"syntax {rel(f)}: {(r.stderr or r.stdout).strip().splitlines()[-1][:200]}")

# ---------- 2) HTML ----------
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
SVG_LEAF = {"path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "stop", "use"}


class Checker(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack, self.ids, self.errors = [], {}, []

    def handle_starttag(self, tag, attrs):
        for k, v in attrs:
            if k == "id" and v:
                self.ids[v] = self.ids.get(v, 0) + 1
        if tag not in VOID and tag not in SVG_LEAF:
            self.stack.append((tag, self.getpos()[0]))

    def handle_startendtag(self, tag, attrs):
        for k, v in attrs:
            if k == "id" and v:
                self.ids[v] = self.ids.get(v, 0) + 1

    def handle_endtag(self, tag):
        if tag in VOID or tag in SVG_LEAF:
            return
        if self.stack and self.stack[-1][0] == tag:
            self.stack.pop()
        else:
            self.errors.append(f"</{tag}> บรรทัด {self.getpos()[0]} ไม่ตรงกับ <{self.stack[-1][0] if self.stack else '-'}>")


for name in ("index.html", "privacy.html", "terms.html"):
    f = ROOT / name
    if not f.exists():
        continue
    c = Checker()
    c.feed(f.read_text(encoding="utf-8"))
    for e in c.errors[:3]:
        fail(f"html {name}: {e}")
    if c.stack:
        fail(f"html {name}: แท็กไม่ได้ปิด {c.stack[-3:]}")
    dup = [k for k, n in c.ids.items() if n > 1]
    if dup:
        fail(f"html {name}: id ซ้ำ {dup[:10]}")
    if name == "index.html":
        html = f.read_text(encoding="utf-8")
        for ref in re.findall(r'(?:src|href)="((?:js|assets)/[^"?#]+)', html):
            if not (ROOT / ref).exists():
                fail(f"html index.html อ้างถึงไฟล์ที่ไม่มี: {ref}")

# ---------- 3) import ในโปรเจกต์ใช้เวอร์ชันเดียวกัน (กันโมดูลโหลดซ้ำเป็นคนละตัว) ----------
versions = {}
for f in (ROOT / "js").rglob("*.js"):
    for m in re.finditer(r"""from\s+['"](\.{1,2}/[^'"]+\.js)(\?v=[^'"]*)?['"]""", f.read_text(encoding="utf-8")):
        versions.setdefault(m.group(2) or "(ไม่มี ?v)", []).append(f"{rel(f)} → {m.group(1)}")
if len(versions) > 1:
    fail("import ใช้ ?v= ไม่เหมือนกัน: " + ", ".join(f"{k} ({len(v)} ที่ เช่น {v[0]})" for k, v in versions.items()) + " — รัน python3 tools/bump_version.py <เวอร์ชัน>")

# ---------- 4) ค่าลับ ----------
SECRET = [
    (r"sb_secret_[A-Za-z0-9_-]{16,}", "Supabase secret key"),
    (r"GOCSPX-[A-Za-z0-9_-]{10,}", "Google client secret"),
    (r"\b1//0[A-Za-z0-9_-]{30,}", "Google refresh token"),
    (r"eyJhbGciOi[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}", "JWT (อาจเป็น service_role key)"),
    (r"postgres(?:ql)?://[^\s:/@'\"]+:(?!\[YOUR-PASSWORD\]|verify-only@|ci-only@|pw@)[^\s@'\"]{6,}@", "รหัสผ่านฐานข้อมูล"),
    (r"-----BEGIN [A-Z ]*PRIVATE KEY-----", "private key"),
    (r"\bgh[pousr]_[A-Za-z0-9]{30,}", "GitHub token"),
]
for f in FILES:
    if f.suffix in (".png", ".jpg", ".webp", ".pdf", ".zip", ".gpg") or f.name == "static_checks.py":
        continue
    try:
        txt = f.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        continue
    for pat, what in SECRET:
        if re.search(pat, txt):
            fail(f"ค่าลับหลุด ({what}) ใน {rel(f)} — ลบออกทันที และเปลี่ยนค่านั้นใหม่ในระบบต้นทาง")
cfg = (ROOT / "js/config.js").read_text(encoding="utf-8") if (ROOT / "js/config.js").exists() else ""
if cfg and not re.search(r"sb_publishable_", cfg):
    fail("js/config.js ต้องใช้ publishable key (sb_publishable_…) เท่านั้น")

print(f"static: {'OK' if not fails else str(len(fails)) + ' problem(s)'} ({len(FILES)} files)")
sys.exit(1 if fails else 0)
