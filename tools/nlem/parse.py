#!/usr/bin/env python3
"""ถอดรายการยาจาก "บัญชียาหลักแห่งชาติ พ.ศ. ๒๕๖๙" (ราชกิจจานุเบกษา เล่ม ๑๔๓ ตอนพิเศษ ๘๕ ง · 30 มี.ค. 2569)
   ภาคผนวก 1 (บัญชียาสำหรับโรงพยาบาลฯ หน้า PDF 21–127) → JSON รายการ monograph
   ใช้: pip install pymupdf && python3 tools/nlem/parse.py <111371.pdf> > tools/nlem/nlem2569.json && python3 tools/nlem/build_sql.py
   ต้นฉบับ: https://ratchakitcha.soc.go.th/documents/111371.pdf (เอกสารราชการ · ไม่เก็บไฟล์ PDF ใน repo)
   อ่านตามตำแหน่งคอลัมน์ในหน้า: เลขข้อ (x<80) · ชื่อยา (80–355) · รูปแบบยา (355–535) · บัญชี (≥535) · หัวข้อตัวหนา = เงื่อนไข/คำเตือน/…"""
import json, re, sys
import pymupdf

FIRST, LAST = 21, 127
X_NAME, X_FORM, X_ACCT = 80, 340, 535
ACCTS = {'b', 's', 'ex', 'R1', 'R2', 'R1/R2'}
THAI = re.compile(r'[฀-๿]')
FLAG = re.compile(r'^(ยากำพร้า|วัตถุ(ที่)?ออกฤทธิ์ต่อจิตและประสาท|ยาเสพติดให้โทษ)')
FLAG_SPLIT = re.compile(r'(?<=\S)(?=วัตถุ(?:ที่)?ออกฤทธิ์|ยาเสพติดให้โทษ)')
SKIP = re.compile(r'^([๐-๙]+|หนา\s.*|หน้า\s.*|เลม\s.*|เล่ม\s.*|ตอนพิเศษ.*|ราชกิจจานุเบกษา|[๐-๙]+\s+มีนาคม\s+[๐-๙]+)$')


def rows_of(page):
    """แถวตามแนวนอน: [(y, [(x0, x1, bold, size, text)…])] — แยกช่วงข้อความเมื่อตัวอักษรห่างกัน ≥ 8pt (คนละคอลัมน์)"""
    items = []
    for b in page.get_text('rawdict')['blocks']:
        for l in b.get('lines', []):
            for sp in l['spans']:
                bold, size = 'Bold' in sp['font'], round(sp['size'])
                seg = None
                for ch in sp['chars']:
                    c, (x0, y0, x1, y1) = ch['c'], ch['bbox']
                    if c.isspace():
                        if seg:
                            seg[5] += ' '
                        continue
                    if seg and x0 - seg[2] >= 8:
                        items.append(seg); seg = None
                    if not seg:
                        seg = [round(l['bbox'][1], 1), x0, x1, bold, size, '']   # y ของบรรทัด (ตัวห้อย เช่น B₁ อยู่แถวเดียวกัน)
                    seg[2] = max(seg[2], x1); seg[5] += c
                if seg:
                    items.append(seg)
    items.sort(key=lambda i: (i[0], i[1]))
    rows = []
    for it in items:
        if rows and abs(rows[-1][0] - it[0]) <= 4:
            rows[-1][1].append(it)
        else:
            rows.append([it[0], [it]])
    out = []
    for y, its in rows:
        its.sort(key=lambda i: i[1])
        segs = []
        for _, x0, x1, bold, size, t in its:
            if segs and x0 - segs[-1][1] < 8:
                a = segs[-1]
                segs[-1] = (a[0], max(a[1], x1), a[2] and bold, max(a[3], size), a[4] + t)
            else:
                segs.append((x0, x1, bold, size, t))
        segs = [(a, b, c, d, re.sub(r'\s+', ' ', e).strip()) for a, b, c, d, e in segs if e.strip()]
        txt = ' '.join(x[4] for x in segs)
        if not segs or y > 775 or SKIP.match(txt):
            continue
        out.append((y, segs))
    return out


def join(a, b):
    if not a:
        return b
    if THAI.search(a[-1:]) and THAI.search(b[:1]):
        return a + b
    return a + ' ' + b


NEWPARA = re.compile(r'^(\d+(\.\d+)*\.?\s|\d+\.(?=\D)|[-•*]\s?|\(\d+\)|[๐-๙]+\.|ข้อ\s)')


def paras(lines):
    """รวมบรรทัดที่ถูกตัดเป็นย่อหน้า · บรรทัดขึ้นต้นด้วยเลขข้อ/ขีด = ย่อหน้าใหม่"""
    out = []
    for ln in lines:
        if out and not NEWPARA.match(ln):
            out[-1] = join(out[-1], ln)
        else:
            out.append(ln)
    return out


def split_name(segs):
    """แยกช่วงข้อความในแถวหัวข้อยาเป็น ชื่อ/รูปแบบ/บัญชี (ช่วงที่คร่อมคอลัมน์ → ตัดที่คำ)"""
    name, form, acct = [], [], []
    for x0, x1, bold, size, t in segs:
        if x0 >= X_ACCT and t in ACCTS:
            acct.append(t)
        elif x0 >= X_FORM:
            form.append(t)
        else:
            name.append(t)
    return ' '.join(name), ' '.join(form), ' '.join(acct)


def main(pdf):
    doc = pymupdf.open(pdf)
    drugs, notes, group, sub, cur, mode = [], {}, None, None, None, None

    def close():
        nonlocal cur
        if not cur:
            return
        secs = []
        for title, lines in cur['_secs']:
            body = paras(lines)
            if body:
                secs.append({'title': title, 'body': body})
        cur['sections'] = secs
        del cur['_secs']
        cur['name'] = re.sub(r'\s+', ' ', cur['name']).strip()
        if not cur['forms'] and THAI.search(cur['name'][:3]):   # ข้อความเลขข้อของกลุ่มยา (ไม่ใช่ตัวยา)
            notes.setdefault(cur['sub_code'], []).append(f"{cur['no']}. {cur['name']}")
            notes[cur['sub_code']] += [b for x in secs for b in x['body']]
        else:
            drugs.append(cur)
        cur = None

    for pn in range(FIRST, LAST + 1):
        for y, segs in rows_of(doc[pn - 1]):
            x0, bold, size, txt = segs[0][0], segs[0][2], segs[0][3], ' '.join(s[4] for s in segs)
            if x0 < X_NAME and bold and size >= 17:          # หัวข้อกลุ่ม/กลุ่มย่อย
                if txt.startswith('บัญชียาสำหรับ'):
                    continue
                close(); mode = None
                m = re.match(r'กลุ่มยา\s*(\d+)\s+(.*)', txt)
                if m:
                    group = {'no': int(m.group(1)), 'name': m.group(2).strip()}; sub = None
                else:
                    m = re.match(r'(\d+(?:\.\d+)+)\s*(.*)', txt)
                    if m:
                        sub = {'code': m.group(1), 'name': m.group(2).strip()}
                    elif sub:
                        sub['name'] = join(sub['name'], txt)
                continue
            if x0 < X_NAME and re.fullmatch(r'\d+\.?', segs[0][4]) and len(segs) > 1:   # ยาข้อใหม่
                close()
                n, f, a = split_name(segs[1:])
                cur = {'group_no': group['no'], 'group': group['name'], 'sub_code': sub['code'] if sub else str(group['no']),
                       'sub': sub['name'] if sub else '', 'no': int(segs[0][4].rstrip('.')), 'page': pn,
                       'name': n, 'flags': [], 'forms': [], '_secs': []}
                if f or a:
                    cur['forms'].append({'form': f, 'acct': a})
                mode = 'head'
                continue
            if not cur:
                continue
            if bold and len(txt) <= 40 and not re.match(r'^\d', txt):  # หัวข้อในยา: เงื่อนไข / คำเตือนและข้อควรระวัง / …
                cur['_secs'].append([txt.rstrip(' :'), []]); mode = 'body'
                continue
            if mode == 'head':
                n, f, a = split_name(segs)
                m = FLAG.match(n)
                if m:                                        # ป้ายใต้ชื่อยา: ยากำพร้า / ยาเสพติดให้โทษ / วัตถุออกฤทธิ์ฯ
                    cur['flags'] += [x.strip() for x in FLAG_SPLIT.split(n) if x.strip()]; n = ''
                elif n and (re.match(r'^[+(A-Za-z0-9]', n) and not THAI.search(n[:12])) and len(n) < 70:
                    cur['name'] = join(cur['name'], n); n = ''   # ชื่อยาต่อบรรทัด เช่น "+ Simeticone 25-50 mg"
                if not n and not f and not a:
                    continue
                if not n and (f or a):                       # รูปแบบยาบรรทัดต่อ
                    if a or not cur['forms']:
                        cur['forms'].append({'form': f, 'acct': a})
                    else:
                        cur['forms'][-1]['form'] = join(cur['forms'][-1]['form'], f)
                    continue
                cur['_secs'].append(['รายละเอียด', []]); mode = 'body'
            if not cur['_secs']:
                cur['_secs'].append(['รายละเอียด', []])
            cur['_secs'][-1][1].append(txt)
    close()
    for d in drugs:
        if d['sub_code'] in notes:
            d['sections'].append({'title': 'หมายเหตุของกลุ่มยา', 'body': notes[d['sub_code']]})
    # รูปแบบยาที่ไม่มีบัญชีกำกับ → ใช้บัญชีของแถวก่อนหน้า
    for d in drugs:
        last = ''
        for f in d['forms']:
            f['acct'] = f['acct'] or last; last = f['acct']
            f['form'] = re.sub(r'\s*,\s*$', '', f['form'])
    sys.stdout.write("[\n" + ",\n".join(json.dumps(d, ensure_ascii=False, separators=(",", ":")) for d in drugs) + "\n]\n")   # 1 ยา = 1 บรรทัด (ดู diff ง่าย)


if __name__ == '__main__':
    main(sys.argv[1])
