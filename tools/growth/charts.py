#!/usr/bin/env python3
"""กราฟการเจริญเติบโตของเด็ก (กรมอนามัย) → ภาพ assets/growth/*.jpg + ตำแหน่งแกน js/growth-charts.js

ไฟล์ต้นฉบับ: PDF "กราฟแสดงเกณฑ์อ้างอิงการเจริญเติบโต" สำนักโภชนาการ กรมอนามัย พ.ศ. 2564
  (0–5 ปี = WHO 2006 · 6–19 ปี = เกณฑ์อ้างอิงเด็กไทย 2563) · เจ้าของเว็บส่งมาทาง Google Drive
ใช้:  python3 tools/growth/charts.py <โฟลเดอร์ PDF>
  ตัดภาพเฉพาะส่วนกราฟ (หัวเรื่อง + พื้นที่กราฟ + แกน) แล้วคำนวณตำแหน่งแกนเป็นสัดส่วนของภาพ
  0–5 ปี: กรอบพื้นที่กราฟจากเส้นในไฟล์ (vector) · 6–19 ปี: ตำแหน่งตัวเลขบนแกน (ข้อความในไฟล์)
  หน้าเว็บ (js/pages/dose.js) วางจุดแดง: left = ax·ค่าแกนนอน + bx, top = ay·ค่าแกนตั้ง + by (สัดส่วน 0–1)
"""
import json, os, re, sys
import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_IMG = os.path.join(ROOT, 'assets', 'growth')
OUT_JS = os.path.join(ROOT, 'js', 'growth-charts.js')
WIDTH = 1200   # ความกว้างภาพ (px)

# กราฟ 0–5 ปี (แนวนอน): กรอบพื้นที่กราฟ (พิกัดก่อนหมุนหน้า) + ช่วงค่าของแกน
#   kind: wfa น้ำหนักตามอายุ (x = อายุ เดือน) · hfa ความยาว/ส่วนสูงตามอายุ · wfh น้ำหนักตามความยาว/ส่วนสูง (x = ซม.)
VEC = [
    ('b0-5_1.pdf', 'm', 'wfa', 'น้ำหนักตามอายุ 0–5 ปี', [((65.9, 38.0, 483.1, 792.4), (0, 72), (0, 35))]),
    ('g0-5_1.pdf', 'f', 'wfa', 'น้ำหนักตามอายุ 0–5 ปี', [((63.4, 62.1, 480.6, 816.5), (0, 72), (0, 35))]),
    ('b0-5_2.pdf', 'm', 'hfa', 'ความยาว/ส่วนสูงตามอายุ 0–5 ปี', [((69.7, 577.9, 487.0, 809.2), (0, 24), (40, 140)), ((69.5, 57.7, 486.8, 519.8), (24, 72), (40, 140))]),
    ('g0-5_2.pdf', 'f', 'hfa', 'ความยาว/ส่วนสูงตามอายุ 0–5 ปี', [((82.3, 571.0, 499.6, 802.3), (0, 24), (40, 140)), ((82.1, 50.9, 499.4, 512.9), (24, 72), (40, 140))]),
    ('b2-5_2.pdf', 'm', 'wfl', 'น้ำหนักตามความยาว 0–2 ปี', [((88.0, 85.3, 512.2, 787.7), (45, 110), (0, 26))]),
    ('g2-5_2.pdf', 'f', 'wfl', 'น้ำหนักตามความยาว 0–2 ปี', [((85.7, 74.0, 509.9, 776.1), (45, 110), (0, 26))]),
    ('b2-5_1.pdf', 'm', 'wfh', 'น้ำหนักตามส่วนสูง 2–5 ปี', [((88.1, 65.2, 512.3, 767.5), (65, 140), (4, 51))]),
    ('g2-5_1.pdf', 'f', 'wfh', 'น้ำหนักตามส่วนสูง 2–5 ปี', [((100.7, 89.3, 524.9, 791.5), (65, 140), (4, 51))]),
]
# กราฟ 6–19 ปี (แนวตั้ง): ตำแหน่งแกนจากตัวเลขบนแกน · hfa แกนนอนเป็นปี → เก็บเป็นเดือน
TXT = [
    ('M-6-19_2.pdf', 'm', 'wfh619', 'น้ำหนักตามส่วนสูง 6–19 ปี', 1),
    ('W-6-19_2.pdf', 'f', 'wfh619', 'น้ำหนักตามส่วนสูง 6–19 ปี', 1),
    ('all-6-19.pdf', 'm', 'hfa619', 'ส่วนสูงตามอายุ 6–19 ปี', 12),
    ('g6-19-hfa.pdf', 'f', 'hfa619', 'ส่วนสูงตามอายุ 6–19 ปี', 12),
]


def fit(pairs):
    """ค่าบนแกน → พิกัด (least squares) · คืน (a, b) ที่ coord = a·v + b"""
    n = len(pairs); sx = sum(v for v, _ in pairs); sy = sum(c for _, c in pairs)
    sxx = sum(v * v for v, _ in pairs); sxy = sum(v * c for v, c in pairs)
    a = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    return a, (sy - a * sx) / n


def save(page, clip, name):
    zoom = (WIDTH if clip.width > clip.height else WIDTH * 0.75) / clip.width   # กราฟแนวตั้งกว้าง 900 px
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip)
    pix.save(os.path.join(OUT_IMG, name), jpg_quality=76)
    return pix.width, pix.height


def main(src):
    os.makedirs(OUT_IMG, exist_ok=True)
    charts = []
    for f, sex, kind, title, panels in VEC:
        page = pymupdf.open(os.path.join(src, f))[0]
        rects = [pymupdf.Rect(r) * page.rotation_matrix for r, _, _ in panels]
        clip = pymupdf.Rect(0, 0, page.rect.width, max(r.y1 for r in rects) + 26)
        name = f'{sex}-{kind}.jpg'
        w, h = save(page, clip, name)
        segs = []
        for r, (x0, x1), (y0, y1) in zip(rects, [p[1] for p in panels], [p[2] for p in panels]):
            ax = (r.x1 - r.x0) / (x1 - x0) / clip.width; bx = (r.x0 - clip.x0) / clip.width - ax * x0
            ay = -(r.y1 - r.y0) / (y1 - y0) / clip.height; by = (r.y1 - clip.y0) / clip.height - ay * y0
            segs.append({'x': [x0, x1], 'y': [y0, y1], 'ax': round(ax, 6), 'bx': round(bx, 6), 'ay': round(ay, 6), 'by': round(by, 6)})
        charts.append({'id': f'{sex}-{kind}', 'sex': sex, 'kind': kind, 'title': title, 'img': f'assets/growth/{name}', 'w': w, 'h': h, 'segs': segs})
    for f, sex, kind, title, xmul in TXT:
        page = pymupdf.open(os.path.join(src, f))[0]
        nums = [w for w in page.get_text('words') if re.fullmatch(r'\d{1,3}', w[4])]
        rows = {}
        for w in nums:
            if w[0] >= 60 and w[1] > 540: rows.setdefault(round(w[1]), []).append(w)
        bottom = max(rows.values(), key=len)                         # แถวตัวเลขแกนนอน
        left = [w for w in nums if w[0] < 66 and w[3] < min(b[1] for b in bottom) - 2]   # ตัวเลขแกนตั้ง (ซ้ายสุด · ไม่รวมตัวแรกของแกนนอน)
        fx = fit([(int(w[4]) * xmul, (w[0] + w[2]) / 2) for w in bottom])
        fy = fit([(int(w[4]), (w[1] + w[3]) / 2) for w in left])
        xs = [int(w[4]) * xmul for w in bottom]; ys = [int(w[4]) for w in left]
        clip = pymupdf.Rect(0, 0, page.rect.width, max(w[3] for w in bottom) + 22)
        name = f'{sex}-{kind}.jpg'
        w, h = save(page, clip, name)
        segs = [{'x': [min(xs), max(xs)], 'y': [min(ys) - 5, max(ys)],   # ตัวเลขล่างสุดของแกนตั้งชิดแกนนอน (ไม่ได้ใช้คำนวณ)
                 'ax': round(fx[0] / clip.width, 6), 'bx': round(fx[1] / clip.width, 6),
                 'ay': round(fy[0] / clip.height, 6), 'by': round(fy[1] / clip.height, 6)}]
        charts.append({'id': f'{sex}-{kind}', 'sex': sex, 'kind': kind, 'title': title, 'img': f'assets/growth/{name}', 'w': w, 'h': h, 'segs': segs})
    with open(OUT_JS, 'w', encoding='utf-8') as o:
        o.write('// กราฟการเจริญเติบโตของเด็ก (สำนักโภชนาการ กรมอนามัย พ.ศ. 2564) — สร้างด้วย tools/growth/charts.py (อย่าแก้มือ)\n')
        o.write('// segs: ช่วงค่าแกน x/y + ตำแหน่งจุด left = ax·x + bx, top = ay·y + by (สัดส่วนของภาพ 0–1) · kind: wfa/hfa (x = อายุ เดือน) · wfl/wfh/wfh619 (x = ซม.) · hfa619 (x = อายุ เดือน)\n')
        o.write('export const GROWTH_CHARTS = ' + json.dumps(charts, ensure_ascii=False) + ';\n')
    for c in charts: print(c['id'], c['w'], 'x', c['h'], os.path.getsize(os.path.join(OUT_IMG, c['id'] + '.jpg')) // 1024, 'KB', c['segs'])


if __name__ == '__main__':
    main(sys.argv[1])
