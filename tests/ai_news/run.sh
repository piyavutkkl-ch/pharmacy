#!/usr/bin/env bash
# ทดสอบช่อง AI (tools/ai_news/run.mjs) แบบไม่ใช้เน็ต/คีย์จริง: หน้าเว็บ CCPE + คำตอบ Gemini จำลองใน fixtures/
#   ตรวจ: เลือกบทความที่ยังไม่เคยทำ · อ่านข้อมูลบทความ · AI วิเคราะห์ PDF → เขียนข่าว → ตรวจทานซ้ำจนไม่พบจุดผิด
#         · ประกอบเนื้อข่าว + อ้างอิง · ภาพแม่แบบ 3 แบบ (ไม่ใช้ AI วาดภาพ · JPEG ขนาด A4, ≤ 1 MB)
#         · ตรวจทานครบรอบแล้วยังพบจุดผิด → ไม่เผยแพร่อัตโนมัติ (รอผู้ดูแลตรวจ)
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
out=$(mktemp -d); trap 'rm -rf "$out"' EXIT
node "$root/tools/ai_news/run.mjs" --offline "$root/tests/ai_news/fixtures" "$out" >/dev/null
# รอบที่ 2: เปิดเผยแพร่อัตโนมัติ แต่ตรวจทานทุกรอบยังพบจุดผิด → ต้องรอผู้ดูแลตรวจ
fx2="$out/fx-issues"; mkdir -p "$fx2" "$out/issues"; cp "$root/tests/ai_news/fixtures/"* "$fx2/"
cp "$fx2/gemini-verify1.json" "$fx2/gemini-verify2.json"; cp "$fx2/gemini-verify1.json" "$fx2/gemini-verify3.json"; echo '{"auto":"on"}' > "$fx2/settings.json"
node "$root/tools/ai_news/run.mjs" --offline "$fx2" "$out/issues" >/dev/null
# รอบที่ 3: เปิดเผยแพร่อัตโนมัติ + ตรวจทานผ่าน → เผยแพร่ได้
fx3="$out/fx-auto"; mkdir -p "$fx3" "$out/auto"; cp "$root/tests/ai_news/fixtures/"* "$fx3/"; echo '{"auto":"on"}' > "$fx3/settings.json"
node "$root/tools/ai_news/run.mjs" --offline "$fx3" "$out/auto" >/dev/null
ROOT_DIR="$root" python3 - "$out" <<'PY'
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
check('ai-news: อ้างอิงลิงก์บทความต้นฉบับ + ลิงก์ดาวน์โหลด PDF ต้นฉบับ (ไม่เก็บสำเนา)', r['source_url'].endswith('id=1876') and r['source_url'].startswith('https://ccpe.') and r.get('source_file_url', '').endswith('showfile.php?file=1876') and r['source_file_url'].startswith('https://ccpe.') and 'file_path' not in r)
check('ai-news: เนื้อข่าวมีย่อหน้า + ข้อควรรู้ + สำหรับบุคลากร + หมายเหตุ AI (ไม่มีคำว่าผ่านการตรวจทาน)', all(x in r['body'] for x in ('สแตติน', '• อย่าบด', 'สำหรับบุคลากรทางการแพทย์:', 'สรุปโดย AI')) and 'ผ่านการตรวจทาน' not in r['body'])
check('ai-news: ค่าเริ่มต้นรอผู้ดูแลตรวจ + ป้าย AI + หมวดความรู้', r['status'] == 'pending' and r['ai_generated'] is True and r['tag'] == 'ความรู้')
ck = d['check']
check('ai-news: AI วิเคราะห์ PDF ก่อน (ข้อเท็จจริง + ข้อความอ้างอิง + เลขหน้า)', len(d['facts']['facts']) == 2 and all(f.get('quote') and f.get('page') for f in d['facts']['facts']))
check('ai-news: ตรวจทานเทียบ PDF → แก้จุดผิด (หัวข้อ) แล้วตรวจซ้ำจนไม่พบจุดผิด', r['title'].startswith('ยาสแตตินแบบทา อาจช่วย') and ck == {'rounds': 2, 'fixed': 1, 'left': 0}, (r['title'], ck))
check('ai-news: ไม่ใช้ AI วาดภาพ → ภาพแม่แบบ 3 ภาพจากข้อมูลที่ตรวจแล้ว (ภาพหลัก + แกลเลอรี 2 ภาพ)', r['image_path'].endswith('infographic.jpg') and len(r['gallery']) == 2 and 'painter' not in d and not os.path.exists(os.path.join(out, 'ai.jpg')), (r['image_path'], r['gallery']))
d2 = json.load(open(os.path.join(out, 'issues', 'news.json')))
check('ai-news: ตรวจทานครบ 3 รอบยังพบจุดผิด → ไม่เผยแพร่อัตโนมัติ (รอผู้ดูแลตรวจ)', d2['row']['status'] == 'pending' and d2['check']['rounds'] == 3 and d2['check']['left'] > 0, d2['check'])
d3 = json.load(open(os.path.join(out, 'auto', 'news.json')))
check('ai-news: เปิดเผยแพร่อัตโนมัติ + ตรวจทานผ่าน → เผยแพร่ทันที', d3['row']['status'] == 'published' and d3['check']['left'] == 0)
sv = d.get('source') or {}
check('ai-news: ถอดข้อความ PDF เก็บไว้ (แบ่งตาม [หน้า n]) ให้ผู้ดูแลตรวจข่าว/แบบทดสอบได้เร็ว', sv.get('method') == 'gemini' and sv.get('pages') == 2 and sv.get('body', '').startswith('[หน้า 1]') and 'อย่าบดยาเม็ด' in sv.get('body', ''), {k: v for k, v in sv.items() if k != 'body'})
src = open(os.path.join(os.environ.get('ROOT_DIR', '.'), 'tools/ai_news/run.mjs')).read()
check('ai-news: ไม่มีโค้ดเรียก AI วาดภาพ (Gemini image / Cloudflare / Pollinations)', not any(x in src for x in ('pollinations', 'cloudflare', 'responseModalities')))
for k, want in (('infographic', (1240, 1754)), ('comic', (1754, 1240)), ('clinical', (1240, None))):
    p = os.path.join(out, k + '.jpg'); sz = jpeg_size(p) if os.path.exists(p) else None
    good = sz and sz[0] == want[0] and (sz[1] == want[1] if want[1] else 1240 <= sz[1] <= 1754)
    check(f'ai-news: ภาพแม่แบบ {k} กว้าง {want[0]} สัดส่วนไม่เกิน A4 ไม่เกิน 1 MB', good and os.path.getsize(p) <= 1_000_000, sz)
import subprocess
js = "import('" + os.path.join(os.environ.get('ROOT_DIR', '.'), 'tools/ai_news/run.mjs') + "')"
probe = r'''
const good = 'ยาสแตตินแบบทาอาจช่วยให้แผลหายเร็วขึ้น ควรปรึกษาแพทย์หรือเภสัชกรก่อนใช้ยา '.repeat(12);
const bad = 'ย า ส แ ต ต ิ น แ บ บ ท ำ อ ำ จ ช ่ ว ย '.repeat(40);
'''
check_js = probe + "const m = await import(process.argv[1]); const a = m.cleanPdfText(good + '\\f' + good), b = m.cleanPdfText(bad);" \
  + "console.log(JSON.stringify({ ok: a.ok, pages: a.pages, head: a.body.slice(0, 8), bad: b.ok }));"
import json as _j
out = subprocess.run(['node', '--input-type=module', '-e', check_js, os.path.join(os.environ.get('ROOT_DIR', '.'), 'tools/ai_news/run.mjs')], capture_output=True, text=True, env={**os.environ, 'AI_NEWS_IMPORT_ONLY': '1'})
try: r = _j.loads(out.stdout.strip().splitlines()[-1])
except Exception: r = {'err': out.stderr[-300:]}
js2 = "const m = await import(process.argv[1]); const bad = { candidates: [{ content: { parts: [{ text: '{\"a\": \"ยา \"X\" ดี\"}' }] } }] }, good = { candidates: [{ content: { parts: [{ text: '```json {\"a\": 1} ```' }] } }] };" \
  + "let n = 0; const r1 = await m.askJson(async () => (n++ ? good : bad)); let err = ''; try { await m.askJson(async () => bad, 2); } catch (e) { err = e.message; }" \
  + "console.log(JSON.stringify({ r1, n, err }));"
o2 = subprocess.run(['node', '--input-type=module', '-e', js2, os.path.join(os.environ.get('ROOT_DIR', '.'), 'tools/ai_news/run.mjs')], capture_output=True, text=True, env={**os.environ, 'AI_NEWS_IMPORT_ONLY': '1'})
try: r2 = _j.loads(o2.stdout.strip().splitlines()[-1])
except Exception: r2 = {'err': o2.stderr[-300:]}
check('ai-news: AI ตอบ JSON ไม่สมบูรณ์ → ถามใหม่ (ไม่ล้มทั้งรอบ) · ผิดครบทุกครั้ง → แจ้งเหตุผลภาษาไทย', r2.get('r1') == {'a': 1} and r2.get('n') == 2 and 'JSON ไม่สมบูรณ์ 2 ครั้ง' in r2.get('err', ''), r2)
check('ai-news: pdftotext ภาษาไทยดี → ใช้ได้ (แบ่งหน้า) · สระ/วรรณยุกต์ลอย (ฟอนต์ถอดไม่ได้) → ส่งให้ AI ถอดแทน', r.get('ok') is True and r.get('pages') == 2 and r.get('head') == '[หน้า 1]' and r.get('bad') is False, r)
print(f'ai-news: {n[0]} passed, {n[1]} failed')
sys.exit(0 if ok else 1)
PY
