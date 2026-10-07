// เจ้าหน้าที่: ประเมินมาตรฐานด้านยา — ส่งรายละเอียด + ไฟล์หลักฐานรายข้อ ให้ผู้ดูแลตรวจ
// ปีงบปัจจุบันส่ง/แก้ได้ · ปีที่ผ่านมาดูอย่างเดียว (ฐานข้อมูลบังคับด้วย trigger)
import { sb, publicImageUrl } from '../supabase.js?v=4.4';
import { $, esc, fiscalYearOf, thaiDate, toast, errText, busy } from '../util.js?v=4.4';
import { auth } from '../auth.js?v=4.4';
import { loadYears, sortItems } from '../data.js?v=4.4';
import { uploadEvidence, removeFiles, previewFiles, fileCard, hydrateSigned, openPrivateFile, linkMap, linkedHtml } from '../upload.js?v=4.4';
import { openLightbox } from '../lightbox.js?v=4.4';
import { refreshBadges } from './staff.js?v=4.4';

const CUR_FY = fiscalYearOf();
let year = null, items = [], status = new Map(), linked = new Map(), openId = null, bound = false;   // linked: item_id → ผลงานที่ผูกข้อนั้น
const pendingRemove = new Set();   // ไฟล์ที่กดลบ — ลบจริงตอนกดส่ง
const pickedAch = new Set();       // รูปจาก "ผลงาน" ที่เลือกเป็นหลักฐาน — คัดลอกเข้า evidence ตอนกดส่ง
let achList = null;                 // ผลงานที่มีรูปของหน่วยตัวเอง (โหลดเมื่อกดเลือกครั้งแรก)

const ST = { none: ['ยังไม่ส่ง', 'c-off'], submitted: ['ส่งแล้ว รอตรวจ', 'c-rev'], fix: ['ต้องแก้ไข', 'c-fix'], approved: ['ผ่านแล้ว', 'c-ok'] };
const FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';

export async function initCriteria() {
  const years = (await loadYears()).filter((y) => y <= CUR_FY);
  if (year === null || !years.includes(year)) year = years.includes(CUR_FY) ? CUR_FY : years[years.length - 1];
  if (!years.length) { $('#scYears').innerHTML = ''; $('#scSummary').innerHTML = ''; $('#scList').innerHTML = '<p class="empty">ยังไม่เปิดให้ส่งหลักฐาน — ผู้ดูแลยังไม่ได้เปิดปีงบประมาณ</p>'; return; }
  $('#scYears').innerHTML = years.map((y) => `<button type="button" data-y="${y}" aria-current="${y === year}">ปีงบประมาณ ${y}${y === CUR_FY ? ' (ปัจจุบัน)' : ''}</button>`).join('');
  if (!bound) { bound = true; bind(); }
  await load();
}

async function load() {
  $('#scList').innerHTML = '<div class="skeleton"></div><div class="skeleton" style="width:70%;margin-top:10px"></div>';
  const [ci, st, ach] = await Promise.all([
    sb.from('criteria_items').select('id,topic_no,topic_title,sub_id,sub_label,evidence,evidence_samples,item_no,body,sort').eq('fiscal_year', year).order('sort'),
    sb.from('item_status').select('id,item_id,status,detail,evidence_paths,review_comment,review_files,submitted_at,trashed_at').eq('unit_id', auth.profile.unit_id),
    sb.from('achievements').select('id,title,image_path,item_ids,created_at').eq('unit_id', auth.profile.unit_id).order('created_at', { ascending: false }),
  ]);
  if (ci.error) { $('#scList').innerHTML = `<p class="empty">${esc(errText(ci.error))}</p>`; return; }
  items = sortItems(ci.data);
  status = new Map((st.data || []).map((s) => [s.item_id, s]));
  linked = linkMap(ach.data || []);
  render();
}

const stOf = (it) => status.get(it.id)?.status || 'none';

function render() {
  const editable = year === CUR_FY;
  const total = items.length, count = { none: 0, submitted: 0, fix: 0, approved: 0 };
  items.forEach((it) => count[stOf(it)]++);
  const pct = total ? Math.round(count.approved / total * 100) : 0;
  $('#scTitle').textContent = `เกณฑ์มาตรฐานงานเภสัชกรรมปฐมภูมิ · ปีงบ ${year}`;
  $('#scScore').textContent = `${count.approved}/${total} คะแนน`;
  $('#scNote').textContent = editable
    ? 'กดที่ข้อเพื่อกรอกรายละเอียดและแนบหลักฐาน (PDF หรือรูป ไม่เกิน 2 MB ต่อไฟล์) · ผู้ดูแลจะตรวจและให้คะแนน'
    : `ปีงบ ${year} ปิดการส่งแล้ว — ดูผลได้อย่างเดียว`;

  const fixes = items.filter((it) => stOf(it) === 'fix');
  const topics = [...new Map(items.map((it) => [it.topic_no, it.topic_title])).entries()];
  const missingTopics = topics.filter(([no]) => items.some((it) => it.topic_no === no && ['none', 'fix'].includes(stOf(it))));
  $('#scSummary').innerHTML = `<div class="panel-head"><h2>ความคืบหน้า</h2><b class="num" style="font-size:20px">${pct}%</b></div>`
    + `<div class="meter" role="img" aria-label="ผ่านแล้ว ${pct} เปอร์เซ็นต์"><span style="width:${pct}%"></span></div>`
    + `<div class="row-btns"><span class="chip c-ok">ผ่านแล้ว ${count.approved}</span><span class="chip c-rev">รอตรวจ ${count.submitted}</span><span class="chip c-fix">ต้องแก้ไข ${count.fix}</span><span class="chip c-off">ยังไม่ส่ง ${count.none}</span></div>`
    + (fixes.length ? `<div class="alert" role="note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg><div><b>ผู้ดูแลขอให้แก้ไข ${fixes.length} ข้อ</b>`
      + fixes.map((it) => `<div class="small"><button type="button" class="linklike" data-jump="${it.id}">ข้อ ${esc(it.item_no)}</button>${status.get(it.id).review_comment ? ' — ' + esc(status.get(it.id).review_comment) : ''}</div>`).join('') + '</div></div>' : '')
    + (missingTopics.length && pct < 100 ? '<p class="small" style="font-weight:600">หัวข้อที่ยังไม่ครบ</p><div class="row-btns">'
      + missingTopics.map(([no, t]) => `<button type="button" class="btn btn-o btn-sm btn-wrap" data-topic="${no}">${esc(t)}</button>`).join('') + '</div>' : '')
    + (pct === 100 ? '<p class="small" style="color:var(--success);font-weight:600">ผ่านเกณฑ์มาตรฐานครบ 100% 🎉</p>' : '');

  $('#scList').innerHTML = topics.map(([no, title]) => {
    const tItems = items.filter((it) => it.topic_no === no);
    const got = tItems.filter((it) => stOf(it) === 'approved').length;
    const open = tItems.some((it) => it.id === openId || stOf(it) === 'fix');
    let lastSub = null;
    const rows = tItems.map((it) => {
      let head = '';
      if (it.sub_id !== lastSub) {
        lastSub = it.sub_id;
        head = (it.sub_label ? `<div class="crit-sub">${esc(it.sub_label)}</div>` : '')
          + (it.evidence ? `<p class="small muted" style="margin:0 0 6px">หลักฐาน/เอกสารที่ต้องใช้: ${esc(it.evidence)}</p>` : '')
          + (it.evidence_samples?.length ? `<p class="small muted">ตัวอย่างหลักฐาน (กดเพื่อเปิด/ดาวน์โหลด)</p><div class="fthumbs samples">${it.evidence_samples.map((f) => fileCard('criteria-samples', f.path, f.name)).join('')}</div>` : '');
      }
      const s = stOf(it), [label, cls] = ST[s];
      return head + `<div class="crit-item" id="ci-${it.id}"><span class="ci-no">${esc(it.item_no)}</span><span class="ci-text">${esc(it.body)}</span>`
        + (linked.get(it.id)?.length ? `<span class="chip c-role" title="ผลงานที่แนบเป็นหลักฐาน">ผลงาน ${linked.get(it.id).length}</span>` : '')
        + `<span class="chip ${cls}">${label}</span>`
        + `<button type="button" class="ci-folder st-${s}" data-open="${it.id}" aria-expanded="${openId === it.id}" aria-label="${editable ? 'ส่ง/ดูหลักฐาน' : 'ดูหลักฐาน'}ข้อ ${esc(it.item_no)}">${FOLDER}</button></div>`
        + (openId === it.id ? box(it, editable) : '');
    }).join('');
    return `<details id="topic-${no}"${open ? ' open' : ''}><summary><span>${esc(title)}</span><b class="num">${got}/${tItems.length}</b></summary><div class="crit-subs">${rows}</div></details>`;
  }).join('') || '<p class="empty">ยังไม่มีเกณฑ์ของปีงบนี้</p>';
  hydrateSigned($('#scList'));
}

function box(it, editable) {
  const s = status.get(it.id), st = s?.status || 'none';
  const canEdit = editable && st !== 'approved';
  const files = (s?.evidence_paths || []).map((p, i) => {
    const gone = pendingRemove.has(p);
    return '<div class="fitem">' + fileCard('evidence', p, `ไฟล์ ${i + 1}${gone ? ' · จะลบเมื่อกดส่ง' : ''}`, gone ? 'gone' : '')
      + (canEdit ? `<button type="button" class="btn ${gone ? 'btn-o' : 'btn-no'} btn-sm" data-rmfile="${esc(p)}">${gone ? 'ยกเลิกการลบ' : 'ลบไฟล์'}</button>` : '')
      + '</div>';
  }).join('');
  return '<div class="crit-editbox">'
    + `<h3>ข้อ ${esc(it.item_no)} — ${esc(it.body)}</h3>`
    + (st === 'fix' && s.review_comment ? `<p class="small" style="color:var(--warning)"><b>ความเห็นผู้ดูแล:</b> ${esc(s.review_comment)}</p>` : '')
    + (s?.review_files?.length ? `<p class="small" style="font-weight:600">ไฟล์จากผู้ดูแล (กดเพื่อเปิด)</p><div class="fthumbs">${s.review_files.map((p, i) => fileCard('evidence', p, `ไฟล์ผู้ดูแล ${i + 1}`)).join('')}</div>` : '')
    + (st === 'approved' ? '<p class="small" style="color:var(--success)"><b>ผู้ดูแลอนุมัติข้อนี้แล้ว</b></p>' : '')
    + (s?.trashed_at ? `<p class="small" style="color:var(--warning)"><b>ผู้ดูแลยกเลิกคำขอตรวจนี้แล้ว</b> (${esc(thaiDate(s.trashed_at))}) · แก้ไข/เพิ่มหลักฐานแล้วกดส่งใหม่ได้</p>` : '')
    + (st === 'submitted' ? `<div class="wait-note"><span class="chip c-rev">ส่งแล้ว รอตรวจ</span><span class="small muted">ส่งเมื่อ ${esc(thaiDate(s.submitted_at))} · แก้แล้วกด "ส่งตรวจอีกครั้ง" ได้</span>`
      + (editable ? `<button type="button" class="btn btn-o btn-sm" data-withdraw="${s.id}">ยกเลิกการส่ง</button>` : '') + '</div>' : '')
    + (canEdit
      ? `<label class="small" style="font-weight:600" for="ev-detail">รายละเอียดหลักฐาน</label><textarea id="ev-detail" rows="3" maxlength="4000" placeholder="อธิบายว่าหลักฐานคืออะไร เช่น เลขที่คำสั่ง วันที่ ไฟล์แนบ">${esc(s?.detail || '')}</textarea>`
        + `<label class="small" style="font-weight:600" for="ev-files">แนบไฟล์เพิ่ม (PDF/รูป · เลือกได้หลายไฟล์)</label><input id="ev-files" class="input" type="file" accept="application/pdf,image/*" multiple><div class="fthumbs" id="ev-preview" hidden></div>`
        + '<div><button type="button" class="btn btn-o btn-sm" data-ach-pick aria-expanded="false" aria-controls="ev-ach">เลือกรูปจาก "ผลงาน" ที่นำเสนอแล้ว</button> <span class="small muted" id="ev-ach-n"></span></div><div class="ach-pick" id="ev-ach" hidden></div>'
      : (s?.detail ? `<p class="small"><b>รายละเอียด:</b> ${esc(s.detail)}</p>` : '<p class="small muted">ยังไม่มีการส่งหลักฐาน</p>'))
    + (files ? `<p class="small" style="font-weight:600">ไฟล์หลักฐานที่ส่งแล้ว (กดเพื่อเปิด)</p><div class="fthumbs">${files}</div>` : '')
    + linkedHtml(linked.get(it.id))
    + '<div class="row-btns" style="align-items:center">'
    + (canEdit ? `<button type="button" class="btn btn-p btn-sm" data-submit="${it.id}">${st === 'none' ? 'ส่งให้ผู้ดูแลตรวจ' : 'ส่งตรวจอีกครั้ง'}</button>` : '')
    + '<button type="button" class="btn btn-o btn-sm" data-close="1">ปิด</button><span class="small" id="ev-msg" aria-live="polite"></span></div></div>';
}

function bind() {
  $('#scYears').addEventListener('click', (e) => {
    const b = e.target.closest('[data-y]'); if (!b) return;
    year = +b.dataset.y; openId = null;
    $('#scYears').querySelectorAll('button').forEach((x) => x.setAttribute('aria-current', x === b ? 'true' : 'false'));
    load();
  });
  $('#scSummary').addEventListener('click', (e) => {
    const t = e.target.closest('[data-topic]');
    if (t) { const d = $('#topic-' + t.dataset.topic); d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const j = e.target.closest('[data-jump]');
    if (j) { openId = +j.dataset.jump; render(); $('#ci-' + openId).scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  });
  $('#scList').addEventListener('click', async (e) => {
    const o = e.target.closest('[data-open]');
    if (o) { const id = +o.dataset.open; openId = openId === id ? null : id; pendingRemove.clear(); pickedAch.clear(); render(); return; }
    if (e.target.closest('[data-close]')) { openId = null; pendingRemove.clear(); pickedAch.clear(); render(); return; }
    if (e.target.closest('[data-ach-pick]')) { toggleAchPicker(e.target.closest('[data-ach-pick]')); return; }
    const ao = e.target.closest('[data-ach-opt]');
    if (ao) { const id = ao.dataset.achOpt; if (pickedAch.has(id)) pickedAch.delete(id); else pickedAch.add(id); ao.setAttribute('aria-pressed', String(pickedAch.has(id))); achCount(); return; }
    const f = e.target.closest('[data-file]');
    if (f) { try { await openPrivateFile(f); } catch (err) { toast(errText(err), 'err'); } return; }
    const al = e.target.closest('[data-achlink]');
    if (al) { openLightbox(al.dataset.achlink, al.dataset.title); return; }
    const rm = e.target.closest('[data-rmfile]');
    if (rm) {
      const path = rm.dataset.rmfile, detail = $('#ev-detail')?.value;
      if (pendingRemove.has(path)) pendingRemove.delete(path); else pendingRemove.add(path);
      render(); if (detail != null && $('#ev-detail')) $('#ev-detail').value = detail;
      return;
    }
    const wd = e.target.closest('[data-withdraw]');
    if (wd) { withdraw(+wd.dataset.withdraw, wd); return; }
    const sub = e.target.closest('[data-submit]');
    if (sub) submit(+sub.dataset.submit, sub);
  });
  $('#scList').addEventListener('change', (e) => { if (e.target.id === 'ev-files') previewFiles(e.target.files, $('#ev-preview')); });
}

/* ---------- เลือกรูปจาก "ผลงาน" (ตาราง achievements ของหน่วยตัวเอง) เป็นหลักฐาน ---------- */
const achCount = () => { const n = $('#ev-ach-n'); if (n) n.textContent = pickedAch.size ? `เลือกแล้ว ${pickedAch.size} รูป · คัดลอกเป็นไฟล์หลักฐานตอนกดส่ง` : ''; };
async function toggleAchPicker(btn) {
  const box = $('#ev-ach'), open = box.hidden;
  box.hidden = !open; btn.setAttribute('aria-expanded', String(open));
  if (!open) return;
  if (!achList) {
    box.innerHTML = '<div class="skeleton"></div>';
    const { data, error } = await sb.from('achievements').select('id,title,image_path,created_at').eq('unit_id', auth.profile.unit_id).order('created_at', { ascending: false }).limit(60);
    if (error) { box.innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
    achList = data.filter((a) => a.image_path);
  }
  box.innerHTML = achList.length ? achList.map((a) => `<button type="button" class="ach-opt" data-ach-opt="${a.id}" aria-pressed="${pickedAch.has(a.id)}"><img src="${esc(publicImageUrl(a.image_path))}" alt="" loading="lazy"><span>${esc(a.title)}</span></button>`).join('')
    : '<p class="empty">ยังไม่มีผลงานที่มีรูป · ส่งผลงานได้ที่เมนู "ผลงาน"</p>';
}
/** คัดลอกรูปผลงานที่เลือกเป็นไฟล์หลักฐาน (bucket evidence ส่วนตัว) → path */
async function copyAchImages(folder) {
  const out = [];
  for (const id of pickedAch) {
    const a = achList?.find((x) => x.id === id); if (!a) continue;
    const r = await fetch(publicImageUrl(a.image_path));
    if (!r.ok) throw new Error(`โหลดรูปผลงาน "${a.title}" ไม่ได้`);
    const blob = await r.blob();
    out.push(await uploadEvidence(new File([blob], 'achievement.webp', { type: blob.type || 'image/webp' }), folder));
  }
  return out;
}

/** ยกเลิกการส่ง (ยังรอตรวจ) → กลับเป็น "ยังไม่ส่ง" หรือ "ต้องแก้ไข" · รายละเอียด/ไฟล์ยังอยู่ */
async function withdraw(statusId, btn) {
  if (!confirm('ยกเลิกการส่งข้อนี้?\nรายละเอียดและไฟล์ยังอยู่ แก้ไขแล้วส่งใหม่ได้')) return;
  busy(btn, true, 'กำลังยกเลิก…');
  const { error } = await sb.rpc('withdraw_item_status', { p_id: statusId });
  if (error) { busy(btn, false); toast(errText(error), 'err'); return; }
  toast('ยกเลิกการส่งแล้ว');
  await load(); refreshBadges();
}

async function submit(itemId, btn) {
  const it = items.find((x) => x.id === itemId), s = status.get(itemId), m = $('#ev-msg');
  const detail = $('#ev-detail').value.trim(), files = [...$('#ev-files').files];
  const kept = (s?.evidence_paths || []).filter((p) => !pendingRemove.has(p));
  if (!detail && !files.length && !kept.length && !pickedAch.size) { m.style.color = 'var(--error)'; m.textContent = 'กรุณากรอกรายละเอียดหรือแนบไฟล์หลักฐาน'; return; }
  busy(btn, true, files.length || pickedAch.size ? 'กำลังอัปโหลด…' : 'กำลังส่ง…'); m.textContent = '';
  const uploaded = [];
  try {
    for (const f of files) uploaded.push(await uploadEvidence(f, `${year}/${auth.profile.unit_id}/${it.item_no}`));
    uploaded.push(...await copyAchImages(`${year}/${auth.profile.unit_id}/${it.item_no}`));
    const paths = [...kept, ...uploaded];
    const res = s
      ? await sb.from('item_status').update({ detail: detail || null, evidence_paths: paths }).eq('id', s.id).select()
      : await sb.from('item_status').insert({ item_id: itemId, unit_id: auth.profile.unit_id, detail: detail || null, evidence_paths: paths }).select();
    if (res.error) throw res.error;
    if (!res.data?.length) throw new Error('บันทึกไม่สำเร็จ (ข้อนี้อาจถูกอนุมัติแล้ว)');
    if (pendingRemove.size) removeFiles('evidence', [...pendingRemove]);
    toast(`ส่งข้อ ${it.item_no} ให้ผู้ดูแลตรวจแล้ว`);
    openId = null; pendingRemove.clear(); pickedAch.clear(); await load(); refreshBadges();
  } catch (err) {
    if (uploaded.length) removeFiles('evidence', uploaded);
    m.style.color = 'var(--error)'; m.textContent = errText(err);
    busy(btn, false);
  }
}
