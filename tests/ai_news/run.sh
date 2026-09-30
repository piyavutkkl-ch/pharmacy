#!/usr/bin/env bash
# ทดสอบช่อง AI (tools/ai_news/run.mjs) แบบไม่ใช้เน็ต/คีย์จริง: หน้าเว็บ CCPE + คำตอบ Gemini จำลองใน fixtures/
#   ตรวจ: เลือกบทความที่ยังไม่เคยทำ · อ่านข้อมูลบทความ · ประกอบเนื้อข่าว + อ้างอิง · ภาพ 3 แบบ (JPEG ขนาด A4, ≤ 1 MB)
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
out=$(mktemp -d); trap 'rm -rf "$out"' EXIT
node "$root/tools/ai_news/run.mjs" --offline "$root/tests/ai_news/fixtures" "$out" >/dev/null
python3 - "$out" <<'PY'
import json, os, struct, sys
out = sys.argv[1]; ok = True; n = [0, 0]
def check(name, cond, info=''):
    global ok
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else f' → {info}')); ok &= bool(cond); n[0 if cond else 1] += 1
def jpeg_size(p):
    b = open(p, 'rb').read(); i = 2
    while i < len(b):
        if b[i] != 0xFF: i += 1; continue
        m = b[i + 1]
        if m in (0xC0, 0xC1, 0xC2): h, w = struct.unpack('>HH', b[i + 5:i + 9]); return w, h
        i += 2 + struct.unpack('>H', b[i + 2:i + 4])[0]
d = json.load(open(os.path.join(out, 'news.json'))); a, r = d['article'], d['row']
check('ai-news: เลือกบทความที่ยังไม่เคยทำ (1876) + อ่านชื่อ/ผู้เขียนจากหน้า CCPE', a['id'] == 1876 and a['title'].startswith('ยาทาสแตติน') and '&' in a['title'] and a['authors'] == 'ภก.ทดสอบ ตัวอย่าง', a)
check('ai-news: อ้างอิงลิงก์บทความต้นฉบับ (ไม่แนบ PDF)', r['source_url'].endswith('id=1876') and r['source_url'].startswith('https://ccpe.') and 'file_path' not in r)
check('ai-news: เนื้อข่าวมีย่อหน้า + ข้อควรรู้ + สำหรับบุคลากร + หมายเหตุ AI', all(x in r['body'] for x in ('สแตติน', '• อย่าบด', 'สำหรับบุคลากรทางการแพทย์:', 'สรุปโดย AI')))
check('ai-news: ค่าเริ่มต้นรอผู้ดูแลตรวจ + ป้าย AI + หมวดความรู้', r['status'] == 'pending' and r['ai_generated'] is True and r['tag'] == 'ความรู้')
check('ai-news: ภาพหลัก + แกลเลอรี 2 ภาพ', r['image_path'].endswith('infographic.jpg') and len(r['gallery']) == 2)
for k, want in (('infographic', (1240, 1754)), ('comic', (1754, 1240)), ('clinical', (1240, None))):
    p = os.path.join(out, k + '.jpg'); sz = jpeg_size(p) if os.path.exists(p) else None
    good = sz and sz[0] == want[0] and (sz[1] == want[1] if want[1] else 1240 <= sz[1] <= 1754)
    check(f'ai-news: ภาพ {k} กว้าง {want[0]} สัดส่วนไม่เกิน A4 ไม่เกิน 1 MB', good and os.path.getsize(p) <= 1_000_000, sz)
print(f'ai-news: {n[0]} passed, {n[1]} failed')
sys.exit(0 if ok else 1)
PY
