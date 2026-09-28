#!/usr/bin/env python3
"""ติดเลขเวอร์ชันให้ไฟล์ CSS/JS ทุกไฟล์ (กันเบราว์เซอร์ใช้ไฟล์เก่าที่จำไว้หลังอัปเดตเว็บ)

ใช้:  python3 tools/bump_version.py <เวอร์ชัน> [โฟลเดอร์เว็บ]
- แก้ index.html (<link> CSS, <script> main.js, meta app-version) และทุก import ใน js/ ให้ลงท้าย ?v=<เวอร์ชัน>
- ระบบ deploy (.github/workflows/ci-deploy.yml) เรียกให้เองทุกครั้งกับสำเนาที่จะขึ้นเว็บ (เวอร์ชัน = วันที่-commit)
  จึงไม่ต้องรันเองก่อน commit อีกแล้ว
"""
import re, sys, pathlib

if len(sys.argv) not in (2, 3) or not re.fullmatch(r"[0-9A-Za-z.\-]+", sys.argv[1]):
    sys.exit("usage: python3 tools/bump_version.py <version> [site_dir]")
root = pathlib.Path(sys.argv[2]).resolve() if len(sys.argv) == 3 else pathlib.Path(__file__).resolve().parent.parent
v = sys.argv[1]

def tag(path_str):
    return re.sub(r"\?v=[0-9A-Za-z.\-]+$", "", path_str) + f"?v={v}"

idx = root / "index.html"
html = idx.read_text(encoding="utf-8")
html = re.sub(r'(href="assets/app\.css)(\?v=[^"]*)?"', lambda m: f'{m.group(1)}?v={v}"', html)
html = re.sub(r'(src="js/main\.js)(\?v=[^"]*)?"', lambda m: f'{m.group(1)}?v={v}"', html)
html = re.sub(r'(<meta name="app-version" content=")[^"]*(")', lambda m: f"{m.group(1)}{v}{m.group(2)}", html)
idx.write_text(html, encoding="utf-8")

n = 0
for f in (root / "js").rglob("*.js"):
    src = f.read_text(encoding="utf-8")
    new = re.sub(r"""(from\s+['"])(\.{1,2}/[^'"?]+\.js)(\?v=[^'"]*)?(['"])""",
                 lambda m: f"{m.group(1)}{m.group(2)}?v={v}{m.group(4)}", src)
    if new != src:
        f.write_text(new, encoding="utf-8"); n += 1
print(f"version {v}: index.html + {n} js files updated")
