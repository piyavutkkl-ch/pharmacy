"""กันโครงสร้างโปรเจกต์ถูกเปลี่ยน (ใช้ใน static_checks.py · ทดสอบใน tests/gemini/test_tools.py)

เว็บนี้เป็น HTML + CSS + ES modules ตรง ๆ ไม่มีขั้นตอน build (CLAUDE.md › ข้อบังคับ)
AI ที่ถนัด React/Node (เช่น Gemini ใน Antigravity หรือ AI Studio) อาจเพิ่ม package.json · .tsx · metadata.json · importmap
หรือเปลี่ยน index.html ทั้งหน้า → หน้าเว็บจริงพังโดยที่การทดสอบเดิมอาจไม่ทันจับ จึงตรวจไว้ตรงนี้

problems(files, read) → รายการข้อความภาษาไทย (ว่าง = ผ่าน)
  files = path แบบ str เทียบกับรากโปรเจกต์ (เช่น "js/main.js") · read(path) = ข้อความในไฟล์
"""
import re

# ไฟล์/โฟลเดอร์ของโปรเจกต์แบบมีขั้นตอน build หรือของเครื่องมือ AI ที่ห้ามมีในเว็บนี้
BANNED_ROOT = {
    "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
    "metadata.json", "tsconfig.json", "jsconfig.json", "index.tsx", "index.ts", "App.tsx", "App.jsx",
    "next.config.js", "next.config.mjs", "angular.json", "server.js", "server.ts", "Dockerfile",
}
BANNED_NAME = re.compile(r"^(vite|webpack|rollup|tailwind|postcss|svelte|nuxt|astro)\.config\.[cm]?[jt]s$|^\.env(\..*)?$")
BANNED_EXT = (".ts", ".tsx", ".jsx", ".vue", ".svelte")
# เครื่องมือทดสอบมี package.json ของตัวเองได้ (ไม่ขึ้นเว็บ)
ALLOWED_PKG_DIRS = ("tests/",)

# ไลบรารีภายนอกที่โหลดได้: jsDelivr ระบุเลขรุ่นเต็ม (x.y.z) หรือ SheetJS 0.20.3 (ดู CLAUDE.md)
CDN_URL = re.compile(r"https://[a-z0-9.-]*(?:jsdelivr\.net|unpkg\.com|esm\.sh|skypack\.dev|cdnjs\.cloudflare\.com|sheetjs\.com|jspm\.io)/[^\s'\"`)]*")
OK_CDN = re.compile(r"^https://cdn\.jsdelivr\.net/npm/(?:@[a-z0-9._-]+/)?[a-z0-9._-]+@\d+\.\d+\.\d+(?:[/?#]|$)|^https://cdn\.sheetjs\.com/xlsx-\d+\.\d+\.\d+/")

# โครงหน้าเดิมที่ index.html ต้องยังมี (หายไป = ถูกเขียนใหม่ทั้งหน้า)
INDEX_MUST = [
    (r'<script[^>]+type="module"[^>]+src="js/main\.js', 'โหลด js/main.js เป็น module'),
    (r'data-view="home"', 'ส่วน data-view="home"'),
    (r'data-view="staff"', 'ส่วน data-view="staff"'),
    (r'data-view="admin"', 'ส่วน data-view="admin"'),
    (r'href="assets/app\.css', 'assets/app.css'),
]


def problems(files, read):
    out = []
    for f in files:
        name = f.rsplit("/", 1)[-1]
        top = "/" not in f
        if any(f.startswith(d) for d in ALLOWED_PKG_DIRS):
            continue
        if (top and name in BANNED_ROOT) or name == "package.json" or "node_modules/" in f:
            out.append(f"{f}: เว็บนี้ไม่มีขั้นตอน build (ไม่ใช้ npm/React/Node) — ลบไฟล์นี้ออก")
        elif BANNED_NAME.search(name):
            out.append(f"{f}: ไฟล์ตั้งค่า build/ค่าลับ (.env) ห้ามอยู่ใน repo — ลบไฟล์นี้ออก")
        elif f.endswith(BANNED_EXT):
            out.append(f"{f}: เว็บนี้ใช้ JavaScript ธรรมดา (.js ES modules) ไม่ใช้ TypeScript/JSX — เขียนเป็น .js ใน js/pages/")

    if "index.html" in files:
        html = read("index.html")
        for pat, what in INDEX_MUST:
            if not re.search(pat, html):
                out.append(f"index.html: ไม่พบ{what} — ห้ามเขียนหน้าเว็บใหม่ทั้งหน้า ให้แก้เฉพาะส่วนที่ต้องการ")
        if re.search(r'<script[^>]+type="importmap"', html):
            out.append("index.html: ห้ามใช้ importmap — import ไลบรารีด้วย URL jsDelivr เต็มในไฟล์ .js")

    for f in files:
        if not (f.endswith((".js", ".html", ".mjs")) and (f.startswith("js/") or "/" not in f)):
            continue
        for url in CDN_URL.findall(read(f)):
            if not OK_CDN.search(url):
                out.append(f"{f}: โหลดไลบรารีจาก {url[:90]} — ใช้ได้เฉพาะ cdn.jsdelivr.net/npm/<ชื่อ>@<เลขรุ่นเต็ม x.y.z> (หรือ SheetJS ตาม CLAUDE.md)")
    return out
