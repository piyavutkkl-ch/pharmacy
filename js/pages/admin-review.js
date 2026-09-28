// ผู้ดูแล › ตรวจประเมิน: ตรวจหลักฐานราย รพ.สต. (ผ่าน/ขอแก้/ยกเลิก), ความคืบหน้าทุกหน่วย, แก้เกณฑ์, ขึ้นปีงบใหม่
import { sb } from '../supabase.js?v=4.4';
import { $, esc, fiscalYearOf, toast, errText, busy, thaiDate } from '../util.js?v=4.4';
import { loadUnits, loadYears, resetYears, sortItems, isHiddenYear } from '../data.js?v=4.4';
import { fileCard, hydrateSigned, openPrivateFile, uploadSample, uploadEvidence, previewFiles, removeFiles } from '../upload.js?v=4.4';
import { refreshAdminBadges } from './admin.js?v=4.4';

const CUR_FY = fiscalYearOf();
const ST = { none: ['ยังไม่ส่ง', 'c-off'], submitted: ['รอตรวจ', 'c-rev'], fix: ['ต้องแก้ไข', 'c-fix'], approved: ['ผ่านแล้ว', 'c-ok'] };
let units = [], years = [], year = null, unit = 0, items = [], rows = [], openId = null, filter = 'all', bound = false;

export async function initReview() {
  units = await loadUnits(); years = await loadYears({ includeHidden: true });
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
  $('#rvYears').innerHTML = years.map((y) => `<button type="button" data-y="${y}" aria-current="${y === year}">ปีงบ ${y}${y === CUR_FY ? ' (ปัจจุบัน)' : ''}${isHiddenYear(y) ? ' · ซ่อนอยู่' : ''}</button>`).join('')
    + `<button type="button" data-newyear="${next}" title="คัดลอกเกณฑ์จากปีงบ ${next - 1}">+ เริ่มปีงบ ${next}</button>`;
  $('#rvUnits').innerHTML = units.map((u) => {
    const p = rows.filter((r) => r.unit_id === u.id && r.status === 'submitted').length;
    return `<button type="button" data-u="${u.id}" aria-current="${unit === u.id}">${esc(u.name)}${p ? ` (${p})` : ''}</button>`;
  }).join('') + `<button type="button" data-u="crit" aria-current="${unit === 'crit'}">✎ แก้ไขเกณฑ์ปีงบ ${year}</button>`;
  const hid = isHiddenYear(year), exists = items.length > 0;
  $('#rvYearActs').innerHTML = exists
    ? `<span class="small muted">ปีงบ ${year}${hid ? ' ซ่อนอยู่ — เจ้าหน้าที่และหน้าหลักไม่เห็นปีนี้' : ''}</span>`
      + `<button type="button" class="btn btn-o btn-sm" data-hideyear="${hid ? 0 : 1}">${hid ? 'เลิกซ่อนปีงบนี้' : 'ซ่อนปีงบนี้'}</button>`
      + (year >= CUR_FY ? `<button type="button" class="btn btn-no btn-sm" data-delyear="${year}">ลบปีงบนี้</button>` : '')
    : '';
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
      + (s === 'approved' || s === 'fix' ? undoBtn(it, 'ย้อนกลับ') : '')
      + `<button type="button" class="btn btn-o btn-sm" data-open="${it.id}">${openId === it.id ? 'ปิด' : 'ตรวจ'}</button></div>` + (openId === it.id ? reviewBox(it) : '');
  }).join('');
  $('#rvBody').innerHTML = `<div class="panel"><div class="panel-head"><h2>รพ.สต. ${esc(u?.name || '')} · ปีงบ ${year}</h2><b class="num" style="font-size:20px">${cnt.approved}/${items.length} คะแนน</b></div>`
    + '<div class="unit-tabs" id="rvFilter">' + [['all', 'ทั้งหมด'], ['submitted', 'รอตรวจ'], ['fix', 'ต้องแก้ไข'], ['approved', 'ผ่านแล้ว'], ['none', 'ยังไม่ส่ง']]
      .map(([k, l]) => `<button type="button" data-f="${k}" aria-current="${filter === k}">${l} (${cnt[k]})</button>`).join('') + '</div>'
    + `<div class="crit review-list">${body || '<p class="empty">ไม่มีข้อในกลุ่มนี้</p>'}</div></div>`;
  hydrateSigned($('#rvBody'));
}

/** ย้อนกลับผลตรวจ (ผ่าน/ขอแก้ไข) → กลับเป็น "รอตรวจ" (ถ้า รพ.สต. ส่งหลักฐานไว้) หรือ "ยังไม่ส่ง" */
function undoBtn(it, text) {
  const r = statusOf(it.id, unit);
  return `<button type="button" class="btn btn-o btn-sm" data-set="${r?.detail || r?.evidence_paths?.length ? 'submitted' : 'none'}" data-item="${it.id}" data-undo="1">${text}</button>`;
}

function reviewBox(it) {
  const r = statusOf(it.id, unit), s = r?.status || 'none';
  const files = (r?.evidence_paths || []).map((p, i) => fileCard('evidence', p, `ไฟล์ ${i + 1}`)).join('');
  return '<div class="crit-editbox">'
    + (r?.submitted_at ? `<p class="small muted">ส่งโดย ${esc(r.submitter?.full_name || '-')} · ${esc(thaiDate(r.submitted_at))}</p>` : '<p class="small muted">รพ.สต. ยังไม่ได้ส่งหลักฐานข้อนี้ (ให้ผ่านได้ หากตรวจพบหลักฐานจริงที่หน่วยบริการ)</p>')
    + (r?.detail ? `<p class="small"><b>รายละเอียด:</b> ${esc(r.detail)}</p>` : '')
    + (files ? `<div class="fthumbs">${files}</div>` : '')
    + `<label class="small" style="font-weight:600" for="rvComment">ความเห็นถึง รพ.สต. (จำเป็นเมื่อขอแก้ไข)</label><textarea id="rvComment" rows="2" maxlength="1000">${esc(r?.review_comment || '')}</textarea>`
    + (r?.review_files?.length ? `<p class="small" style="font-weight:600">ไฟล์ที่แนบกลับไปแล้ว</p><div class="fthumbs">${r.review_files.map((p, i) => `<div class="fitem">${fileCard('evidence', p, `ไฟล์ผู้ดูแล ${i + 1}`)}<button type="button" class="btn btn-no btn-sm" data-rmreview="${esc(p)}" data-item="${it.id}">ลบ</button></div>`).join('')}</div>` : '')
    + '<label class="small" style="font-weight:600" for="rvFiles">แนบไฟล์กลับไปให้ รพ.สต. (ถ้ามี · PDF/รูป)</label><input id="rvFiles" class="input" type="file" accept="application/pdf,image/*" multiple><div class="fthumbs" id="rvPreview" hidden></div>'
    + '<div class="review-actions">'
    + (s !== 'approved' ? `<button type="button" class="btn btn-ok btn-sm" data-set="approved" data-item="${it.id}">ผ่าน (1 คะแนน)</button>` : '')
    + (s !== 'fix' ? `<button type="button" class="btn btn-warn btn-sm" data-set="fix" data-item="${it.id}">ขอแก้ไข</button>` : '')
    + (s === 'approved' ? undoBtn(it, 'ย้อนกลับ (ยกเลิกการให้ผ่าน)') : s === 'fix' ? undoBtn(it, 'ย้อนกลับ (ยกเลิกการขอแก้ไข)') : '')
    + '<span class="small" id="rvMsg" aria-live="polite"></span></div></div>';
}

async function setStatus(itemId, status, btn) {
  const r = statusOf(itemId, unit), undo = !!btn.dataset.undo;
  const comment = undo ? (r?.review_comment ?? null) : ($('#rvComment')?.value.trim() || null);
  if (status === 'fix' && !comment) { $('#rvMsg').style.color = 'var(--error)'; $('#rvMsg').textContent = 'กรุณาใส่ความเห็นว่าต้องแก้อะไร'; $('#rvComment').focus(); return; }
  const files = undo ? [] : [...($('#rvFiles')?.files || [])];
  busy(btn, true, files.length ? 'กำลังอัปโหลด…' : 'กำลังบันทึก…');
  const uploaded = [];
  let res;
  try {
    const it = items.find((x) => x.id === itemId);
    for (const f of files) uploaded.push(await uploadEvidence(f, `${year}/${unit}/${it.item_no}/admin`));
    const row = { status, review_comment: comment, ...(uploaded.length ? { review_files: [...(r?.review_files || []), ...uploaded] } : {}) };
    res = r
      ? await sb.from('item_status').update(row).eq('id', r.id).select()
      : await sb.from('item_status').insert({ item_id: itemId, unit_id: unit, ...row }).select();
    if (res.error) throw res.error;
  } catch (err) { if (uploaded.length) removeFiles('evidence', uploaded); busy(btn, false); toast(errText(err), 'err'); return; }
  busy(btn, false);
  toast(undo ? 'ย้อนกลับผลตรวจแล้ว' : { approved: 'ให้ผ่านแล้ว', fix: 'ส่งกลับให้แก้ไขแล้ว' }[status] + (uploaded.length ? ` (แนบ ${uploaded.length} ไฟล์)` : ''));
  const nextPending = items.find((it) => it.id !== itemId && stOf(it.id, unit) === 'submitted');
  openId = status === 'approved' || status === 'fix' ? (nextPending?.id ?? null) : itemId;
  await load(); refreshAdminBadges();
  if (openId) $('#rv-' + openId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function removeReviewFile(itemId, path) {
  const r = statusOf(itemId, unit); if (!r || !confirm('ลบไฟล์ที่แนบกลับไปนี้?')) return;
  const { error } = await sb.from('item_status').update({ review_files: r.review_files.filter((p) => p !== path) }).eq('id', r.id);
  if (error) { toast(errText(error), 'err'); return; }
  removeFiles('evidence', [path]); openId = itemId; toast('ลบไฟล์แล้ว'); await load();
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
  items.forEach((it) => { const k = it.topic_no + '|' + it.sub_id; let s = subs.find((x) => x.k === k); if (!s) { s = { k, topic_no: it.topic_no, topic_title: it.topic_title, sub_id: it.sub_id, sub_label: it.sub_label, evidence: it.evidence, samples: it.evidence_samples || [], items: [] }; subs.push(s); } s.items.push(it); });
  let lastTopic = null;
  $('#rvBody').innerHTML = `<div class="panel"><div class="panel-head"><h2>เกณฑ์มาตรฐาน ปีงบ ${year} (${items.length} ข้อ)</h2></div>`
    + `<p class="small muted">${editable ? 'แก้ข้อความได้โดยตรงแล้วกด "บันทึกการแก้ไข" · การแก้มีผลเฉพาะปีงบนี้ ปีก่อนหน้าไม่เปลี่ยน · ลบข้อที่มีผลตรวจแล้ว คะแนนของข้อนั้นจะหายไปด้วย' : `ปีงบ ${year} ผ่านไปแล้ว — ดูได้อย่างเดียว (เก็บไว้เป็นประวัติ)`}</p>`
    + '<div class="crit-editor">' + subs.map((s) => {
      let h = '';
      if (s.topic_no !== lastTopic) {
        if (lastTopic !== null && editable) h += addSubRow(lastTopic);
        lastTopic = s.topic_no;
        h += editable
          ? `<div class="topic-edit"><input class="input topic-title" data-topic="${s.topic_no}" value="${esc(s.topic_title)}" aria-label="ชื่อข้อใหญ่ ${s.topic_no}"><button type="button" class="btn btn-no btn-sm" data-deltopic="${s.topic_no}">ลบข้อใหญ่</button></div>`
          : `<h3 class="topic-h">${esc(s.topic_title)}</h3>`;
      }
      return h + `<div class="sub-edit" data-sub="${esc(s.sub_id)}">`
        + (editable ? `<div class="sub-head"><input class="input sub-label" value="${esc(s.sub_label || '')}" placeholder="ชื่อหัวข้อย่อย" aria-label="ชื่อหัวข้อย่อย ${esc(s.sub_id)}"><button type="button" class="btn btn-no btn-sm" data-delsub="${esc(s.k)}">ลบหัวข้อย่อย</button></div>`
          + `<textarea class="sub-ev" rows="2" placeholder="หลักฐาน/เอกสารที่ต้องใช้" aria-label="หลักฐานหัวข้อย่อย ${esc(s.sub_id)}">${esc(s.evidence || '')}</textarea>`
          + samplesEditor(s)
          : `<div class="crit-sub">${esc(s.sub_label || '')}</div><p class="small muted">หลักฐาน: ${esc(s.evidence || '-')}</p>`
            + (s.samples.length ? `<div class="fthumbs samples">${s.samples.map((f) => fileCard('criteria-samples', f.path, f.name)).join('')}</div>` : ''))
        + s.items.map((it) => `<div class="crit-item"><span class="ci-no">${esc(it.item_no)}</span>`
          + (editable ? `<input class="input item-body" data-id="${it.id}" value="${esc(it.body)}" aria-label="ข้อ ${esc(it.item_no)}"><button type="button" class="btn btn-no btn-sm" data-delitem="${it.id}" aria-label="ลบข้อ ${esc(it.item_no)}">ลบ</button>` : `<span class="ci-text">${esc(it.body)}</span>`)
          + '</div>').join('')
        + (editable ? `<div class="crit-item"><span class="ci-no">+</span><input class="input new-item" placeholder="เพิ่มข้อใหม่ในหัวข้อย่อยนี้" aria-label="ข้อใหม่"><button type="button" class="btn btn-o btn-sm" data-additem="${esc(s.k)}">เพิ่ม</button></div>` : '')
        + '</div>';
    }).join('') + (editable && lastTopic !== null ? addSubRow(lastTopic) : '') + '</div>'
    + (editable ? '<div class="add-topic"><h3>+ เพิ่มข้อใหญ่</h3><div class="form-grid">'
      + '<div class="field full"><label for="ntTitle">ชื่อข้อใหญ่ <span class="req">*</span></label><input id="ntTitle" class="input" maxlength="300" placeholder="เช่น การให้ความรู้เรื่องยาแก่ชุมชน"></div>'
      + '<div class="field"><label for="ntSub">หัวข้อย่อยแรก</label><input id="ntSub" class="input" maxlength="300"></div>'
      + '<div class="field"><label for="ntItem">ข้อแรก <span class="req">*</span></label><input id="ntItem" class="input" maxlength="1000"></div>'
      + '<div class="full"><button type="button" class="btn btn-o btn-sm" data-addtopic="1">เพิ่มข้อใหญ่</button></div></div></div>' : '')
    + (editable ? '<div class="row-btns" style="align-items:center"><button type="button" class="btn btn-p btn-sm" id="critSave">บันทึกการแก้ไข</button><span class="small" id="critMsg" aria-live="polite"></span></div>' : '')
    + '</div>';
  hydrateSigned($('#rvBody'));
}

async function saveEditor(btn) {
  const topicUpd = [...document.querySelectorAll('.topic-title')].map((i) => ({ no: +i.dataset.topic, title: i.value.trim() }))
    .filter((t) => t.title && items.find((it) => it.topic_no === t.no)?.topic_title !== t.title);
  const itemUpd = [...document.querySelectorAll('.item-body')].map((i) => ({ id: +i.dataset.id, body: i.value.trim() }))
    .filter((x) => x.body && items.find((it) => it.id === x.id)?.body !== x.body);
  const subUpd = [...document.querySelectorAll('.sub-edit')].map((d) => {
    const first = items.find((it) => it.sub_id === d.dataset.sub);
    return { sub_id: d.dataset.sub, sub_label: d.querySelector('.sub-label').value.trim() || null, evidence: d.querySelector('.sub-ev').value.trim() || null, first };
  }).filter((s) => s.sub_label !== (s.first.sub_label || null) || s.evidence !== (s.first.evidence || null));
  if (!itemUpd.length && !subUpd.length && !topicUpd.length) { $('#critMsg').textContent = 'ไม่มีการเปลี่ยนแปลง'; return; }
  busy(btn, true, 'กำลังบันทึก…');
  try {
    for (const x of itemUpd) { const { error } = await sb.from('criteria_items').update({ body: x.body }).eq('id', x.id); if (error) throw error; }
    for (const t of topicUpd) { const { error } = await sb.from('criteria_items').update({ topic_title: t.title }).eq('fiscal_year', year).eq('topic_no', t.no); if (error) throw error; }
    for (const s of subUpd) { const { error } = await sb.from('criteria_items').update({ sub_label: s.sub_label, evidence: s.evidence }).eq('fiscal_year', year).eq('sub_id', s.sub_id); if (error) throw error; }
    toast(`บันทึกแล้ว (${topicUpd.length} ข้อใหญ่, ${subUpd.length} หัวข้อย่อย, ${itemUpd.length} ข้อ)`); await load();
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

/* ---------- ไฟล์ตัวอย่างหลักฐาน (ต่อหัวข้อย่อย) ---------- */
function samplesEditor(s) {
  return `<div class="samples-edit"><span class="small muted">ไฟล์ตัวอย่างหลักฐาน ให้ รพ.สต. เปิดดู/ดาวน์โหลด (PDF หรือรูป · สูงสุด 10 ไฟล์)</span>`
    + (s.samples.length ? `<div class="fthumbs samples">${s.samples.map((f) => `<div class="fitem">${fileCard('criteria-samples', f.path, f.name)}<button type="button" class="btn btn-no btn-sm" data-rmsample="${esc(f.path)}" data-k="${esc(s.k)}">ลบ</button></div>`).join('')}</div>` : '')
    + (s.samples.length < 10 ? `<label class="btn btn-o btn-sm file-btn">+ เพิ่มไฟล์ตัวอย่าง<input type="file" class="sr-only" accept="application/pdf,image/*" data-addsample="${esc(s.k)}"></label>` : '')
    + '</div>';
}
const subItems = (k) => { const [t, sid] = k.split('|'); return items.filter((it) => String(it.topic_no) === t && it.sub_id === sid); };
async function saveSamples(k, list) {
  const [t, sid] = k.split('|');
  const { error } = await sb.from('criteria_items').update({ evidence_samples: list }).eq('fiscal_year', year).eq('topic_no', +t).eq('sub_id', sid);
  if (error) throw error;
}
async function addSample(k, input) {
  const f = input.files[0]; if (!f) return;
  const label = input.closest('.file-btn'); label.classList.add('is-busy');
  try {
    const cur = subItems(k)[0]?.evidence_samples || [];
    const up = await uploadSample(f, `${year}/${k.split('|')[1]}`);
    await saveSamples(k, [...cur, up]);
    toast(`เพิ่มไฟล์ตัวอย่าง "${up.name}" แล้ว`); await load();
  } catch (err) { toast(errText(err), 'err'); label.classList.remove('is-busy'); input.value = ''; }
}
async function removeSample(k, path) {
  const cur = subItems(k)[0]?.evidence_samples || [], f = cur.find((x) => x.path === path);
  if (!f || !confirm(`ลบไฟล์ตัวอย่าง "${f.name}"?`)) return;
  // ไม่ลบไฟล์จริง — ปีงบถัดไปอาจคัดลอกไปใช้อยู่
  try { await saveSamples(k, cur.filter((x) => x.path !== path)); toast('ลบไฟล์ตัวอย่างแล้ว'); await load(); }
  catch (err) { toast(errText(err), 'err'); }
}

/* ---------- ข้อใหญ่ / หัวข้อย่อย ---------- */
function addSubRow(topicNo) {
  return `<div class="add-sub"><span class="small muted">+ หัวข้อย่อยใหม่ในข้อใหญ่ ${topicNo}</span><div class="add-sub-row">`
    + `<input class="input new-sub" maxlength="300" placeholder="ชื่อหัวข้อย่อย" aria-label="ชื่อหัวข้อย่อยใหม่ ข้อใหญ่ ${topicNo}">`
    + `<input class="input new-sub-item" maxlength="1000" placeholder="ข้อแรก (จำเป็น)" aria-label="ข้อแรกของหัวข้อย่อยใหม่ ข้อใหญ่ ${topicNo}">`
    + `<button type="button" class="btn btn-o btn-sm" data-addsub="${topicNo}">เพิ่มหัวข้อย่อย</button></div></div>`;
}
const nextSort = () => Math.max(0, ...items.map((it) => it.sort)) + 1;
const statusCount = (ids) => rows.filter((r) => ids.includes(r.item_id) && r.status !== 'none').length;

async function addSub(topicNo, box) {
  const label = box.querySelector('.new-sub').value.trim(), body = box.querySelector('.new-sub-item').value.trim();
  if (!body) { box.querySelector('.new-sub-item').focus(); toast('กรุณากรอกข้อแรกของหัวข้อย่อย', 'err'); return; }
  const tItems = items.filter((it) => it.topic_no === topicNo);
  const n = Math.max(0, ...tItems.map((it) => (new RegExp(`^${topicNo}\\.(\\d+)$`).exec(it.sub_id) || [0, 0])[1] * 1)) + 1;
  const subId = `${topicNo}.${n}`;
  const { error } = await sb.from('criteria_items').insert({ fiscal_year: year, topic_no: topicNo, topic_title: tItems[0].topic_title, sub_id: subId, sub_label: label || null, item_no: `${subId}.1`, body, sort: nextSort() });
  if (error) { toast(errText(error), 'err'); return; }
  toast(`เพิ่มหัวข้อย่อย ${subId} แล้ว`); load();
}

async function addTopic() {
  let title = $('#ntTitle').value.trim(); const sub = $('#ntSub').value.trim(), body = $('#ntItem').value.trim();
  if (!title) { $('#ntTitle').focus(); toast('กรุณากรอกชื่อข้อใหญ่', 'err'); return; }
  if (!body) { $('#ntItem').focus(); toast('กรุณากรอกข้อแรก', 'err'); return; }
  const no = Math.max(0, ...items.map((it) => it.topic_no)) + 1;
  if (!/^\d/.test(title)) title = `${no}. ${title}`;
  const { error } = await sb.from('criteria_items').insert({ fiscal_year: year, topic_no: no, topic_title: title, sub_id: `${no}.1`, sub_label: sub || null, item_no: `${no}.1.1`, body, sort: nextSort() });
  if (error) { toast(errText(error), 'err'); return; }
  toast(`เพิ่มข้อใหญ่ ${no} แล้ว`); load();
}

async function delGroup(list, what) {
  const n = statusCount(list.map((it) => it.id));
  if (!confirm(`ลบ${what} (${list.length} ข้อ) ออกจากเกณฑ์ปีงบ ${year}?${n ? `\n⚠️ มีผลส่ง/ผลตรวจของ รพ.สต. ${n} รายการ จะถูกลบด้วย` : ''}`)) return;
  const { error } = await sb.from('criteria_items').delete().in('id', list.map((it) => it.id));
  if (error) { toast(errText(error), 'err'); return; }
  toast(`ลบ${what}แล้ว`); load();
}

async function delItem(id) {
  const it = items.find((x) => x.id === id);
  const n = rows.filter((r) => r.item_id === id && r.status !== 'none').length;
  if (!confirm(`ลบข้อ ${it.item_no} "${it.body}" ออกจากเกณฑ์ปีงบ ${year}?${n ? `\n⚠️ มีผลส่ง/ผลตรวจของ ${n} รพ.สต. จะถูกลบด้วย` : ''}`)) return;
  const { error } = await sb.from('criteria_items').delete().eq('id', id);
  if (error) { toast(errText(error), 'err'); return; }
  toast('ลบข้อแล้ว'); load();
}

async function hideYear(hide) {
  const { error } = await sb.from('criteria_years').update({ hidden: hide }).eq('fiscal_year', year);
  if (error) { toast(errText(error), 'err'); return; }
  toast(hide ? `ซ่อนปีงบ ${year} แล้ว` : `เลิกซ่อนปีงบ ${year} แล้ว`);
  resetYears(); years = await loadYears({ includeHidden: true }); render();
}

async function deleteYear(y) {
  if (!confirm(`ลบปีงบ ${y} และเกณฑ์ทั้งหมด ${items.length} ข้อของปีนี้?\nลบได้เฉพาะปีที่ยังไม่มีการส่งหลักฐาน — ถ้ามีแล้วให้ใช้ "ซ่อน" แทน`)) return;
  const { error } = await sb.from('criteria_years').delete().eq('fiscal_year', y);
  if (error) { toast(errText(error), 'err'); return; }
  toast(`ลบปีงบ ${y} แล้ว`);
  resetYears(); years = await loadYears({ includeHidden: true }); year = years.includes(CUR_FY) ? CUR_FY : years[years.length - 1]; unit = 0; load();
}

async function newYear(y) {
  if (!confirm(`เริ่มปีงบประมาณ ${y}?\nระบบจะคัดลอกเกณฑ์จากปีงบ ${y - 1} (${items.length ? 'ปีล่าสุด' : ''}) มาเป็นชุดของปี ${y} — แก้ไขภายหลังได้โดยไม่กระทบปีเก่า`)) return;
  const { data, error } = await sb.rpc('start_fiscal_year', { p_year: y });
  if (error) { toast(errText(error), 'err'); return; }
  toast(`สร้างเกณฑ์ปีงบ ${y} แล้ว (${data} ข้อ)`);
  resetYears(); years = await loadYears({ includeHidden: true }); year = y; unit = 'crit'; load();
}

function bind() {
  $('#rvYears').addEventListener('click', (e) => {
    const n = e.target.closest('[data-newyear]'); if (n) { newYear(+n.dataset.newyear); return; }
    const b = e.target.closest('[data-y]'); if (b) { year = +b.dataset.y; openId = null; load(); }
  });
  $('#rvYearActs').addEventListener('click', (e) => {
    const h = e.target.closest('[data-hideyear]'); if (h) { hideYear(h.dataset.hideyear === '1'); return; }
    const d = e.target.closest('[data-delyear]'); if (d) deleteYear(+d.dataset.delyear);
  });
  $('#rvUnits').addEventListener('click', (e) => { const b = e.target.closest('[data-u]'); if (!b) return; unit = b.dataset.u === 'crit' ? 'crit' : +b.dataset.u; openId = null; filter = 'all'; render(); });
  $('#rvBody').addEventListener('change', (e) => {
    const i = e.target.closest('[data-addsample]'); if (i) { addSample(i.dataset.addsample, i); return; }
    if (e.target.id === 'rvFiles') previewFiles(e.target.files, $('#rvPreview'));
  });
  $('#rvBody').addEventListener('click', async (e) => {
    const f = e.target.closest('[data-f]'); if (f) { filter = f.dataset.f; render(); return; }
    const o = e.target.closest('[data-open]'); if (o) { const id = +o.dataset.open; openId = openId === id ? null : id; render(); return; }
    const s = e.target.closest('[data-set]'); if (s) { setStatus(+s.dataset.item, s.dataset.set, s); return; }
    const fl = e.target.closest('[data-file]'); if (fl) { try { await openPrivateFile(fl); } catch (err) { toast(errText(err), 'err'); } return; }
    const rs = e.target.closest('[data-rmsample]'); if (rs) { removeSample(rs.dataset.k, rs.dataset.rmsample); return; }
    const rr = e.target.closest('[data-rmreview]'); if (rr) { removeReviewFile(+rr.dataset.item, rr.dataset.rmreview); return; }
    if (e.target.closest('#critSave')) { saveEditor(e.target.closest('#critSave')); return; }
    const a = e.target.closest('[data-additem]'); if (a) { addItem(a.dataset.additem, a.parentElement.querySelector('.new-item')); return; }
    const d = e.target.closest('[data-delitem]'); if (d) { delItem(+d.dataset.delitem); return; }
    const as = e.target.closest('[data-addsub]'); if (as) { addSub(+as.dataset.addsub, as.closest('.add-sub')); return; }
    if (e.target.closest('[data-addtopic]')) { addTopic(); return; }
    const dt = e.target.closest('[data-deltopic]');
    if (dt) { const no = +dt.dataset.deltopic; delGroup(items.filter((it) => it.topic_no === no), `ข้อใหญ่ ${no}`); return; }
    const ds = e.target.closest('[data-delsub]');
    if (ds) { const [t, sid] = ds.dataset.delsub.split('|'); delGroup(items.filter((it) => String(it.topic_no) === t && it.sub_id === sid), `หัวข้อย่อย ${sid}`); }
  });
}
