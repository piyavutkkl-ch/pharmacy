#!/usr/bin/env python3
"""ดึง drug interaction ระหว่างยา รพ.สต. จาก DDInter (https://ddinter.scbdd.com · ข้อมูล CC BY-NC-SA 4.0 · ใช้แบบไม่แสวงหากำไร + อ้างอิงที่มา)
   ขั้นตอน: CSV ดาวน์โหลดของ DDInter (ชื่อ→รหัส) → ยา รพ.สต. ที่ใช้ทั้งระบบ (map.py) → รายการ interaction ของแต่ละยา (interaction_id + กลไก)
            → หน้ารายละเอียดแต่ละคู่ (คำอธิบาย + การจัดการ) → ค่าทำนาย CYP (ADMETlab 2.0 ที่ DDInter แสดง) → tools/ddi/ddi.json
   ใช้: python3 tools/ddi/fetch.py <โฟลเดอร์ CSV ของ DDInter> (ต้องต่อเน็ต · หน่วงเวลาระหว่างคำขอ)"""
import csv, glob, html, json, pathlib, re, sys, time, urllib.parse, urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from map import SYSTEMIC, ALIAS, SKIP   # noqa: E402

root = pathlib.Path(__file__).resolve().parents[2]
BASE = 'https://ddinter.scbdd.com'
MECH = {'absorption': 'Absorption', 'distribution': 'Distribution', 'metabolism': 'Metabolism', 'excretion': 'Excretion',
        'synergistic_effect': 'Synergy', 'antagonistic_effect': 'Antagonism', 'others': 'Others'}
LEVEL = {1: 'Minor', 2: 'Moderate', 3: 'Major'}


def get(url, data=None):
    for i in range(5):
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode() if data else None, headers={'User-Agent': 'pharmacy-rpst/1.0'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode('utf-8', 'ignore')
        except Exception:
            time.sleep(2 ** i)
    raise RuntimeError(url)


def cell(page, key):
    m = re.search(r'<td class="key">' + key + r'</td>\s*<td[^>]*>(.*?)</td>', page, re.S)
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', m.group(1)))).strip() if m else ''


def main(csv_dir):
    names = {}
    for f in glob.glob(f'{csv_dir}/ddinter_downloads_code_*.csv') + glob.glob(f'{csv_dir}/dd_*.csv'):
        for r in csv.DictReader(open(f, encoding='utf-8')):
            names[r['Drug_A'].lower()] = (r['DDInterID_A'], r['Drug_A']); names[r['Drug_B'].lower()] = (r['DDInterID_B'], r['Drug_B'])
    local = json.loads(re.search(r'\$rpst\$(.*?)\$rpst\$', (root / 'supabase/58_local_drugs.sql').read_text(encoding='utf-8'), re.S).group(1))
    nlem = {f"2569:{d['sub_code']}:{d['no']}": d['name'] for d in json.loads((root / 'tools/nlem/nlem2569.json').read_text(encoding='utf-8'))}
    drugs, codes = {}, {}
    for l in local:
        if not any(k in l['category'] for k in SYSTEMIC):
            continue
        for g in sorted({nlem[r] for r in l['mono_refs']}):
            if g in SKIP:
                continue
            low = g.lower()
            cands = ALIAS.get(g) or [c for c in [low.split('(')[0].strip(), low.split(' ')[0], *[x.strip() for x in re.findall(r'\(([^)]*)\)', low)]] if c in names][:1]
            for c in cands:
                if c in names:
                    i, n = names[c]
                    drugs.setdefault(i, {'id': i, 'name': n, 'cyp': None})
                    codes.setdefault(l['code'], []).append(i)
    ids = set(drugs)
    pairs = {}
    for i in sorted(ids):
        js = json.loads(get(f'{BASE}/ddinter/interact-with/{i}/', {'draw': 1, 'start': 0, 'length': 5000}))
        for r in js['data']:
            if r['drug_id'] not in ids:
                continue
            key = tuple(sorted((i, r['drug_id'])))
            pairs.setdefault(key, {'a': key[0], 'b': key[1], 'iid': r['interaction_id'], 'level': LEVEL.get(r['level'], 'Unknown'),
                                   'mech': [v for k, v in MECH.items() if str(r.get(k)) == '1']})
        time.sleep(0.3)
        print('list', i, drugs[i]['name'], len(pairs), file=sys.stderr)
    for n, p in enumerate(pairs.values()):
        page = get(f"{BASE}/ddinter/interact/{p['iid']}/")
        p['desc'], p['mgmt'] = cell(page, 'Interaction'), cell(page, 'Management')
        for d in (p['a'], p['b']):
            if drugs[d]['cyp'] is None:
                cy = json.loads(get(f"{BASE}/ddinter/linkmarker/{p['iid']}/"))
                for nm, v in cy.items():
                    for x in (p['a'], p['b']):
                        if drugs[x]['name'].lower() == nm.lower() and drugs[x]['cyp'] is None:
                            drugs[x]['cyp'] = {k: round(float(val), 3) for k, val in v.items()}
        time.sleep(0.25)
        if n % 50 == 0:
            print('detail', n, len(pairs), file=sys.stderr)
    out = {'source': 'DDInter (https://ddinter.scbdd.com) · CC BY-NC-SA 4.0 · CYP = ค่าทำนาย ADMETlab 2.0',
           'drugs': sorted(drugs.values(), key=lambda d: d['name']), 'codes': codes,
           'pairs': sorted(pairs.values(), key=lambda p: (p['a'], p['b']))}
    (root / 'tools/ddi/ddi.json').write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding='utf-8')
    print('drugs', len(drugs), 'pairs', len(pairs), file=sys.stderr)


if __name__ == '__main__':
    main(sys.argv[1])
