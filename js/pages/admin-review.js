// ผู้ดูแล › ตรวจประเมิน: ตรวจหลักฐานราย รพ.สต. (ผ่าน/ขอแก้/ยกเลิก), ความคืบหน้าทุกหน่วย, แก้เกณฑ์, ขึ้นปีงบใหม่
import { sb } from '../supabase.js?v=4.3';
import { $, esc, fiscalYearOf, toast, errText, busy, thaiDate } from '../util.js?v=4.3';
import { loadUnits, loadYears, resetYears, sortItems } from '../data.js?v=4.3';
import { signedUrl } from '../upload.js?v=4.3';
import { refreshAdminBadges } from './admin.js?v=4.3';

const CUR_FY = fiscalYearOf();
const ST = { none: ['ยังไม่ส่ง', 'c-off'], submitted: ['รอตรวจ', 'c-rev'], fix: ['ต้องแก้ไข', 'c-fix'], approved: ['ผ่านแล้ว', 'c-ok'] };
let units = [], years = [], year = null, unit = 0, items = [], rows = [], openId = null, filter = 'all', bound = false;

export async function initReview() {
  units = await loadUnits(); years = await loadYears();
  if (year === null || !years.includes(year)) year = years.includes(CUR_FY) ? CUR_FY : years[years.length - 1];
  if (!bound) { bound = true; bind(); }
  await load();
}

async function load() {
  $('#rvBody').innerHTML = '<div class="panel"><div class="skeleton"></div><div class="skeleton" style="width:60%;margin-top:10px"></div></div>';
  const ci = await sb.from('criteria_items').select('*').eq('fiscal_year', year);
  items = sortItems(ci.data || []);
  const ids = items.map((i) => i.id);
  const st = ids.length ? await sb.from('item_status').select('*, submitter:profiles!item_status_submitted_by_fkey(full_name)').in('item_id', ids) : { data: [] };
  rows = st.data || [];
  render();
}

const statusOf = (itemId, u) => rows.find((r) => r.item_id === itemId && r.unit_id === u);
const stOf = (itemId, u) => statusOf(itemId, u)?.status || 'none';

function render() {
  const next = Math.max(...years) + 1;
  $('#rvYears').innerHTML = years.map((y) => `<button type="button" data-y="${y}" aria-current="${y === year}">ปีงบ ${y}${y === CUR_FY ? ' (ปัจจุบัน)' : ''}</button>`).join('')
    + `<button type="button" data-newyear="${next}" title="คัดลอกเกณฑ์จากปีงบ ${next - 1}">+ เริ่มปีงบ ${next}</button>`;
  $('#rvUnits').innerHTML = units.map((u) => {
    const p = rows.filter((r) => r.unit_id === u.id && r.status === 'submitted').length;
    return `<button type="button" data-u="${u.id}" aria-current="${unit === u.id}">${esc(u.name)}${p ? ` (${p})` : ''}</button>`;
  }).join('') + `<button type="button" data-u="crit" aria-current="${unit === 'crit'}">✎ แก้ไขเกณฑ์ปีงบ ${year}</button>`;
  if (unit === 'crit') renderEditor(); else renderUnit();
  renderBars();
}

/* ---------- ตรวจหลักฐานของ รพ.สต. ---------- */
function renderUnit() {
  const u = units.find((x) => x.id === unit);
  const cnt = { all: items.length, submitted: 0, fix: 0, approved: 0, none: 0 };
  items.forEach((it) => cnt[stOf(it.id, unit)]++);
  const list = items.filter((it) => filter === 'all' || stOf(it.id, unit) === filter);
  let lastTopic = null, lastSub = null;
  const body = list.map((it) => {
    let head = '';
    if (it.topic_no !== lastTopic) { lastTopic = it.topic_no; lastSub = null; head += `<h3 class="topic-h">${esc(it.topic_title)}</h3>`; }
    if (it.sub_id !== lastSub) { lastSub = it.sub_id; head += (it.sub_label ? `<div class="crit-sub">${esc(it.sub_label)}</div>` : '') + (it.evidence ? `<p class="small muted" style="margin:0 0 6px">หลักฐานที่ต้องใช้: ${esc(it.evidence)}</p>` : ''); }
    const s = stOf(it.id, unit), [label, cls] = ST[s];
    return head + `<div class="crit-item" id="rv-${it.id}"><span class="ci-no">${esc(it.item_no)}</span><span class="ci-text">${esc(it.body)}</span><span class="chip ${cls}">${label}</span>`
      + `<button type="button" class="btn btn-o btn-sm" data-open="${it.id}">${openId === it.id ? 'ปิด' : 'ตรวจ'}</button></div>` + (openId === it.id ? reviewBox(it) : '');
  }).join('');
  $('#rvBody').innerHTML = `<div class="panel"><div class="panel-head"><h2>รพ.สต. ${esc(u?.name || '')} · ปีงบ ${year}</h2><b class="num" style="font-size:20px">${cnt.approved}/${items.length} คะแนน</b></div>`
    + '<div class="unit-tabs" id="rvFilter">' + [['all', 'ทั้งหมด'], ['submitted', 'รอตรวจ'], ['fix', 'ต้องแก้ไข'], ['approved', 'ผ่านแล้ว'], ['none', 'ยังไม่ส่ง']]
      .map(([k, l]) => `<button type="button" data-f="${k}" aria-current="${filter === k}">${l} (${cnt[k]})</button>`).join('') + '</div>'
    + `<div class="crit review-list">${body || '<p class="empty">ไม่มีข้อในกลุ่มนี้</p>'}</div></div>`;
}

function reviewBox(it) {
  const r = statusOf(it.id, unit), s = r?.status || 'none';
  const files = (r?.evidence_paths || []).map((p, i) => `<button type="button" class="btn btn-o btn-sm" data-file="${esc(p)}">เปิดไฟล์ ${i + 1} (${esc(p.split('.').pop().toUpperCase())})</button>`).join('');
  return '<div class="crit-editbox">'
    + (r?.submitted_at ? `<p class="small muted">ส่งโดย ${esc(r.submitter?.full_name || '-')} · ${esc(thaiDate(r.submitted_at))}</p>` : '<p class="small muted">รพ.สต. ยังไม่ได้ส่งหลักฐานข้อนี้ (ให้ผ่านได้ หากตรวจพบหลักฐานจริงที่หน่วยบริการ)</p>')
    + (r?.detail ? `<p class="small"><b>รายละเอียด:</b> ${esc(r.detail)}</p>` : '')
    + (files ? `<div class="row-btns">${files}</div>` : '')
    + `<label class="small" style="font-weight:600" for="rvComment">ความเห็นถึง รพ.สต. (จำเป็นเมื่อขอแก้ไข)</label><textarea id="rvComment" rows="2" maxlength="1000">${esc(r?.review_comment || '')}</textarea>`
    + '<div class="review-actions">'
    + (s !== 'approved' ? `<button type="button" class="btn btn-ok btn-sm" data-set="approved" data-item="${it.id}">ผ่าน (1 คะแนน)</button>` : '')
    + (s !== 'fix' ? `<button type="button" class="btn btn-warn btn-sm" data-set="fix" data-item="${it.id}">ขอแก้ไข</button>` : '')
    + (s === 'approved' || s === 'fix' ? `<button type="button" class="btn btn-o btn-sm" data-set="${r?.detail || r?.evidence_paths?.length ? 'submitted' : 'none'}" data-item="${it.id}">ยกเลิกผลตรวจ</button>` : '')
    + '<span class="small" id="rvMsg" aria-live="polite"></span></div></div>';
}

async function setStatus(itemId, status, btn) {
  const comment = $('#rvComment')?.value.trim() || null;
  if (status === 'fix' && !comment) { $('#rvMsg').style.color = 'var(--error)'; $('#rvMsg').textContent = 'กรุณาใส่ความเห็นว่าต้องแก้อะไร'; $('#rvComment').focus(); return; }
  busy(btn, true, 'กำลังบันทึก…');
  const r = statusOf(itemId, unit);
  const res = r
    ? await sb.from('item_status').update({ status, review_comment: comment }).eq('id', r.id).select()
    : await sb.from('item_status').insert({ item_id: itemId, unit_id: unit, status, review_comment: comment }).select();
  busy(btn, false);
  if (res.error) { toast(errText(res.error), 'err'); return; }
  toast({ approved: 'ให้ผ่านแล้ว', fix: 'ส่งกลับให้แก้ไขแล้ว', submitted: 'ยกเลิกผลตรวจแล้ว', none: 'ยกเลิกผลตรวจแล้ว' }[status]);
  const nextPending = items.find((it) => it.id !== itemId && stOf(it.id, unit) === 'submitted');
  openId = status === 'approved' || status === 'fix' ? (nextPending?.id ?? null) : itemId;
  await load(); refreshAdminBadges();
  if (openId) $('#rv-' + openId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ---------- ความคืบหน้าทุกหน่วย ---------- */
function renderBars() {
  $('#rvBarsYear').textContent = `ปีงบ ${year}`;
  const total = items.length || 1;
  $('#rvBars').innerHTML = units.map((u) => ({ u, got: rows.filter((r) => r.unit_id === u.id && r.status === 'approved').length, pend: rows.filter((r) => r.unit_id === u.id && r.status === 'submitted').length }))
    .sort((a, b) => b.got - a.got).map(({ u, got, pend }) => {
      const pct = Math.round(got / total * 100);
      return `<div class="bar-row"><div><span>${esc(u.name)}${pend ? ` <span class="small muted">· รอตรวจ ${pend}</span>` : ''}</span><b class="num">${got}/${items.length} (${pct}%)</b></div><div class="meter"><span style="width:${pct}%"></span></div></div>`;
    }).join('');
}

/* ---------- แก้ไขเกณฑ์ ---------- */
function renderEditor() {
  const editable = year >= CUR_FY;
  const subs = [];
  items.forEach((it) => { const k = it.topic_no + '|' + it.sub_id; let s = subs.find((x) => x.k === k); if (!s) { s = { k, topic_no: it.topic_no, topic_title: it.topic_title, sub_id: it.sub_id, sub_label: it.sub_label, evidence: it.evidence, items: [] }; subs.push(s); } s.items.push(it); });
  let lastTopic = null;
  $('#rvBody').innerHTML = `<div class="panel"><div class="panel-head"><h2>เกณฑ์มาตรฐาน ปีงบ ${year} (${items.length} ข้อ)</h2></div>`
    + `<p class="small muted">${editable ? 'แก้ข้อความได้โดยตรงแล้วกด "บันทึกการแก้ไข" · การแก้มีผลเฉพาะปีงบนี้ ปีก่อนหน้าไม่เปลี่ยน · ลบข้อที่มีผลตรวจแล้ว คะแนนของข้อนั้นจะหายไปด้วย' : `ปีงบ ${year} ผ่านไปแล้ว — ดูได้อย่างเดียว (เก็บไว้เป็นประวัติ)`}</p>`
    + '<div class="crit-editor">' + subs.map((s) => {
      let h = '';
      if (s.topic_no !== lastTopic) { lastTopic = s.topic_no; h += `<h3 class="topic-h">${esc(s.topic_title)}</h3>`; }
      return h + `<div class="sub-edit" data-sub="${esc(s.sub_id)}">`
        + (editable ? `<input class="input sub-label" value="${esc(s.sub_label || '')}" placeholder="ชื่อหัวข้อย่อย" aria-label="ชื่อหัวข้อย่อย ${esc(s.sub_id)}">`
          + `<textarea class="sub-ev" rows="2" placeholder="หลักฐาน/เอกสารที่ต้องใช้" aria-label="หลักฐานหัวข้อย่อย ${esc(s.sub_id)}">${esc(s.evidence || '')}</textarea>`
          : `<div class="crit-sub">${esc(s.sub_label || '')}</div><p class="small muted">หลักฐาน: ${esc(s.evidence || '-')}</p>`)
        + s.items.map((it) => `<div class="crit-item"><span class="ci-no">${esc(it.item_no)}</span>`
          + (editable ? `<input class="input item-body" data-id="${it.id}" value="${esc(it.body)}" aria-label="ข้อ ${esc(it.item_no)}"><button type="button" class="btn btn-no btn-sm" data-delitem="${it.id}" aria-label="ลบข้อ ${esc(it.item_no)}">ลบ</button>` : `<span class="ci-text">${esc(it.body)}</span>`)
          + '</div>').join('')
        + (editable ? `<div class="crit-item"><span class="ci-no">+</span><input class="input new-item" placeholder="เพิ่มข้อใหม่ในหัวข้อย่อยนี้" aria-label="ข้อใหม่"><button type="button" class="btn btn-o btn-sm" data-additem="${esc(s.k)}">เพิ่ม</button></div>` : '')
        + '</div>';
    }).join('') + '</div>'
    + (editable ? '<div class="row-btns" style="align-items:center"><button type="button" class="btn btn-p btn-sm" id="critSave">บันทึกการแก้ไข</button><span class="small" id="critMsg" aria-live="polite"></span></div>' : '')
    + '</div>';
}

async function saveEditor(btn) {
  const itemUpd = [...document.querySelectorAll('.item-body')].map((i) => ({ id: +i.dataset.id, body: i.value.trim() }))
    .filter((x) => x.body && items.find((it) => it.id === x.id)?.body !== x.body);
  const subUpd = [...document.querySelectorAll('.sub-edit')].map((d) => {
    const first = items.find((it) => it.sub_id === d.dataset.sub);
    return { sub_id: d.dataset.sub, sub_label: d.querySelector('.sub-label').value.trim() || null, evidence: d.querySelector('.sub-ev').value.trim() || null, first };
  }).filter((s) => s.sub_label !== (s.first.sub_label || null) || s.evidence !== (s.first.evidence || null));
  if (!itemUpd.length && !subUpd.length) { $('#critMsg').textContent = 'ไม่มีการเปลี่ยนแปลง'; return; }
  busy(btn, true, 'กำลังบันทึก…');
  try {
    for (const x of itemUpd) { const { error } = await sb.from('criteria_items').update({ body: x.body }).eq('id', x.id); if (error) throw error; }
    for (const s of subUpd) { const { error } = await sb.from('criteria_items').update({ sub_label: s.sub_label, evidence: s.evidence }).eq('fiscal_year', year).eq('sub_id', s.sub_id); if (error) throw error; }
    toast(`บันทึกแล้ว (${itemUpd.length} ข้อ, ${subUpd.length} หัวข้อย่อย)`); await load();
  } catch (err) { toast(errText(err), 'err'); busy(btn, false); }
}

async function addItem(k, input) {
  const text = input.value.trim(); if (!text) { input.focus(); return; }
  const [topicNo, subId] = k.split('|');
  const sub = items.filter((it) => String(it.topic_no) === topicNo && it.sub_id === subId);
  const last = sub[sub.length - 1];
  const nextNo = Math.max(...sub.map((it) => +it.item_no.split('.').pop())) + 1;
  const { error } = await sb.from('criteria_items').insert({ fiscal_year: year, topic_no: last.topic_no, topic_title: last.topic_title, sub_id: subId, sub_label: last.sub_label, evidence: last.evidence, item_no: `${subId}.${nextNo}`, body: text, sort: last.sort });
  if (error) { toast(errText(error), 'err'); return; }
  toast(`เพิ่มข้อ ${subId}.${nextNo} แล้ว`); load();
}

async function delItem(id) {
  const it = items.find((x) => x.id === id);
  const n = rows.filter((r) => r.item_id === id && r.status !== 'none').length;
  if (!confirm(`ลบข้อ ${it.item_no} "${it.body}" ออกจากเกณฑ์ปีงบ ${year}?${n ? `\n⚠️ มีผลส่ง/ผลตรวจของ ${n} รพ.สต. จะถูกลบด้วย` : ''}`)) return;
  const { error } = await sb.from('criteria_items').delete().eq('id', id);
  if (error) { toast(errText(error), 'err'); return; }
  toast('ลบข้อแล้ว'); load();
}

async function newYear(y) {
  if (!confirm(`เริ่มปีงบประมาณ ${y}?\nระบบจะคัดลอกเกณฑ์จากปีงบ ${y - 1} (${items.length ? 'ปีล่าสุด' : ''}) มาเป็นชุดของปี ${y} — แก้ไขภายหลังได้โดยไม่กระทบปีเก่า`)) return;
  const { data, error } = await sb.rpc('start_fiscal_year', { p_year: y });
  if (error) { toast(errText(error), 'err'); return; }
  toast(`สร้างเกณฑ์ปีงบ ${y} แล้ว (${data} ข้อ)`);
  resetYears(); years = await loadYears(); year = y; unit = 'crit'; load();
}

function bind() {
  $('#rvYears').addEventListener('click', (e) => {
    const n = e.target.closest('[data-newyear]'); if (n) { newYear(+n.dataset.newyear); return; }
    const b = e.target.closest('[data-y]'); if (b) { year = +b.dataset.y; openId = null; load(); }
  });
  $('#rvUnits').addEventListener('click', (e) => { const b = e.target.closest('[data-u]'); if (!b) return; unit = b.dataset.u === 'crit' ? 'crit' : +b.dataset.u; openId = null; filter = 'all'; render(); });
  $('#rvBody').addEventListener('click', async (e) => {
    const f = e.target.closest('[data-f]'); if (f) { filter = f.dataset.f; render(); return; }
    const o = e.target.closest('[data-open]'); if (o) { const id = +o.dataset.open; openId = openId === id ? null : id; render(); return; }
    const s = e.target.closest('[data-set]'); if (s) { setStatus(+s.dataset.item, s.dataset.set, s); return; }
    const fl = e.target.closest('[data-file]'); if (fl) { try { window.open(await signedUrl('evidence', fl.dataset.file), '_blank', 'noopener'); } catch (err) { toast(errText(err), 'err'); } return; }
    if (e.target.closest('#critSave')) { saveEditor(e.target.closest('#critSave')); return; }
    const a = e.target.closest('[data-additem]'); if (a) { addItem(a.dataset.additem, a.parentElement.querySelector('.new-item')); return; }
    const d = e.target.closest('[data-delitem]'); if (d) delItem(+d.dataset.delitem);
  });
}
