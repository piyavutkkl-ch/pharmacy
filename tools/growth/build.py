#!/usr/bin/env python3
"""ค่าน้ำหนักตามเกณฑ์ WHO Child Growth Standards 2006 (เด็ก 0–5 ปี · กรมอนามัยใช้เกณฑ์นี้) → js/growth.js
   ที่มา: ตาราง z-score ของ WHO (ชุดเดียวกับแพ็กเกจ pygrowup บน PyPI): น้ำหนักตามอายุ 0–60 เดือน · น้ำหนักตามความยาว 45–110 ซม. (< 2 ปี) · น้ำหนักตามส่วนสูง 65–120 ซม. (2–5 ปี)
   ใช้: pip download --no-deps pygrowup && แตกไฟล์ แล้ว python3 tools/growth/build.py <โฟลเดอร์ pygrowup/tables>"""
import json, pathlib, sys

src = pathlib.Path(sys.argv[1])
root = pathlib.Path(__file__).resolve().parents[2]


def table(name, key):
    rows = json.loads((src / name).read_text())
    # [ค่าอ้างอิง (เดือน/ซม.), -2SD, ค่ากลาง (M), +2SD]
    return [[float(r[key]), float(r['SD2neg']), round(float(r['M']), 2), float(r['SD2'])] for r in rows]


data = {sex: {'age': table(f'wfa_{sx}_0_5_zscores.json', 'Month'), 'len': table(f'wfl_{sx}_0_2_zscores.json', 'Length'),
              'hgt': table(f'wfh_{sx}_2_5_zscores.json', 'Height')} for sex, sx in (('m', 'boys'), ('f', 'girls'))}
js = """// น้ำหนักตามเกณฑ์ WHO Child Growth Standards 2006 (เด็ก 0–5 ปี · เกณฑ์ที่กรมอนามัยใช้) — สร้างด้วย tools/growth/build.py (อย่าแก้มือ)
// แถว = [อายุ (เดือน) หรือ ความยาว/ส่วนสูง (ซม.), น้ำหนัก -2SD, ค่ากลาง, +2SD] (กก.)
const W = """ + json.dumps(data, separators=(',', ':')) + """;

/** ประมาณน้ำหนักเด็กจาก ส่วนสูง (ถ้ามี) หรือ อายุ · months = อายุเป็นเดือน · คืน null ถ้าอยู่นอกช่วงของเกณฑ์ */
export function estimateWeight({ months, height, sex }) {
  const t = W[sex === 'f' ? 'f' : 'm'];
  const pick = (rows, x, step) => { const r = rows.find((row) => Math.abs(row[0] - x) < step / 2 + 1e-9); return r && { lo: r[1], mid: r[2], hi: r[3] }; };
  if (height > 0 && (months == null || months < 61)) {
    const useLen = months != null ? months < 24 : height < 87;   // < 2 ปี วัดความยาว (นอนวัด) · 2–5 ปี วัดส่วนสูง (ยืน)
    const r = pick(useLen ? t.len : t.hgt, Math.round(height * 2) / 2, 0.5);
    if (r) return { ...r, by: useLen ? 'ความยาว' : 'ส่วนสูง', x: Math.round(height * 2) / 2 };
  }
  if (months != null && months >= 0 && months <= 60) {
    const r = pick(t.age, Math.round(months), 1);
    if (r) return { ...r, by: 'อายุ', x: Math.round(months) };
  }
  return null;
}
"""
(root / 'js/growth.js').write_text(js, encoding='utf-8')
print('ok', sum(len(v) for t in data.values() for v in t.values()), 'rows')
