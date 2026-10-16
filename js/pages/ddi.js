// Drug interaction (#dosePaneDdi): เลือกยา รพ.สต. มาเทียบกันทีละคอลัมน์ (≤ 4 ตัว · กด + เพิ่ม / × ลบ) แบบเทียบสเปกมือถือ
//   แต่ละคอลัมน์: ภาพเส้นทางยาในร่างกาย (ให้ยา → ดูดซึม → ตับ/เอนไซม์ CYP → ออกฤทธิ์ → ขับออก) + โครงสร้าง (PubChem) + กลไก/เภสัชจลนศาสตร์ (ฉลาก openFDA)
//   ด้านบน: แจ้งเตือน interaction ระหว่างยาที่เลือก (ddi_pairs · 61_ddi.sql · DDInter) → กดดูภาพว่า interaction ที่ไหน เอนไซม์อะไร + คำอธิบาย/การจัดการ (ไทยจาก AI · อังกฤษพับไว้)
//   เฉพาะยา รพ.สต. ที่ใช้ทั้งระบบ (local_drugs.ddi_ids) · CYP = ค่าทำนาย ADMETlab 2.0 ที่ DDInter แสดง (≥ 0.7)
import { sb } from '../supabase.js?v=4.4';
import { $, esc, toast, errText } from '../util.js?v=4.4';
import { isAdmin } from '../auth.js?v=4.4';

const MAX = 4, CYP_MIN = 0.7;
const LEVEL = { Major: ['รุนแรง', 'ddi-major'], Moderate: ['ปานกลาง', 'ddi-mod'], Minor: ['เล็กน้อย', 'ddi-minor'], Unknown: ['ไม่ระบุระดับ', 'ddi-unk'] };
const RANK = { Major: 0, Moderate: 1, Minor: 2, Unknown: 3 };
const MECH = { Absorption: 'การดูดซึม', Distribution: 'การกระจายยา', Metabolism: 'การเปลี่ยนแปลงยา (ตับ)', Excretion: 'การขับออก', Synergy: 'เสริมฤทธิ์กัน', Antagonism: 'ต้านฤทธิ์กัน', Others: 'อื่น ๆ' };
const ENZ = ['CYP1A2', 'CYP2C9', 'CYP2C19', 'CYP2D6', 'CYP3A4'];

let loaded = null, bound = false, cols = [null], open = new Set();
let drugs = new Map(), pairs = [], locals = [];
const labelCache = new Map(), monoCache = new Map();

async function load() {
  if (loaded) return loaded;
  loaded = (async () => {
    const [d, p, l] = await Promise.all([
      sb.from('ddi_drugs').select('*'),
      sb.from('ddi_pairs').select('id,a,b,level,mech,description,management,description_th,management_th,th_reviewed,iid'),
      sb.from('local_drugs').select('id,name,category,ddi_ids,fda_key,mono_refs,sort').eq('active', true).order('sort'),
    ]);
    const err = d.error || p.error || l.error;
    if (err) { loaded = null; throw err; }
    drugs = new Map(d.data.map((x) => [x.id, x]));
    pairs = p.data;
    locals = l.data.filter((x) => (x.ddi_ids || []).some((i) => drugs.has(i)));
    return true;
  })();
  return loaded;
}
/** ให้โหลดใหม่ครั้งถัดไป (เรียกหลังผู้ดูแลแก้ข้อมูล) */
export function resetDdi() { loaded = null; labelCache.clear(); monoCache.clear(); }

export async function initDdi() {
  if (!bound) {
    bound = true;
    $('#ddiCols').addEventListener('change', (e) => {
      const s = e.target.closest('[data-ddi-sel]'); if (!s) return;
      cols[+s.dataset.ddiSel] = s.value ? +s.value : null; open.clear(); render();
    });
    $('#ddiCols').addEventListener('click', (e) => {
      if (e.target.closest('[data-ddi-add]')) { if (cols.length < MAX) cols.push(null); render(); return; }
      const x = e.target.closest('[data-ddi-del]');
      if (x) { cols.splice(+x.dataset.ddiDel, 1); if (!cols.length) cols = [null]; open.clear(); render(); }
    });
    $('#ddiAlerts').addEventListener('click', (e) => {
      const ed = e.target.closest('[data-edit-drug]');   // ผู้ดูแล: ไปแก้คู่นี้ใน ข้อมูลยา › ฐานข้อมูลยา
      if (ed) { try { sessionStorage.setItem('pcps_drug_edit', ed.dataset.editDrug); } catch { /* ไม่เป็นไร */ } return; }
      const b = e.target.closest('[data-ddi-pair]'); if (!b) return;
      const id = +b.dataset.ddiPair; open.has(id) ? open.delete(id) : open.add(id); renderAlerts();
    });
  }
  $('#ddiCols').innerHTML = '<div class="skeleton"></div><div class="skeleton" style="width:70%;margin-top:10px"></div>';
  try { await load(); } catch (err) { $('#ddiCols').innerHTML = '<p class="empty">โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่</p>'; toast(errText(err), 'err'); return; }
  render();
}

const locOf = (id) => locals.find((l) => l.id === id);
const namesOf = (l) => (l?.ddi_ids || []).map((i) => drugs.get(i)?.name).filter(Boolean);
function options(sel) {
  let cat = null, out = '<option value="">— เลือกยา รพ.สต. —</option>';
  for (const l of locals) {
    if (l.category !== cat) { out += `${cat ? '</optgroup>' : ''}<optgroup label="${esc(l.category)}">`; cat = l.category; }
    out += `<option value="${l.id}"${l.id === sel ? ' selected' : ''}>${esc(l.name)}</option>`;
  }
  return out + (cat ? '</optgroup>' : '');
}
function render() {
  $('#ddiCols').innerHTML = cols.map((id, i) => `<section class="ddi-col" aria-label="ยาตัวที่ ${i + 1}"><div class="ddi-col-head"><b>ยาตัวที่ ${i + 1}</b>`
    + (cols.length > 1 ? `<button type="button" class="nt-x" data-ddi-del="${i}" aria-label="เอายาตัวที่ ${i + 1} ออก">×</button>` : '') + '</div>'
    + `<label class="sr-only" for="ddiSel${i}">เลือกยาตัวที่ ${i + 1}</label><select id="ddiSel${i}" class="input" data-ddi-sel="${i}">${options(id)}</select>`
    + `<div class="ddi-body" id="ddiBody${i}">${id ? '<div class="skeleton"></div>' : '<p class="small muted">เลือกยาเพื่อดูเส้นทางยาในร่างกาย กลไก และเภสัชจลนศาสตร์</p>'}</div></section>`).join('')
    + (cols.length < MAX ? '<button type="button" class="ddi-add" data-ddi-add><span aria-hidden="true">+</span>เพิ่มยาเพื่อเทียบ</button>' : '');
  cols.forEach((id, i) => { if (id) fillCol(i, locOf(id)); });
  renderAlerts();
}

/* ---------- คอลัมน์ยา ---------- */
async function labelOf(key) {
  if (!key) return null;
  if (!labelCache.has(key)) labelCache.set(key, sb.from('drug_fda_labels').select('title,sections,sections_th,th_reviewed').eq('key', key).maybeSingle().then((r) => r.data || null));
  return labelCache.get(key);
}
async function groupsOf(refs) {
  const k = (refs || []).join(',');
  if (!k) return [];
  if (!monoCache.has(k)) monoCache.set(k, sb.from('drug_monographs').select('sub_code,sub_name,group_name').in('ref', refs).then((r) => r.data || []));
  return monoCache.get(k);
}
const routeOf = (l) => (/ฉีด|สารน้ำ|Emergency/.test(l.category) && !/TAB|CAP|MG\b(?!\/)/i.test(l.name) ? 'iv' : /พ่น/.test(l.category) ? 'inh' : 'oral');
const cypOf = (ids) => {
  const sub = new Set(), inh = new Set();
  for (const i of ids) {
    const c = drugs.get(i)?.cyp || {};
    for (const e of ENZ) { if (+c[`${e}-sub`] >= CYP_MIN) sub.add(e); if (+c[`${e}-inh`] >= CYP_MIN) inh.add(e); }
  }
  return { sub: [...sub], inh: [...inh], known: ids.some((i) => Object.keys(drugs.get(i)?.cyp || {}).length) };
};
/** ค่าครึ่งชีวิตจากข้อความเภสัชจลนศาสตร์ (ภาษาอังกฤษ) เช่น "half-life of 30 to 50 hours" */
export function halfLife(text) {
  const m = /half[- ]?life[^.]{0,90}?(\d+(?:\.\d+)?(?:\s*(?:to|-|–|and)\s*\d+(?:\.\d+)?)?)\s*(hours?|hrs?|h\b|minutes?|min\b|days?)/i.exec(String(text || ''));
  if (!m) return '';
  const u = /^d/i.test(m[2]) ? 'วัน' : /^m/i.test(m[2]) ? 'นาที' : 'ชั่วโมง';
  return `${m[1].replace(/\s*(to|and|-|–)\s*/i, '–')} ${u}`;
}
function sectionOf(lab, title) {
  if (!lab) return null;
  const th = lab.sections_th?.find((x) => x.title === title), en = lab.sections?.find((x) => x.title === title);
  if (!th && !en) return null;
  return { th: th?.body || null, en: en?.body || '' };
}
const textBlock = (title, s, open = false) => (s ? `<details class="mono-fold"${open ? ' open' : ''}><summary>${esc(title)}</summary>`
  + (s.th ? `<ul>${s.th.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${s.en ? `<details class="mono-en"><summary>ต้นฉบับภาษาอังกฤษ</summary><p lang="en">${esc(s.en)}</p></details>` : ''}`
    : `<p lang="en" class="small">${esc(s.en)}</p>`) + '</details>' : '');

async function fillCol(i, l) {
  if (!l) return;
  const [lab, groups] = await Promise.all([labelOf(l.fda_key), groupsOf(l.mono_refs)]);
  if (cols[i] !== l.id) return;   // ผู้ใช้เปลี่ยนยาไปแล้วระหว่างรอ
  const names = namesOf(l), cyp = cypOf(l.ddi_ids || []), route = routeOf(l);
  const moa = sectionOf(lab, 'กลไกการออกฤทธิ์'), pk = sectionOf(lab, 'เภสัชจลนศาสตร์'), ind = sectionOf(lab, 'ข้อบ่งใช้');
  const hl = halfLife(pk?.en);
  const grp = [...new Set(groups.map((g) => `${g.sub_code} ${g.sub_name}`))];
  $(`#ddiBody${i}`).innerHTML = `<h4 class="ddi-name">${esc(names.join(' + ') || l.name)}</h4>`
    + `<div class="di-chips">${grp.map((g) => `<span class="chip c-sub">${esc(g)}</span>`).join('')}${hl ? `<span class="chip c-role">ครึ่งชีวิต ≈ ${esc(hl)}</span>` : ''}</div>`
    + `<div class="ddi-struct">${names.map((n) => `<img src="https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(n)}/PNG?image_size=220x150" alt="โครงสร้างเคมีของ ${esc(n)}" loading="lazy" width="220" height="150">`).join('')}</div>`
    + pathSvg(route, cyp, names)
    + '<div class="ddi-text">' + textBlock('กลไกการออกฤทธิ์', moa, true) + textBlock('เภสัชจลนศาสตร์ (ดูดซึม · เปลี่ยนแปลง · ขับออก)', pk) + textBlock('ข้อบ่งใช้', ind)
    + (lab ? '' : '<p class="small muted">ยังไม่มีข้อมูลฉลากยา (openFDA) ของยานี้</p>') + '</div>';
  $(`#ddiBody${i}`).querySelectorAll('.ddi-struct img').forEach((img) => img.addEventListener('error', () => img.remove(), { once: true }));
}

/** ตับเปลี่ยนยาเป็นรูปไหน (ข้อมูลเภสัชวิทยาทั่วไป · ชื่อตาม DDInter ตัวพิมพ์เล็ก)
 *  active = ยาตั้งต้น (prodrug) → รูปที่ออกฤทธิ์ · both = ได้สารที่ยังออกฤทธิ์ด้วย · inactive = รูปที่ไม่ออกฤทธิ์ · unchanged = แทบไม่ถูกเปลี่ยน ขับออกรูปเดิม
 *  na = แร่ธาตุ/สารอาหาร/เกลือแร่ · none = ไม่ถูกดูดซึม */
const MET = {
  enalapril: ['active', 'enalaprilat'], losartan: ['active', 'E-3174'], simvastatin: ['active', 'simvastatin acid'], methyldopa: ['active', 'alpha-methylnorepinephrine (ในสมอง)'],
  albendazole: ['active', 'albendazole sulfoxide'], 'acetylsalicylic acid': ['active', 'salicylic acid'], 'isosorbide dinitrate': ['active', 'isosorbide mononitrate'],
  levothyroxine: ['active', 'T3 (liothyronine) ที่เนื้อเยื่อ'], 'folic acid': ['active', 'tetrahydrofolate'], dimenhydrinate: ['active', 'diphenhydramine'],
  spironolactone: ['both', 'canrenone'], amitriptyline: ['both', 'nortriptyline'], dextromethorphan: ['both', 'dextrorphan'], hydroxyzine: ['both', 'cetirizine'],
  allopurinol: ['both', 'oxypurinol'], pioglitazone: ['both', 'M-III, M-IV'], verapamil: ['both', 'norverapamil'], lidocaine: ['both', 'MEGX'],
  metronidazole: ['both', 'hydroxymetronidazole'], propranolol: ['both', '4-hydroxypropranolol'],
  acetaminophen: ['inactive'], amlodipine: ['inactive'], chlorpheniramine: ['inactive'], colchicine: ['inactive'], cyproheptadine: ['inactive'], dexamethasone: ['inactive'],
  diclofenac: ['inactive'], dicyclomine: ['inactive'], doxazosin: ['inactive'], erythromycin: ['inactive'], gemfibrozil: ['inactive'], glipizide: ['inactive'], hydralazine: ['inactive'],
  ibuprofen: ['inactive'], 'medroxyprogesterone acetate': ['inactive'], metoprolol: ['inactive'], naproxen: ['inactive'], nifedipine: ['inactive'], propylthiouracil: ['inactive'],
  salbutamol: ['inactive'], sulfamethoxazole: ['inactive'], theophylline: ['inactive'], epinephrine: ['inactive'], 'insulin human': ['inactive'],
  amoxicillin: ['unchanged'], dicloxacillin: ['unchanged'], metformin: ['unchanged'], furosemide: ['unchanged'], hydrochlorothiazide: ['unchanged'], norfloxacin: ['unchanged'],
  trimethoprim: ['unchanged'], ipratropium: ['unchanged'],
  'ascorbic acid': ['na'], 'calcium carbonate': ['na'], 'dextrose, unspecified form': ['na'], 'ferrous fumarate': ['na'], 'ferrous sulfate anhydrous': ['na'], iron: ['na'],
  'magnesium hydroxide': ['na'], 'sodium bicarbonate': ['na'], 'sodium chloride': ['na'], simethicone: ['none'],
};
/** ข้อความในกล่องตับ: เปลี่ยนเป็นรูปที่ออกฤทธิ์ / ไม่ออกฤทธิ์ */
export function metText(name) {
  const [k, m] = MET[String(name || '').toLowerCase()] || [];
  return { active: `เปลี่ยนเป็นรูปที่ออกฤทธิ์${m ? ` (${m})` : ''} · ยาตั้งต้นออกฤทธิ์น้อย`, both: `ได้สารที่ยังออกฤทธิ์${m ? ` (${m})` : ''} · ส่วนที่เหลือไม่ออกฤทธิ์`,
    inactive: 'เปลี่ยนเป็นรูปที่ไม่ออกฤทธิ์ แล้วขับออก', unchanged: 'แทบไม่ถูกเปลี่ยนที่ตับ · ขับออกในรูปเดิม (ยังออกฤทธิ์)',
    na: 'ไม่ผ่านการเปลี่ยนแปลงยาแบบทั่วไป (แร่ธาตุ/สารอาหาร)', none: 'ไม่ถูกดูดซึม · ออกฤทธิ์ในทางเดินอาหาร' }[k] || 'ยังไม่มีข้อมูลรูปที่ได้หลังเปลี่ยนแปลง';
}
const metClass = (name) => ({ active: 'met-on', both: 'met-on', inactive: 'met-off', unchanged: 'met-same' }[(MET[String(name || '').toLowerCase()] || [])[0]] || '');

/** ภาพเส้นทางยาในร่างกาย: ให้ยา → ดูดซึม → ตับ (เอนไซม์ + รูปที่ได้) → กระแสเลือด/ออกฤทธิ์ → ขับออก (HTML · ข้อความตัดบรรทัดเองพอดีกล่อง) */
function pathSvg(route, cyp, names = []) {
  const first = route === 'iv' ? ['ฉีด/หยดเข้าหลอดเลือด', 'เข้าสู่กระแสเลือดทันที'] : route === 'inh' ? ['พ่นสูดทางปาก', 'ออกฤทธิ์ที่ปอด/หลอดลม'] : ['รับประทาน', 'ดูดซึมที่กระเพาะ–ลำไส้'];
  const cypList = (l) => `CYP ${l.map((e) => e.replace('CYP', '')).join(', ')}`;
  const sub = cyp.sub.length ? `ถูกเปลี่ยนโดย ${cypList(cyp.sub)}` : cyp.known ? 'ไม่เด่นที่ CYP หลัก' : 'ไม่มีข้อมูลเอนไซม์';
  const inh = cyp.inh.length ? `ยับยั้ง ${cypList(cyp.inh)}` : '';
  const met = names.map((n) => `<span class="ddi-met ${metClass(n)}">${names.length > 1 ? `${esc(n)}: ` : ''}${esc(metText(n))}</span>`).join('');
  const box = (cls, title, body) => `<li class="ddi-step ${cls}"><b>${esc(title)}</b>${body}</li>`;
  return `<ol class="ddi-path" aria-label="${esc(`เส้นทางยา: ${first[0]} ${first[1]} → ตับ ${sub}${inh ? ' ' + inh : ''} ${names.map(metText).join(' ')} → ออกฤทธิ์ → ขับออก`)}">`
    + box('ddi-b1', `1. ${first[0]}`, `<span>${esc(first[1])}</span>`)
    + box('ddi-b2', '2. ตับ (การเปลี่ยนแปลงยา)', `<span>${esc(sub)}</span>${inh ? `<span class="ddi-inh-t">${esc(inh)}</span>` : ''}${met}`)
    + box('ddi-b3', '3. กระแสเลือด → ออกฤทธิ์', '<span>ไปยังอวัยวะเป้าหมาย</span>')
    + box('ddi-b4', '4. ขับออก', '<span>ทางไต (ปัสสาวะ) / น้ำดี (อุจจาระ)</span>')
    + `</ol><p class="ddi-foot">เอนไซม์ = ค่าทำนาย ADMETlab 2.0 (≥ ${CYP_MIN}) · รูปที่ได้ = ข้อมูลเภสัชวิทยาทั่วไป</p>`;
}

/* ---------- แจ้งเตือน interaction ระหว่างยาที่เลือก ---------- */
function selectedPairs() {
  const sets = cols.map((id) => (id ? locOf(id)?.ddi_ids || [] : []));
  const out = new Map();
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      for (const x of sets[i]) {
        for (const y of sets[j]) {
          const [a, b] = x < y ? [x, y] : [y, x];
          const p = pairs.find((q) => q.a === a && q.b === b);
          if (p) out.set(p.id, { ...p, ci: i, cj: j });
        }
      }
    }
  }
  return [...out.values()].sort((p, q) => RANK[p.level] - RANK[q.level]);
}
function renderAlerts() {
  const chosen = cols.filter(Boolean).length, list = selectedPairs(), box = $('#ddiAlerts');
  if (chosen < 2) { box.innerHTML = '<p class="small muted ddi-hint">เลือกยาอย่างน้อย 2 ตัวเพื่อตรวจ drug interaction</p>'; return; }
  if (!list.length) { box.innerHTML = '<div class="ddi-ok">✓ ไม่พบ drug interaction ระหว่างยาที่เลือก (ตามฐานข้อมูล DDInter) · ยังควรพิจารณาร่วมกับข้อมูลผู้ป่วยเสมอ</div>'; return; }
  box.innerHTML = `<p class="ddi-sum">พบ drug interaction <b>${list.length}</b> คู่ · กดแต่ละคู่เพื่อดูว่าเกิดที่ไหน อย่างไร</p>`
    + list.map((p) => {
      const [lv, cls] = LEVEL[p.level] || LEVEL.Unknown, A = drugs.get(p.a)?.name, B = drugs.get(p.b)?.name, on = open.has(p.id);
      return `<div class="ddi-alert ${cls}"><button type="button" class="ddi-alert-btn" data-ddi-pair="${p.id}" aria-expanded="${on}">`
        + `<span class="ddi-lv">${esc(p.level)} · ${lv}</span><b>${esc(A)} × ${esc(B)}</b>`
        + `<span class="di-chips">${(p.mech || []).map((m) => `<span class="chip c-off">${esc(MECH[m] || m)}</span>`).join('')}</span></button>`
        + (on ? detail(p, A, B) : '') + '</div>';
    }).join('');
}
function detail(p, A, B) {
  const th = p.description_th, mg = p.management_th;
  const enBlock = `<p lang="en"><b>Interaction:</b> ${esc(p.description || '-')}</p><p lang="en"><b>Management:</b> ${esc(p.management || '-')}</p>`;
  return `<div class="ddi-detail">${pairSvg(p, A, B)}`
    + `<h5>เกิดอะไรขึ้น</h5><p>${esc(th || p.description || 'ไม่มีคำอธิบายในฐานข้อมูล')}</p>`
    + `<h5>ควรทำอย่างไร</h5>${(mg || p.management) ? `<p class="ddi-mgmt">${esc(mg || p.management)}</p>` : '<p>-</p>'}`
    + (th ? `<details class="mono-en"><summary>ต้นฉบับภาษาอังกฤษ</summary>${enBlock}</details>` : '')
    + `<p class="small muted">${th ? (p.th_reviewed ? 'ภาษาไทย · ผู้ดูแลตรวจแล้ว · ' : 'แปลและเรียบเรียงโดย AI · โปรดตรวจกับต้นฉบับ · ') : ''}ที่มา: <a href="https://ddinter.scbdd.com/ddinter/interact/${+p.iid || ''}/" target="_blank" rel="noopener">DDInter</a> (CC BY-NC-SA 4.0) · ใช้ประกอบการตัดสินใจทางคลินิก ไม่ใช่คำสั่งการรักษา</p>`
    + (isAdmin() ? `<a class="btn btn-o btn-sm mono-edit" href="#/admin/drugs/ddi" data-edit-drug="ddi:${p.id}">แก้ไขข้อมูลนี้</a>` : '') + '</div>';
}
/** ภาพ interaction: ยา A — [ตำแหน่งที่เกิด: ลำไส้/ตับ+เอนไซม์/ไต/เลือด/ตัวรับ] — ยา B */
export function sharedEnzymes(a, b) {
  const ca = drugs.get(a)?.cyp || {}, cb = drugs.get(b)?.cyp || {}, out = [];
  for (const e of ENZ) {
    if (+ca[`${e}-inh`] >= CYP_MIN && +cb[`${e}-sub`] >= CYP_MIN) out.push({ e, inh: a, sub: b });
    if (+cb[`${e}-inh`] >= CYP_MIN && +ca[`${e}-sub`] >= CYP_MIN) out.push({ e, inh: b, sub: a });
  }
  return out;
}
function pairSvg(p, A, B) {
  const m = (p.mech || [])[0] || 'Others', enz = m === 'Metabolism' ? sharedEnzymes(p.a, p.b) : [];
  const site = { Absorption: ['ลำไส้', 'การดูดซึมยา'], Distribution: ['กระแสเลือด', 'การจับโปรตีน/กระจายยา'], Metabolism: ['ตับ', enz.length ? `เอนไซม์ ${enz.map((x) => x.e).join(', ')}` : 'เอนไซม์ที่ตับ'],
    Excretion: ['ไต', 'การขับยาออก'], Synergy: ['ตัวรับ/อวัยวะเป้าหมาย', 'ฤทธิ์เสริมกัน (+)'], Antagonism: ['ตัวรับ/อวัยวะเป้าหมาย', 'ฤทธิ์หักล้างกัน (−)'], Others: ['ร่างกาย', 'กลไกอื่น'] }[m] || ['ร่างกาย', 'กลไกอื่น'];
  const inhA = enz.some((x) => x.inh === p.a), inhB = enz.some((x) => x.inh === p.b);
  const role = (inh) => (m === 'Metabolism' && enz.length ? (inh ? 'ยับยั้ง' : 'ถูกเปลี่ยน') : m === 'Antagonism' ? 'ต้าน' : m === 'Synergy' ? 'เสริม' : '');
  const link = (inh, dir) => `<span class="pp-link${inh ? ' pp-inh' : ''}" aria-hidden="true"><small>${esc(role(inh))}</small><i class="pp-line pp-${dir}"></i></span>`;
  const effect = enz.length ? enz.map((x) => `${drugs.get(x.inh)?.name} ยับยั้ง ${x.e} → ระดับ ${drugs.get(x.sub)?.name} ในเลือดอาจสูงขึ้น`).join(' · ') : '';
  return `<div class="ddi-pic" role="img" aria-label="${esc(`${A} และ ${B} เกิด interaction ที่${site[0]} (${site[1]})`)}">`
    + `<div class="pp-row"><span class="pp-drug">${esc(A)}</span>${link(inhA, 'r')}<span class="pp-site"><b>${esc(site[0])}</b><small>${esc(site[1])}</small></span>${link(inhB, 'l')}<span class="pp-drug">${esc(B)}</span></div>`
    + (effect ? `<p class="pp-effect">${esc(effect)}</p>` : '') + '</div>';
}
