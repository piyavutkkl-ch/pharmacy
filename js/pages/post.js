// โพสต์ผลงาน (Unified Post): รวมฟอร์มโพสต์ "เยี่ยมบ้าน" และ "ผลงาน" ให้เป็นฟอร์มเดียว
// พร้อมรายการรวมด้านล่าง กรองประเภท [ทั้งหมด] [เยี่ยมบ้าน] [ผลงาน] + กรอง รพ.สต.
import { sb, publicImageUrl } from '../supabase.js?v=4.4';
import { $, $$, esc, thaiDate, toast, errText, busy, fiscalYearOf } from '../util.js?v=4.4';
import { auth } from '../auth.js?v=4.4';
import { loadUnits, loadYears, unitName, sortItems } from '../data.js?v=4.4';
import { uploadPublicImage, removeFiles } from '../upload.js?v=4.4';
import { imageList } from './news-form.js?v=4.4';
import {
  COLS as SUM_COLS, MAX_IMGS, imgsOf, HINT_IMG, dateOf, peopleOf, positionsOf, posOf,
  audit, visitRows, syncAchievement, syncLinks, loadSummariesData, deleteSummaryData, pendingKey, countLine,
} from './summaries.js?v=4.4';
import {
  todayYmd, achText, aiNos, aiStatus, pollAi, aiAfterSave, critLabel,
  loadAchievementsData, deleteAchievementData, toggleHideAchievement,
  runAchievementAi, applyAchievementAi,
} from './staff.js?v=4.4';

const SPIN = '<span class="spin" aria-hidden="true"></span>';
const VISIT_ITEM = '4.5.1';

let P = null;

const POST_HTML = `
  <div class="panel vs-panel">
    <details class="vs-fold" id="ppFold">
      <summary>
        <h2 id="ppFormTitle">โพสต์ผลงาน</h2>
        <span class="small muted vs-fold-hint">กดเพื่อเปิดฟอร์ม</span>
      </summary>
      <p class="small muted" id="ppWarn" hidden>แสดงที่หน้าหลัก › ผลการดำเนินงาน ทันทีที่บันทึก · <b>ห้ามมีชื่อ ใบหน้า หรือข้อมูลที่ระบุตัวผู้ป่วยในภาพ</b></p>
      <p class="small muted" id="ppAchNote">ผลงานของ รพ.สต. จะขึ้นหน้าหลักทันที ไม่ต้องรอผู้ดูแลตรวจ</p>
      <form id="ppForm" class="form-grid" novalidate>
        <!-- Segmented Type Buttons: [ เยี่ยมบ้าน ] [ ผลงาน ] (ค่าเริ่มต้น = ผลงาน) -->
        <div class="field full">
          <div class="pp-seg" id="ppTypeSeg" role="radiogroup" aria-label="ประเภทโพสต์">
            <button type="button" class="pp-seg-btn" data-type="visit" role="radio" aria-checked="false">เยี่ยมบ้าน</button>
            <button type="button" class="pp-seg-btn on" data-type="achievement" role="radio" aria-checked="true">ผลงาน</button>
          </div>
        </div>

        <!-- 1. รพ.สต.* -->
        <div class="field full" id="ppUnitWrap">
          <label for="ppUnit">รพ.สต. ที่ทำผลงานนี้ <span class="req">*</span></label>
          <select id="ppUnit" class="input"></select>
          <span class="small muted" id="ppUnitNote" hidden></span>
        </div>

        <!-- 2. หัวข้อ/ชื่อผลงาน* -->
        <div class="field full">
          <label for="ppTitle">หัวข้อ / ชื่อผลงาน <span class="req">*</span></label>
          <input id="ppTitle" class="input" maxlength="200" placeholder="ชื่อผลงานหรือหัวข้อสรุป">
        </div>

        <!-- 3. วันที่* -->
        <div class="field">
          <label for="ppDate">วันที่ <span class="req">*</span></label>
          <input id="ppDate" class="input" type="date">
          <span class="small muted" id="ppDateTh"></span>
        </div>

        <!-- เยี่ยมบ้าน only: ปีงบประมาณ -->
        <div class="field pp-visit-only" id="ppYearWrap" hidden>
          <label for="ppYear">ปีงบประมาณ</label>
          <select id="ppYear" class="input"></select>
        </div>

        <!-- เยี่ยมบ้าน only: ผู้ป่วยที่เยี่ยม & แนบรายชื่อเยี่ยมบ้าน -->
        <div class="field full vs-box pp-visit-only" id="ppVisitBoxWrap" hidden>
          <div class="vs-pt-row">
            <label for="ppPatientCount" class="vs-pt-lbl"><b>ผู้ป่วยที่เยี่ยม (จำนวนลงเยี่ยม)</b> <span class="small muted">(กรอกจำนวนเอง หรือเว้นว่างเพื่อนับจากรายชื่อที่ติ๊กด้านล่าง)</span></label>
            <div class="vs-pt-inp">
              <input id="ppPatientCount" class="input num" type="number" min="0" max="10000" step="1" inputmode="numeric" placeholder="กรอกจำนวน หรือเว้นว่างเพื่อนับจากรายชื่อที่ติ๊ก">
              <span class="small muted">ราย</span>
            </div>
          </div>
          <label class="vs-box-h"><input type="checkbox" id="ppVisitOn"> <span><b id="ppVisitL">แนบรายชื่อเยี่ยมบ้าน</b> <span class="small muted">(เชื่อมโยงรายการเยี่ยม)</span></span></label>
          <div class="vs-box-b" id="ppVisitBox" hidden>
            <p class="small muted vs-hint">ผูกบันทึกการเยี่ยมของผู้ป่วยแต่ละคนใน one page นี้ · เจ้าหน้าที่/ผู้ดูแลกดจากหน้าสรุปไปดูว่าเยี่ยมแล้วทำอะไร ติดตามอะไร (ประชาชนไม่เห็นส่วนนี้)</p>
            <div class="list vs-other-list" id="ppVisits" aria-labelledby="ppVisitL"></div>
            <div><button type="button" class="btn btn-o btn-sm" id="ppVisitBtn" aria-expanded="false" aria-controls="ppVisitPick">+ เชื่อมโยงรายการเยี่ยม</button></div>
            <div class="vs-visit-pick" id="ppVisitPick" hidden>
              <input id="ppVisitQ" class="input" type="search" maxlength="60" placeholder="ค้นหาชื่อผู้ป่วย" aria-label="ค้นหาชื่อผู้ป่วย">
              <div class="list" id="ppVisitRes"></div>
            </div>
          </div>
        </div>

        <!-- เยี่ยมบ้าน only: แนบรายชื่อเจ้าหน้าที่ที่ร่วมลง -->
        <div class="field full vs-box pp-visit-only" id="ppPeopleBoxWrap" hidden>
          <label class="vs-box-h"><input type="checkbox" id="ppPeopleOn"> <span><b>แนบรายชื่อเจ้าหน้าที่ที่ร่วมลง</b> <span class="small muted">(เลือกได้หลายคน)</span></span></label>
          <div class="vs-box-b" id="ppPeopleBox" hidden>
            <details class="vs-pfold" id="ppPeopleFold">
              <summary><span class="lbl-t">รายชื่อเจ้าหน้าที่</span><span class="small vs-people-n" id="ppPeopleN" aria-live="polite"></span></summary>
              <div class="unit-tabs vs-ptabs" id="ppPeopleTabs" aria-label="กรองรายชื่อตาม รพ.สต."></div>
              <input id="ppPeopleQ" class="input" type="search" maxlength="60" placeholder="ค้นหาชื่อ" aria-label="ค้นหาชื่อเจ้าหน้าที่">
              <div class="crit-pick vs-people" id="ppPeople" role="group" aria-label="เจ้าหน้าที่ที่ร่วมลง"></div>
              <div class="vs-other">
                <p class="small muted">ไม่มีชื่อในรายการ? กรอกเพิ่มเองได้ (ชื่อ นามสกุล ตำแหน่ง)</p>
                <div class="vs-other-row">
                  <input id="ppOFirst" class="input" maxlength="50" placeholder="ชื่อ" aria-label="ชื่อผู้ร่วมลง">
                  <input id="ppOLast" class="input" maxlength="50" placeholder="นามสกุล" aria-label="นามสกุลผู้ร่วมลง">
                  <input id="ppOPos" class="input" maxlength="45" placeholder="ตำแหน่ง เช่น อสม." aria-label="ตำแหน่งผู้ร่วมลง">
                  <button type="button" class="btn btn-o btn-sm" id="ppOAdd">+ เพิ่มชื่อ</button>
                </div>
                <div class="list vs-other-list" id="ppOthers"></div>
              </div>
            </details>
          </div>
        </div>

        <!-- เยี่ยมบ้าน only: สรุปนับจำนวนลงเยี่ยม -->
        <div class="field full pp-visit-only" id="ppCountsWrap" hidden>
          <span class="small vs-counts" id="ppCounts" aria-live="polite"></span>
        </div>

        <!-- 4. รายละเอียด -->
        <div class="field full">
          <label for="ppBody">รายละเอียด</label>
          <textarea id="ppBody" maxlength="10000" rows="4" placeholder="รายละเอียดของผลงานหรือสรุปการเยี่ยมบ้าน"></textarea>
        </div>

        <!-- 5. รูป (หลายรูป) -->
        <div class="field full">
          <label for="ppImage"><span id="ppImageLbl">รูปผลงาน (ถ้ามี)</span> <span class="req" id="ppImageReq" hidden>*</span></label>
          <input id="ppImage" class="input" type="file" accept="image/*" multiple>
          <span class="small muted" id="ppImageNote">เลือกรูปภาพผลงาน (ถ้ามี)</span>
          <div class="img-list" id="ppImagePreview" hidden></div>
        </div>

        <!-- 6. สอดคล้องกับมาตรฐานข้อ (เลือกได้หลายข้อ + ปุ่ม AI แนะนำเดิม) -->
        <div class="field full">
          <details class="vs-pfold" id="ppCritFold">
            <summary>
              <span class="lbl-t">สอดคล้องกับมาตรฐานข้อ (เลือกได้มากกว่า 1 ข้อ)</span>
              <span class="small vs-people-n" id="ppCritN" aria-live="polite"></span>
            </summary>
            <p class="small muted" id="ppCritHint">ผลงานจะแนบเป็นหลักฐานของข้อที่เลือกโดยอัตโนมัติ ไม่ต้องส่งให้ผู้ดูแลตรวจ</p>
            <div class="ai-box" id="ppAi">
              <p class="small"><b>✨ ให้ AI ช่วยแนะนำ</b> — พิมพ์ "รายละเอียด" ผลงานด้านบนให้ครบก่อน แล้วกดปุ่มนี้ AI จะเทียบกับหัวข้อมาตรฐานทุกข้อที่ผู้ดูแลกำหนด แล้วติ๊กข้อที่ตรงให้ (ใช้เวลาสักครู่ ประมาณ 10–30 วินาที · ห้ามใส่ชื่อหรือข้อมูลผู้ป่วย)</p>
              <button type="button" class="btn btn-o btn-sm" id="ppAiBtn">ให้ AI วิเคราะห์รายละเอียด</button>
              <div class="ai-out" id="ppAiOut" aria-live="polite"></div>
            </div>
            <input id="ppCritQ" class="input" type="search" maxlength="60" placeholder="ค้นหาเลขข้อหรือข้อความ เช่น 1.1">
            <div class="crit-pick" id="ppCrit" role="group" aria-label="ข้อมาตรฐานที่สอดคล้อง"></div>
          </details>
        </div>

        <!-- Submit, Cancel, Msg -->
        <div class="full row-btns" style="align-items:center">
          <button class="btn btn-p btn-sm" type="submit" id="ppSubmit">เผยแพร่ผลงาน</button>
          <button class="btn btn-o btn-sm" type="button" id="ppCancel" hidden>ยกเลิกการแก้ไข</button>
          <span class="small" id="ppMsg" aria-live="polite"></span>
        </div>
      </form>
    </details>
  </div>

  <!-- Combined List -->
  <div class="panel vs-panel">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px">
      <h2 class="vs-list-h" id="ppListTitle" style="margin:0">ผลงานทั้งหมด</h2>
      <div class="unit-tabs" id="ppTypeFilter" aria-label="กรองประเภทผลงาน" style="margin:0">
        <button type="button" class="tab-link" data-pf="all" aria-current="true">ทั้งหมด</button>
        <button type="button" class="tab-link" data-pf="visit">เยี่ยมบ้าน</button>
        <button type="button" class="tab-link" data-pf="achievement">ผลงาน</button>
      </div>
    </div>
    <div class="unit-tabs" id="ppUnitFilter" aria-label="กรองตาม รพ.สต." hidden style="margin-bottom:8px"></div>
    <div class="list" id="ppList"></div>
  </div>
`;

/**
 * ติดตั้งหน้า "โพสต์ผลงาน"
 * @param {HTMLElement} slot - ช่องแสดงผล
 * @param {string|number} unit - 'all' (ผู้ดูแล) หรือ unit_id (เจ้าหน้าที่)
 * @param {object} [options] - ตัวเลือก เช่น { filter: 'visit'|'achievement'|'all' }
 */
export async function mountPost(slot, unit, options = {}) {
  const units = await loadUnits();
  const filter = options.filter || 'all';

  if (!P || P.slot !== slot) {
    slot.innerHTML = POST_HTML;
    P = {
      slot,
      unit,
      units,
      type: 'achievement', // เริ่มต้น = ผลงาน
      editing: null,
      typeFilter: filter,
      unitFilter: 'all',
      critCache: new Map(),
      critPicked: new Set(),
      people: null,
      pickedPeople: new Set(),
      pickedNames: new Set(),
      otherPeople: [],
      links: new Map(),
      linksOrig: new Set(),
      formAi: null,
      aiOf: new Map(),
      aiTimer: 0,
      achList: [],
      sumList: [],
      ptCount: new Map(),
      linkCount: new Map(),
      imgKit: imageList($('#ppImage'), $('#ppImagePreview'), $('#ppImageNote'), { max: MAX_IMGS, hint: HINT_IMG }),
    };

    const years = await loadYears();
    $('#ppYear').innerHTML = [...new Set([...years, fiscalYearOf()])].sort((a, b) => b - a).map((y) => `<option value="${y}">ปีงบประมาณ ${y}</option>`).join('');
    renderUnitOptions();

    // Event listeners
    $('#ppTypeSeg').addEventListener('click', onTypeSegClick);
    $('#ppForm').addEventListener('submit', onSubmit);
    $('#ppCancel').addEventListener('click', onCancel);
    $('#ppDate').addEventListener('change', onDateChange);
    $('#ppYear').addEventListener('change', onYearChange);
    $('#ppCritFold').addEventListener('toggle', onCritFoldToggle);
    $('#ppCritQ').addEventListener('input', renderCrit);
    $('#ppCrit').addEventListener('change', onCritChange);
    $('#ppAiBtn').addEventListener('click', onRunAi);

    // เยี่ยมบ้าน events
    $('#ppPatientCount').addEventListener('input', updatePeopleCounts);
    $('#ppVisitOn').addEventListener('change', onBoxesChange);
    $('#ppPeopleOn').addEventListener('change', onBoxesChange);
    $('#ppVisitBtn').addEventListener('click', toggleVisitPick);
    $('#ppVisitQ').addEventListener('input', renderVisitPick);
    $('#ppVisitRes').addEventListener('click', onVisitResClick);
    $('#ppVisitRes').addEventListener('change', onVisitResChange);
    $('#ppVisits').addEventListener('click', onVisitsClick);
    $('#ppPeopleQ').addEventListener('input', renderPeople);
    $('#ppPeopleTabs').addEventListener('click', onPeopleTabClick);
    $('#ppPeople').addEventListener('click', onPeopleClick);
    $('#ppPeople').addEventListener('change', onPeopleChange);
    $('#ppOAdd').addEventListener('click', addOtherPerson);
    ['#ppOFirst', '#ppOLast', '#ppOPos'].forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addOtherPerson(); } }));
    $('#ppOthers').addEventListener('click', onOthersClick);

    // Filter events
    $('#ppTypeFilter').addEventListener('click', onTypeFilterClick);
    $('#ppUnitFilter').addEventListener('click', onUnitFilterClick);

    // List action events
    $('#ppList').addEventListener('click', onListClick);
  } else {
    P.unit = unit;
    P.units = units;
    if (filter) P.typeFilter = filter;
    renderUnitOptions();
  }

  // โหลดรายชื่อเจ้าหน้าที่สำหรับแนบผู้ร่วมลง
  const { data: ppl, error: pErr } = await sb.rpc('staff_directory');
  P.people = pErr ? (P.people || []) : ppl;

  // ตั้งค่า filter chip ใน UI
  setTypeFilter(P.typeFilter, false);

  // ตั้งค่า รพ.สต. filter สำหรับ admin
  renderAdminUnitChips();

  // รีเซ็ตฟอร์มเป็นสถานะเริ่มต้น (ผลงาน)
  resetForm();

  // โหลดรายการ
  await loadCombinedList();
}

/* ================== ฟอร์ม & การสลับประเภท ================== */

function renderUnitOptions() {
  const units = P.units || [];
  if (P.unit === 'all') {
    $('#ppUnit').innerHTML = '<option value="">— เลือก รพ.สต. —</option>' + units.map((u) => `<option value="${u.id}">รพ.สต.${esc(u.name)}</option>`).join('');
  } else {
    $('#ppUnit').innerHTML = units.map((u) => `<option value="${u.id}">รพ.สต.${esc(u.name)}</option>`).join('');
    $('#ppUnit').value = String(P.unit);
  }
}

function onTypeSegClick(e) {
  const btn = e.target.closest('[data-type]');
  if (!btn || btn.disabled) return;
  setType(btn.dataset.type);
}

function setType(type) {
  P.type = type;
  $$('#ppTypeSeg .pp-seg-btn').forEach((b) => {
    const on = b.dataset.type === type;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });

  const isVisit = type === 'visit';
  $$('.pp-visit-only').forEach((el) => { el.hidden = !isVisit; });
  $('#ppWarn').hidden = !isVisit;
  $('#ppAchNote').hidden = isVisit;

  if (isVisit) {
    $('#ppImageLbl').textContent = 'ภาพสรุป (A4)';
    $('#ppImageReq').hidden = false;
    $('#ppImageNote').textContent = HINT_IMG;
    if (!P.editing) {
      $('#ppFormTitle').textContent = 'โพสต์ผลงาน';
      $('#ppSubmit').textContent = 'เผยแพร่สรุปเยี่ยมบ้าน';
    } else {
      $('#ppFormTitle').textContent = 'แก้ไขสรุปผลงาน';
      $('#ppSubmit').textContent = 'บันทึกการแก้ไข';
    }
    if (!$('#ppPeopleOn').checked && (!P.editing || P.editing.type === 'achievement')) {
      $('#ppPeopleOn').checked = true;
      $('#ppPeopleBox').hidden = false;
      updatePeopleCounts();
    }
    onDateChange();
  } else {
    $('#ppImageLbl').textContent = 'รูปผลงาน (ถ้ามี)';
    $('#ppImageReq').hidden = true;
    $('#ppImageNote').textContent = 'เลือกรูปภาพผลงาน (ถ้ามี)';
    if (!P.editing) {
      $('#ppFormTitle').textContent = 'โพสต์ผลงาน';
      $('#ppSubmit').textContent = 'เผยแพร่ผลงาน';
    } else {
      $('#ppFormTitle').textContent = 'แก้ไขผลงาน';
      $('#ppSubmit').textContent = 'บันทึกการแก้ไข';
    }
  }

  // เจ้าหน้าที่: ถ้าเป็นผลงาน ล็อก รพ.สต. เป็นหน่วยตัวเองเสมอ
  if (auth.profile?.role === 'staff') {
    if (!isVisit) {
      $('#ppUnit').value = String(auth.profile.unit_id);
    }
  }
}

function onDateChange() {
  const d = $('#ppDate').value;
  if (!d) return;
  $('#ppDateTh').textContent = `(ตรงกับ ${thaiDate(d)})`;
  const fy = fiscalYearOf(d);
  if ($('#ppYear') && (!P.editing || P.editing.type === 'achievement')) {
    $('#ppYear').value = String(fy);
  }
  loadCrit();
}

function onYearChange() {
  loadCrit();
}

function onBoxesChange() {
  const vOn = $('#ppVisitOn').checked, pOn = $('#ppPeopleOn').checked;
  $('#ppVisitBox').hidden = !vOn;
  $('#ppPeopleBox').hidden = !pOn;
  updatePeopleCounts();
}

function resetForm() {
  P.editing = null;
  $('#ppForm').reset();
  if ($('#ppPatientCount')) $('#ppPatientCount').value = '';
  $('#ppDate').value = todayYmd();
  onDateChange();

  // ปลดล็อกปุ่มเลือกประเภท
  $$('#ppTypeSeg .pp-seg-btn').forEach((b) => {
    b.disabled = false;
    b.style.pointerEvents = '';
  });

  // ค่าเริ่มต้นประเภท = ผลงาน
  setType('achievement');

  // ค่าหน่วยเริ่มต้น
  if (P.unit !== 'all' && P.unit != null) {
    $('#ppUnit').value = String(P.unit);
  } else if (auth.profile?.role === 'staff') {
    $('#ppUnit').value = String(auth.profile.unit_id);
  } else {
    $('#ppUnit').value = '';
  }

  // รีเซ็ตรูปภาพ
  P.imgKit?.set([]);

  // รีเซ็ตเกณฑ์มาตรฐาน
  P.critPicked.clear();
  P.formAi = null;
  $('#ppAiOut').innerHTML = '';
  $('#ppCritQ').value = '';
  $('#ppCritFold').open = false;
  renderCrit();

  // รีเซ็ตเยี่ยมบ้าน (คน & รายการเยี่ยม)
  P.pickedPeople.clear();
  if (auth.profile) P.pickedPeople.add(auth.profile.id);
  P.pickedNames.clear();
  P.otherPeople = [];
  P.links = new Map();
  P.linksOrig = new Set();
  $('#ppVisitOn').checked = false;
  $('#ppPeopleOn').checked = false;
  $('#ppVisitBox').hidden = true;
  $('#ppPeopleBox').hidden = true;
  $('#ppVisitPick').hidden = true;
  renderLinks();
  renderPeople();
  renderOthers();
  updatePeopleCounts();

  // ข้อความและปุ่ม
  $('#ppFormTitle').textContent = 'โพสต์ผลงาน';
  $('#ppSubmit').textContent = 'เผยแพร่ผลงาน';
  $('#ppCancel').hidden = true;
  $('#ppMsg').textContent = '';
}

function onCancel() {
  resetForm();
  $('#ppFold').open = false;
}

/* ================== เกณฑ์มาตรฐาน & AI ================== */

async function loadCrit() {
  const fy = P.type === 'visit' && $('#ppYear')?.value ? +$('#ppYear').value : fiscalYearOf($('#ppDate')?.value || todayYmd());
  if (!P.critCache.has(fy)) {
    $('#ppCrit').innerHTML = '<div class="skeleton"></div>';
    const { data, error } = await sb.from('criteria_items').select('id,topic_no,topic_title,sub_id,item_no,body,sort').eq('fiscal_year', fy).order('sort');
    if (error) { $('#ppCrit').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
    P.critCache.set(fy, sortItems(data || []));
  }
  renderCrit();
}

function renderCrit() {
  const fy = P.type === 'visit' && $('#ppYear')?.value ? +$('#ppYear').value : fiscalYearOf($('#ppDate')?.value || todayYmd());
  const items = P.critCache.get(fy) || [];
  const q = $('#ppCritQ')?.value?.trim().toLowerCase() || '';
  const list = items.filter((it) => !q || `${it.item_no} ${it.body} ${it.topic_title}`.toLowerCase().includes(q));
  let lastTopic = null;
  $('#ppCrit').innerHTML = list.map((it) => {
    const head = it.topic_no !== lastTopic ? `<p class="crit-pick-h">${esc(it.topic_title)}</p>` : '';
    lastTopic = it.topic_no;
    return head + `<label class="crit-opt"><input type="checkbox" value="${it.id}"${P.critPicked.has(it.id) ? ' checked' : ''}><span><b>${esc(it.item_no)}</b> ${esc(it.body)}</span></label>`;
  }).join('') || `<p class="empty">${items.length ? 'ไม่พบข้อที่ค้นหา' : `ยังไม่มีเกณฑ์มาตรฐานของปีงบ ${fy}`}</p>`;
  updateCritCount();
}

function updateCritCount() {
  const all = [...P.critCache.values()].flat();
  const nos = all.filter((it) => P.critPicked.has(it.id)).map((it) => it.item_no);
  $('#ppCritN').textContent = P.critPicked.size ? `เลือกแล้ว: ข้อ ${nos.join(', ') || P.critPicked.size + ' ข้อ'}` : 'ยังไม่ได้เลือก · กดเพื่อเลือก';
}

function onCritChange(e) {
  const id = +e.target.value;
  if (!id) return;
  if (e.target.checked) P.critPicked.add(id);
  else P.critPicked.delete(id);
  updateCritCount();
}

function onCritFoldToggle() {
  if (P.type === 'visit' && $('#ppCritFold').open) {
    setTimeout(jumpVisitItem, 100);
  }
}

function jumpVisitItem() {
  const fy = +$('#ppYear')?.value || fiscalYearOf($('#ppDate')?.value || todayYmd());
  const items = P.critCache.get(fy) || [];
  const it = items.find((x) => x.item_no === VISIT_ITEM) || items.find((x) => String(x.item_no).startsWith('4.5'));
  const box = $('#ppCrit'), el = it && box?.querySelector(`input[value="${it.id}"]`)?.closest('.crit-opt');
  if (!el) return;
  const head = el.previousElementSibling?.classList.contains('crit-pick-h') ? el.previousElementSibling : el;
  box.scrollTop = head.offsetTop - 4;
  el.classList.add('hl');
  setTimeout(() => el.classList.remove('hl'), 2500);
  el.querySelector('input')?.focus({ preventScroll: true });
}

async function onRunAi() {
  const body = $('#ppBody').value.trim(), out = $('#ppAiOut'), btn = $('#ppAiBtn');
  if (body.length < 10) {
    out.innerHTML = '<p class="small ai-err">กรุณาพิมพ์ "รายละเอียด" ด้านบนก่อน (อย่างน้อย 10 ตัวอักษร) แล้วจึงกดให้ AI วิเคราะห์</p>';
    $('#ppBody').focus();
    return;
  }
  const text = achText($('#ppTitle').value, body);
  busy(btn, true, 'AI กำลังวิเคราะห์…');
  out.innerHTML = `<p class="small muted">${SPIN}AI กำลังเทียบกับหัวข้อมาตรฐานทุกข้อ กรุณารอสักครู่ (ประมาณ 10–30 วินาที)</p>`;
  try {
    const { data: id, error } = await sb.rpc('ai_match_start', { p_text: text });
    if (error) throw error;
    P.formAi = { id, text };
    let r = await pollAi(id);
    for (let i = 0; r.status === 'pending' && i < 48; i++) {
      await new Promise((ok) => setTimeout(ok, 2500));
      r = await pollAi(id);
    }
    if (P.formAi?.id === id) showFormAi(r);
  } catch (err) {
    out.innerHTML = `<p class="small ai-err">${esc(errText(err))}</p>`;
  } finally {
    busy(btn, false);
  }
}

function showFormAi(r) {
  const out = $('#ppAiOut');
  if (r.status === 'pending') {
    out.innerHTML = '<p class="small muted">AI ยังวิเคราะห์ไม่เสร็จ · บันทึกผลงานได้เลย ผลจะขึ้นในรายการผลงานด้านล่าง</p>';
    return;
  }
  if (r.status === 'error') {
    out.innerHTML = `<p class="small ai-err">${esc(r.note || 'AI วิเคราะห์ไม่สำเร็จ')}</p>`;
    return;
  }
  if (!r.matches.length) {
    out.innerHTML = '<p class="small">AI ไม่พบข้อมาตรฐานที่ตรงกับรายละเอียดนี้ชัดเจน · เลือกเองได้จากรายการด้านล่าง</p>';
    return;
  }
  r.matches.forEach((m) => P.critPicked.add(m.item_id));
  $('#ppCritQ').value = '';
  renderCrit();
  $('#ppCritFold').open = true;
  out.innerHTML = `<p class="small"><b>AI แนะนำ ${r.matches.length} ข้อ — ติ๊กให้แล้วในรายการด้านล่าง</b> ตรวจดู/แก้ได้ก่อนกดบันทึก</p><ul class="ai-list">`
    + r.matches.map((m) => `<li><b>ข้อ ${esc(m.item_no)}</b> ${esc(m.reason)}</li>`).join('') + '</ul>';
}

/* ================== ผู้ร่วมลง & เชื่อมโยงเยี่ยมบ้าน ================== */

function renderPeople() {
  if (!P?.people) return;
  const tab = P.ptab || 'all', inTab = (p) => tab === 'all' || (tab === 'admin' ? p.role === 'admin' : p.role !== 'admin' && String(p.unit_id) === tab);
  const n = (f) => P.people.filter(f).length;
  $('#ppPeopleTabs').innerHTML = [['all', 'ทั้งหมด', P.people.length], ['admin', 'ผู้ดูแล (โรงพยาบาล)', n((p) => p.role === 'admin')],
    ...(P.units || []).map((u) => [String(u.id), `รพ.สต.${u.name}`, n((p) => p.role !== 'admin' && p.unit_id === u.id)])]
    .map(([k, l, c]) => `<button type="button" data-pt="${k}" aria-current="${tab === k}">${esc(l)} (${c})</button>`).join('');
  const q = $('#ppPeopleQ').value.trim().toLowerCase();
  const list = P.people.filter((p) => inTab(p) && (!q || p.full_name.toLowerCase().includes(q)));
  const group = (p) => (p.role === 'admin' ? 'ผู้ดูแล (โรงพยาบาล)' : `รพ.สต.${unitName(p.unit_id)}`);
  let lastG = null;
  $('#ppPeople').innerHTML = list.map((p) => {
    const val = p.id || `n:${pendingKey(p)}`, g = group(p);
    const head = g !== lastG ? `<p class="crit-pick-h">${esc(g)}</p>` : '';
    lastG = g;
    const isMe = p.id && auth.profile?.id === p.id;
    return head + `<label class="crit-opt"><input type="checkbox" value="${esc(val)}"${P.pickedPeople.has(p.id) || P.pickedNames.has(pendingKey(p)) ? ' checked' : ''}><span><b>${esc(p.full_name)}</b> <span class="small muted">${p.position ? `(${esc(p.position)})` : ''}${isMe ? ' · ตัวเอง' : ''}${!p.id ? ' (ยังไม่เคยเข้าสู่ระบบ)' : ''}</span></span></label>`;
  }).join('') || `<p class="empty">${P.people.length ? 'ไม่พบชื่อที่ค้นหา' : 'กำลังโหลดรายชื่อ…'}${q ? ' · <button type="button" class="btn btn-o btn-sm" data-new-person>ใช้ชื่อนี้</button>' : ''}</p>`;
}

function onPeopleTabClick(e) {
  const b = e.target.closest('[data-pt]');
  if (!b) return;
  P.ptab = b.dataset.pt;
  renderPeople();
}

function onPeopleClick(e) {
  if (!e.target.closest('[data-new-person]')) return;
  const [first, ...rest] = $('#ppPeopleQ').value.trim().split(/\s+/);
  $('#ppOFirst').value = first || '';
  $('#ppOLast').value = rest.join(' ');
  $('#ppOPos').focus();
}

function onPeopleChange(e) {
  const id = e.target.value;
  if (!id) return;
  const isPending = id.startsWith('n:');
  const key = isPending ? id.slice(2) : id;
  const set = isPending ? P.pickedNames : P.pickedPeople;
  if (e.target.checked) set.add(key); else set.delete(key);
  updatePeopleCounts();
}

function addOtherPerson() {
  const f = $('#ppOFirst').value.trim(), l = $('#ppOLast').value.trim(), pos = $('#ppOPos').value.trim();
  if (!f) return;
  if ((P.otherPeople || []).length >= 20) { toast('กรอกเพิ่มได้ไม่เกิน 20 คน', 'err'); return; }
  const name = `${f}${l ? ' ' + l : ''}${pos ? ` (${pos})` : ''}`;
  if (!P.otherPeople.includes(name)) P.otherPeople.push(name);
  $('#ppOFirst').value = ''; $('#ppOLast').value = ''; $('#ppOPos').value = ''; $('#ppOFirst').focus();
  renderOthers();
  updatePeopleCounts();
}

function renderOthers() {
  $('#ppOthers').innerHTML = (P.otherPeople || []).map((n, i) => `<div class="li"><span>${esc(n)}</span><button type="button" class="btn btn-no btn-sm" data-rm-other="${i}" aria-label="ลบ ${esc(n)}">ลบ</button></div>`).join('');
  updatePeopleCounts();
}

function onOthersClick(e) {
  const b = e.target.closest('[data-rm-other]');
  if (!b) return;
  P.otherPeople.splice(+b.dataset.rmOther, 1);
  renderOthers();
  updatePeopleCounts();
}

function updatePeopleCounts() {
  const sys = (P.people || []).filter((p) => p.id && P.pickedPeople.has(p.id));
  const positions = $('#ppPeopleOn')?.checked ? [...sys.map((p) => p.position || ''), ...[...(P.pickedNames || []), ...(P.otherPeople || [])].map(posOf)] : [];
  const linkedPt = $('#ppVisitOn')?.checked ? new Set([...(P.links || new Map()).values()].map((r) => r.patient_id)).size : 0;
  const rawPt = $('#ppPatientCount')?.value?.trim() || '';
  const manualPt = rawPt !== '' && +rawPt > 0 ? Math.floor(+rawPt) : 0;
  if ($('#ppPatientCount')) {
    $('#ppPatientCount').placeholder = linkedPt > 0 ? `นับจากรายชื่อที่ติ๊ก (${linkedPt} ราย)` : 'กรอกจำนวน หรือเว้นว่างเพื่อนับจากรายชื่อที่ติ๊ก';
  }
  const nPt = manualPt > 0 ? manualPt : linkedPt;
  const counts = countLine(positions, nPt);
  $('#ppCounts').textContent = counts ? `ลงเยี่ยม: ${counts}` : '';
  const names = [...sys.map((p) => p.full_name), ...(P.pickedNames || []), ...(P.otherPeople || [])];
  $('#ppPeopleN').textContent = names.length ? `ร่วมลง ${names.length} คน: ${names.join(', ')}` : '';
}

async function toggleVisitPick() {
  const box = $('#ppVisitPick'), open = box.hidden;
  box.hidden = !open;
  $('#ppVisitBtn').setAttribute('aria-expanded', String(open));
  if (!open) return;
  if (!P.pts) {
    $('#ppVisitRes').innerHTML = '<div class="skeleton"></div>';
    const { data, error } = await sb.from('patients').select('id,unit_id,first_name,last_name').order('first_name');
    if (error) { $('#ppVisitRes').innerHTML = `<p class="empty">${esc(errText(error))}</p>`; return; }
    P.pts = data;
    [...new Set(data.map((p) => p.unit_id))].forEach((u) => audit(u));
  }
  renderVisitPick();
  $('#ppVisitQ').focus();
}

function renderVisitPick() {
  if (!P.pts || $('#ppVisitPick').hidden) return;
  const q = $('#ppVisitQ').value.trim().toLowerCase();
  const list = P.pts.filter((p) => !q || `${p.first_name} ${p.last_name}`.toLowerCase().includes(q)).slice(0, 30);
  $('#ppVisitRes').innerHTML = list.map((p) => {
    const open = P.openPt?.id === p.id;
    return `<button type="button" class="li-btn${open ? ' sel' : ''}" data-vpt="${esc(p.id)}" aria-expanded="${open}"><span class="l"><b>${esc(p.first_name)} ${esc(p.last_name)}</b>`
      + `${auth.profile?.role === 'admin' ? `<span class="small muted">รพ.สต.${esc(unitName(p.unit_id))}</span>` : ''}</span><span aria-hidden="true">${open ? '▾' : '›'}</span></button>`
      + (open ? `<div class="vs-visit-days">${P.openPt.visits.length ? P.openPt.visits.map((v) => {
        const row = esc(JSON.stringify({ id: v.id, visit_date: v.visit_date, unit_id: v.unit_id, patient_id: p.id, name: `${p.first_name} ${p.last_name}` }));
        return `<label class="crit-opt"><input type="checkbox" data-vv="${esc(v.id)}" data-row="${row}"${P.links.has(v.id) ? ' checked' : ''}><span><b>เยี่ยมวันที่ ${esc(thaiDate(v.visit_date))}</b>${v.assessment || v.subjective ? ` <span class="muted">${esc((v.assessment || v.subjective).slice(0, 60))}</span>` : ''}</span></label>`;
      }).join('') : '<p class="small muted">ยังไม่มีบันทึกการเยี่ยมของผู้ป่วยคนนี้</p>'}</div>` : '');
  }).join('') || `<p class="empty">${P.pts.length ? 'ไม่พบชื่อผู้ป่วยที่ค้นหา' : 'ยังไม่มีผู้ป่วยในรายชื่อเยี่ยมบ้าน'}</p>`;
}

async function openPatientVisits(pid) {
  if (P.openPt?.id === pid) { P.openPt = null; renderVisitPick(); return; }
  const p = P.pts.find((x) => String(x.id) === String(pid));
  if (!p) return;
  audit(p.unit_id, p.id);
  const { data } = await sb.from('visits').select('id,visit_date,unit_id,subjective,assessment').eq('patient_id', pid).order('visit_date', { ascending: false });
  P.openPt = { id: pid, visits: data || [] };
  renderVisitPick();
}

function onVisitResClick(e) {
  const b = e.target.closest('[data-vpt]');
  if (b) openPatientVisits(b.dataset.vpt);
}

function onVisitResChange(e) {
  const id = e.target.dataset?.vv;
  if (!id) return;
  if (e.target.checked) P.links.set(id, JSON.parse(e.target.dataset.row));
  else P.links.delete(id);
  renderLinks();
  updatePeopleCounts();
}

function renderLinks() {
  const rows = [...P.links.values()].sort((a, b) => String(b.visit_date).localeCompare(String(a.visit_date)));
  $('#ppVisits').innerHTML = rows.map((r) => `<div class="li"><span><b>${esc(r.name)}</b> <span class="small muted">· เยี่ยมวันที่ ${esc(thaiDate(r.visit_date))}</span></span>`
    + `<button type="button" class="btn btn-no btn-sm" data-rm-link="${esc(r.id)}" aria-label="ยกเลิกเชื่อมโยง ${esc(r.name)}">ลบ</button></div>`).join('');
  $('#ppVisitBtn').textContent = rows.length ? `+ เชื่อมโยงเพิ่ม (ตอนนี้ ${rows.length} รายการ)` : '+ เชื่อมโยงรายการเยี่ยม';
}

function onVisitsClick(e) {
  const b = e.target.closest('[data-rm-link]');
  if (b) {
    P.links.delete(b.dataset.rmLink);
    renderLinks();
    renderVisitPick();
    updatePeopleCounts();
  }
}

/* ================== การบันทึกข้อมูล (Submit) ================== */

async function onSubmit(e) {
  e.preventDefault();
  const msg = $('#ppMsg'), title = $('#ppTitle').value.trim(), dateVal = $('#ppDate').value, unitVal = $('#ppUnit').value;
  const unitId = +unitVal;
  msg.style.color = 'var(--error)';

  if (!title) {
    msg.textContent = P.type === 'visit' ? 'กรุณาใส่หัวข้อ' : 'กรุณากรอกชื่อผลงาน';
    $('#ppTitle').focus();
    return;
  }
  if (unitVal === '' || Number.isNaN(unitId)) {
    msg.textContent = 'กรุณาเลือก รพ.สต.';
    $('#ppUnit').focus();
    return;
  }
  if (!dateVal || !/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
    msg.textContent = P.type === 'visit' ? 'กรุณาใส่วันที่' : 'กรุณาเลือกวันที่ทำ/นำเสนอผลงาน';
    $('#ppDate').focus();
    return;
  }

  await P.imgKit.ready();
  const imgs = P.imgKit.items();

  if (P.type === 'visit' && !imgs.length) {
    msg.textContent = 'กรุณาเลือกภาพสรุปอย่างน้อย 1 ภาพ';
    return;
  }

  msg.textContent = '';
  const btn = $('#ppSubmit');
  busy(btn, true, 'กำลังบันทึก…');

  try {
    if (P.type === 'visit') {
      await saveVisit(title, unitId, dateVal, imgs);
    } else {
      await saveAchievement(title, unitId, dateVal, imgs);
    }
  } catch (err) {
    busy(btn, false);
    msg.textContent = errText(err);
  }
}

async function saveVisit(title, unitId, dateVal, imgs) {
  const btn = $('#ppSubmit');
  const old = P.editing?.type === 'visit' ? P.editing.data : null;
  const oldAch = P.editing?.type === 'achievement' ? P.editing.data : null;
  const done = [];
  const folder = `summaries/${auth.profile?.role === 'staff' ? auth.profile.unit_id : unitId}`;

  try {
    const paths = [];
    for (const x of imgs) {
      if (x.path) { paths.push(x.path); continue; }
      const p = await uploadPublicImage(x.blob, folder);
      done.push(p);
      paths.push(p);
    }

    const rawPt = $('#ppPatientCount')?.value?.trim() || '';
    const manualPt = rawPt !== '' && +rawPt > 0 ? Math.floor(+rawPt) : null;

    const row = {
      unit_id: unitId,
      fiscal_year: +$('#ppYear').value || fiscalYearOf(dateVal),
      title,
      body: $('#ppBody').value.trim(),
      image_path: paths[0],
      gallery: paths.slice(1),
      summary_date: dateVal,
      participant_ids: $('#ppPeopleOn').checked ? [...P.pickedPeople] : [],
      participant_others: $('#ppPeopleOn').checked ? [...new Set([...P.pickedNames, ...P.otherPeople])] : [],
      patient_count: manualPt,
      updated_at: new Date().toISOString(),
    };

    if (!$('#ppVisitOn').checked) P.links = new Map();

    const { data: saved, error } = old
      ? await sb.from('visit_summaries').update(row).eq('id', old.id).select('id')
      : await sb.from('visit_summaries').insert(row).select('id');
    if (error) throw error;

    const sid = saved?.[0]?.id ?? old?.id;
    if (sid) {
      await syncLinks(sid, P.links, P.linksOrig).catch((err) => toast('บันทึกสรุปแล้ว แต่เชื่อมโยงรายการเยี่ยมไม่สำเร็จ: ' + errText(err), 'err'));
      if (oldAch) {
        if (P.critPicked.size) {
          await syncAchievement(sid, row, { achievement_id: oldAch.id }, [...P.critPicked])
            .then(() => sb.from('visit_summaries').update({ achievement_id: oldAch.id }).eq('id', sid))
            .catch((err) => toast('บันทึกสรุปแล้ว แต่บันทึกเป็นผลงานมาตรฐานไม่สำเร็จ: ' + errText(err), 'err'));
        } else {
          await sb.from('achievements').delete().eq('id', oldAch.id);
        }
        if (oldAch.image_path && !paths.includes(oldAch.image_path)) {
          removeFiles('public-images', [oldAch.image_path]);
        }
      } else {
        await syncAchievement(sid, row, old, [...P.critPicked]).catch((err) => toast('บันทึกสรุปแล้ว แต่บันทึกเป็นผลงานมาตรฐานไม่สำเร็จ: ' + errText(err), 'err'));
      }
    }

    if (old) {
      const gone = imgsOf(old).filter((p) => !paths.includes(p));
      if (gone.length) removeFiles('public-images', gone);
    }

    busy(btn, false);
    toast((old || oldAch) ? 'บันทึกการแก้ไขแล้ว' : 'เผยแพร่สรุปผลงานแล้ว — แสดงที่หน้าหลัก › ผลการดำเนินงาน');
    if (P.typeFilter !== 'all' && P.typeFilter !== 'visit') setTypeFilter('all', false);
    resetForm();
    $('#ppFold').open = false;
    await loadCombinedList();
  } catch (err) {
    if (done.length) removeFiles('public-images', done);
    throw err;
  }
}

async function saveAchievement(title, unitId, dateVal, imgs) {
  const btn = $('#ppSubmit');
  const old = P.editing?.type === 'achievement' ? P.editing.data : null;
  const oldSum = P.editing?.type === 'visit' ? P.editing.data : null;
  const targetAchId = old?.id || oldSum?.achievement_id || null;
  let imagePath = null;
  let newUploaded = null;

  if (imgs.length) {
    const first = imgs[0];
    if (first.path) {
      imagePath = first.path;
    } else if (first.blob) {
      imagePath = await uploadPublicImage(first.blob, `achievements/${unitId}`);
      newUploaded = imagePath;
    }
  }

  const row = {
    title,
    work_date: dateVal,
    body: $('#ppBody').value.trim() || null,
    item_ids: [...P.critPicked],
    unit_id: unitId,
    ...(imagePath ? { image_path: imagePath } : {}),
  };
  if (!imagePath && (old?.image_path || oldSum?.image_path)) row.image_path = null;

  try {
    const res = targetAchId
      ? await sb.from('achievements').update(row).eq('id', targetAchId).select()
      : await sb.from('achievements').insert(row).select();
    if (res.error) throw res.error;

    if (oldSum) {
      const { error: delErr } = await sb.from('visit_summaries').delete().eq('id', oldSum.id);
      if (delErr) throw delErr;
      const gone = imgsOf(oldSum).filter((p) => p && p !== imagePath);
      if (gone.length) removeFiles('public-images', gone);
      if (oldSum.file_path) removeFiles('news-files', [oldSum.file_path]);
    }

    if (res.data?.[0]) await aiAfterSave(res.data[0], old, P.formAi);
    if (newUploaded && old?.image_path) removeFiles('public-images', [old.image_path]);

    const linked = critLabel(row.item_ids, [...P.critCache.values()].flat());
    toast(((old || oldSum) ? 'บันทึกการแก้ไขแล้ว' : 'เผยแพร่ผลงานแล้ว') + (linked ? ` · แนบเป็นหลักฐานมาตรฐานข้อ ${linked}` : ''));
    busy(btn, false);
    if (P.typeFilter !== 'all' && P.typeFilter !== 'achievement') setTypeFilter('all', false);
    resetForm();
    $('#ppFold').open = false;
    await loadCombinedList();
  } catch (err) {
    if (newUploaded) removeFiles('public-images', [newUploaded]);
    throw err;
  }
}

/* ================== รายการรวม & การกรอง ================== */

function renderAdminUnitChips() {
  const box = $('#ppUnitFilter');
  if (P.unit !== 'all') {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML = `<button type="button" class="tab-link" data-u="all"${P.unitFilter === 'all' ? ' aria-current="true"' : ''}>โรงพยาบาลควนกาหลง (รวมทุกชื่อ)</button>`
    + (P.units || []).map((u) => `<button type="button" class="tab-link" data-u="${u.id}"${P.unitFilter === u.id ? ' aria-current="true"' : ''}>${esc(u.name)}</button>`).join('');
}

function onUnitFilterClick(e) {
  const b = e.target.closest('[data-u]');
  if (!b) return;
  P.unitFilter = b.dataset.u === 'all' ? 'all' : +b.dataset.u;
  renderAdminUnitChips();
  renderCombinedList();
}

function onTypeFilterClick(e) {
  const b = e.target.closest('[data-pf]');
  if (!b) return;
  setTypeFilter(b.dataset.pf, true);
}

function setTypeFilter(f, rerender = true) {
  P.typeFilter = f || 'all';
  $$('#ppTypeFilter [data-pf]').forEach((btn) => {
    const on = btn.dataset.pf === P.typeFilter;
    if (on) btn.setAttribute('aria-current', 'true');
    else btn.removeAttribute('aria-current');
  });
  if (rerender) renderCombinedList();
}

async function loadCombinedList() {
  $('#ppList').innerHTML = '<div class="skeleton"></div>';
  clearTimeout(P.aiTimer);

  const [sumRes, achRes] = await Promise.all([
    loadSummariesData(P.unit, 'all').catch((err) => { console.error(err); return { data: [], ptCount: new Map(), linkCount: new Map() }; }),
    loadAchievementsData(P.unit, 'all').catch((err) => { console.error(err); return { data: [], aiOf: new Map() }; }),
  ]);

  P.sumList = sumRes.data || [];
  P.ptCount = sumRes.ptCount || new Map();
  P.linkCount = sumRes.linkCount || new Map();
  P.achList = achRes.data || [];
  P.aiOf = achRes.aiOf || new Map();

  renderCombinedList();
}

function renderCombinedList() {
  // กรองตาม รพ.สต. (สำหรับ admin)
  let sums = P.sumList;
  let achs = P.achList;
  if (P.unit === 'all' && P.unitFilter !== 'all') {
    sums = sums.filter((s) => s.unit_id === P.unitFilter);
    achs = achs.filter((a) => a.unit_id === P.unitFilter);
  }

  // รวมรายการเข้าด้วยกัน
  const combined = [
    ...sums.map((s) => ({
      ...s,
      _type: 'visit',
      _date: s.summary_date || String(s.created_at).slice(0, 10),
    })),
    ...achs.map((a) => ({
      ...a,
      _type: 'achievement',
      _date: a.work_date || String(a.created_at).slice(0, 10),
    })),
  ];

  // เรียงจากวันที่ใหม่ไปเก่า
  combined.sort((a, b) => String(b._date).localeCompare(String(a._date)) || String(b.created_at).localeCompare(String(a.created_at)));

  // กรองตามประเภท [ทั้งหมด] [เยี่ยมบ้าน] [ผลงาน]
  const list = combined.filter((item) => {
    if (P.typeFilter === 'all') return true;
    return item._type === P.typeFilter;
  });

  // อัปเดตหัวข้อรายการ
  const titleMap = {
    all: P.unit === 'all' ? (P.unitFilter === 'all' ? 'ผลงานของ รพ.สต. ทุกแห่ง' : `ผลงานของ รพ.สต.${unitName(P.unitFilter)}`) : `ผลงานของ รพ.สต.${unitName(P.unit)}`,
    visit: 'สรุปผลงานเยี่ยมบ้าน',
    achievement: 'ผลงาน',
  };
  $('#ppListTitle').textContent = titleMap[P.typeFilter] || 'ผลงานทั้งหมด';

  if (!list.length) {
    $('#ppList').innerHTML = '<p class="empty">ยังไม่มีโพสต์ผลงาน</p>';
    return;
  }

  const allCrit = [...P.critCache.values()].flat();
  $('#ppList').innerHTML = list.map((item) => {
    if (item._type === 'visit') {
      const ptCount = P.ptCount.get(item.id) || 0;
      const linkCount = P.linkCount.get(item.id) || 0;
      const counts = countLine(positionsOf(item), ptCount);
      const people = peopleOf(item);
      return `<div class="da-poster"><img src="${esc(publicImageUrl(item.image_path))}" alt="" loading="lazy">`
        + `<div class="l"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">`
        + `<b>${esc(item.title)}</b><span class="chip c-rev">เยี่ยมบ้าน</span></div>`
        + `<span class="small muted">วันที่ ${esc(dateOf(item))} · รพ.สต.${esc(unitName(item.unit_id))} · ปีงบประมาณ ${item.fiscal_year} · ${imgsOf(item).length} ภาพ${item.file_path ? ' · มี PDF' : ''}${linkCount ? ` · เชื่อมโยง ${linkCount} รายการเยี่ยม` : ''}</span>`
        + (counts ? `<span class="small">ลงเยี่ยม: ${esc(counts)}</span>` : '')
        + (people ? `<span class="small muted">ผู้ร่วมลง: ${esc(people)}</span>` : '') + '</div>'
        + `<div class="row-btns"><a class="btn btn-o btn-sm" href="#/summary/${item.id}">ดู</a>`
        + `<button type="button" class="btn btn-o btn-sm" data-edit="${item.id}" data-type="visit">แก้ไข</button>`
        + `<button type="button" class="btn btn-no btn-sm" data-del="${item.id}" data-type="visit">ลบ</button></div></div>`;
    } else {
      const cl = critLabel(item.item_ids, allCrit);
      return `<div class="newsrow"><div class="thumb2">${item.image_path ? `<img src="${esc(publicImageUrl(item.image_path))}" alt="" loading="lazy">` : ''}</div>`
        + `<div class="l"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">`
        + `<b>${esc(item.title)}${item.hidden ? ' <span class="chip c-off">ระงับการแสดง</span>' : ''}</b><span class="chip c-ok">ผลงาน</span></div>`
        + `<span class="small muted">${P.unit === 'all' ? 'รพ.สต.' + esc(unitName(item.unit_id)) + ' · ' : ''}${esc(thaiDate(item.work_date || item.created_at))}${cl ? ' · มาตรฐานข้อ ' + esc(cl) : ''}</span></div>`
        + aiStatus(item, P.aiOf)
        + `<div class="row-btns"><a class="btn btn-o btn-sm" href="#/achievement/${esc(item.id)}">ดู</a>`
        + `<button type="button" class="btn btn-o btn-sm" data-edit="${item.id}" data-type="achievement">แก้ไข</button>`
        + `<button type="button" class="btn btn-o btn-sm" data-hide="${item.id}" aria-pressed="${!!item.hidden}">${item.hidden ? 'แสดงอีกครั้ง' : 'ระงับการแสดง'}</button>`
        + `<button type="button" class="btn btn-no btn-sm" data-del="${item.id}" data-type="achievement">ลบ</button></div></div>`;
    }
  }).join('');

  // AI polling if pending
  if ([...P.aiOf.values()].some((m) => m.status === 'pending')) {
    P.aiTimer = setTimeout(pollListAi, 3000);
  }
}

async function pollListAi() {
  if (!P?.slot?.isConnected || P.slot.closest('[hidden]')) return;
  for (const [aid, m] of P.aiOf) {
    if (m.status === 'pending') {
      try {
        P.aiOf.set(aid, { ...m, ...await pollAi(m.id) });
      } catch { /* ลองรอบหน้า */ }
    }
  }
  renderCombinedList();
}

/* ================== จัดการรายการ (แก้ไข / ลบ / ซ่อน / AI) ================== */

async function onListClick(e) {
  const ed = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-del]');
  const hd = e.target.closest('[data-hide]');
  const ar = e.target.closest('[data-ai-run]');
  const ap = e.target.closest('[data-ai-apply]');

  if (ed) {
    const id = ed.dataset.edit;
    const type = ed.dataset.type || (P.sumList.some((s) => String(s.id) === String(id)) ? 'visit' : 'achievement');
    if (type === 'visit') {
      const s = P.sumList.find((x) => String(x.id) === String(id));
      if (!s) return;
      editVisit(s);
    } else {
      const a = P.achList.find((x) => String(x.id) === String(id));
      if (!a) return;
      editAchievement(a);
    }
    return;
  }

  if (del) {
    const id = del.dataset.del;
    const type = del.dataset.type || (P.sumList.some((s) => String(s.id) === String(id)) ? 'visit' : 'achievement');
    if (type === 'visit') {
      const s = P.sumList.find((x) => String(x.id) === String(id));
      if (!s || !confirm(`ลบสรุปผลงาน "${s.title}"? หน้าหลักจะไม่แสดงอีก`)) return;
      busy(del, true, 'กำลังลบ…');
      try {
        await deleteSummaryData(s);
        if (P.editing?.data?.id === s.id) resetForm();
        toast('ลบสรุปผลงานแล้ว');
        await loadCombinedList();
      } catch (err) {
        busy(del, false);
        toast(errText(err), 'err');
      }
    } else {
      const a = P.achList.find((x) => String(x.id) === String(id));
      if (!a || !confirm(`ลบผลงาน "${a.title}" ออกจากหน้าหลัก?`)) return;
      del.disabled = true;
      try {
        await deleteAchievementData(a);
        if (P.editing?.data?.id === a.id) resetForm();
        toast('ลบผลงานแล้ว');
        await loadCombinedList();
      } catch (err) {
        del.disabled = false;
        toast(errText(err), 'err');
      }
    }
    return;
  }

  if (hd) {
    const a = P.achList.find((x) => String(x.id) === String(hd.dataset.hide));
    if (!a) return;
    busy(hd, true, 'กำลังบันทึก…');
    try {
      const newHidden = await toggleHideAchievement(a);
      a.hidden = newHidden;
      toast(a.hidden ? 'ระงับการแสดงแล้ว — หน้าหลักจะไม่แสดงผลงานนี้ (ยังไม่ลบ)' : 'แสดงผลงานอีกครั้งแล้ว');
      renderCombinedList();
    } catch (err) {
      busy(hd, false);
      toast(errText(err), 'err');
    }
    return;
  }

  if (ar) {
    const a = P.achList.find((x) => String(x.id) === String(ar.dataset.aiRun));
    if (!a) return;
    busy(ar, true, 'กำลังส่ง…');
    try {
      const id = await runAchievementAi(a);
      P.aiOf.set(a.id, { id, achievement_id: a.id, status: 'pending', matches: [] });
      renderCombinedList();
    } catch (err) {
      busy(ar, false);
      toast(errText(err), 'err');
    }
    return;
  }

  if (ap) {
    const a = P.achList.find((x) => String(x.id) === String(ap.dataset.aiApply));
    const m = a && P.aiOf.get(a.id);
    if (!m) return;
    busy(ap, true, 'กำลังแนบ…');
    try {
      const ids = await applyAchievementAi(a, m);
      a.item_ids = ids;
      toast(`แนบเป็นหลักฐานมาตรฐานข้อ ${aiNos(m)} แล้ว`);
      renderCombinedList();
    } catch (err) {
      busy(ap, false);
      toast(errText(err), 'err');
    }
    return;
  }
}

function unlockTypeSeg() {
  $$('#ppTypeSeg .pp-seg-btn').forEach((b) => {
    b.disabled = false;
    b.style.pointerEvents = '';
  });
}

function editVisit(s) {
  P.editing = { type: 'visit', data: s };
  unlockTypeSeg();
  setType('visit');

  $('#ppTitle').value = s.title;
  $('#ppUnit').value = String(s.unit_id);
  $('#ppBody').value = s.body || '';
  $('#ppDate').value = s.summary_date || String(s.created_at).slice(0, 10);
  onDateChange();
  $('#ppYear').value = String(s.fiscal_year);
  if ($('#ppPatientCount')) {
    $('#ppPatientCount').value = s.patient_count != null && s.patient_count > 0 ? String(s.patient_count) : '';
  }

  // คนที่ร่วมลง
  const pending = new Set((P.people || []).filter((p) => !p.id).map(pendingKey));
  P.pickedPeople = new Set(s.participant_ids || []);
  P.pickedNames = new Set((s.participant_others || []).filter((n) => pending.has(n)));
  $('#ppPeopleQ').value = '';
  renderPeople();
  P.otherPeople = (s.participant_others || []).filter((n) => !P.pickedNames.has(n));
  renderOthers();

  // รายการเยี่ยม
  P.links = new Map();
  P.linksOrig = new Set();
  const hasPeople = !!((s.participant_ids || []).length || (s.participant_others || []).length);
  $('#ppVisitOn').checked = false;
  $('#ppPeopleOn').checked = hasPeople;
  $('#ppVisitBox').hidden = true;
  $('#ppPeopleBox').hidden = !hasPeople;
  renderLinks();
  updatePeopleCounts();

  // เกณฑ์มาตรฐาน
  P.critPicked.clear();
  if (s.achievement_id) {
    sb.from('achievements').select('item_ids').eq('id', s.achievement_id).maybeSingle().then(({ data: a }) => {
      if (P.editing?.data?.id === s.id && a?.item_ids) {
        P.critPicked = new Set(a.item_ids);
        renderCrit();
      }
    });
  }

  // ดึงรายการเยี่ยมเดิม
  sb.from('summary_visits').select('visit_id').eq('summary_id', s.id).then(async ({ data: ls }) => {
    const rows = await visitRows((ls || []).map((l) => l.visit_id));
    if (P.editing?.data?.id !== s.id) return;
    rows.forEach((r) => audit(r.unit_id, r.patient_id));
    P.links = new Map(rows.map((r) => [r.id, r]));
    P.linksOrig = new Set(P.links.keys());
    if (rows.length) {
      $('#ppVisitOn').checked = true;
      $('#ppVisitBox').hidden = false;
    }
    renderLinks();
    updatePeopleCounts();
  });

  P.imgKit.set(imgsOf(s));
  $('#ppFormTitle').textContent = 'แก้ไขสรุปผลงาน';
  $('#ppSubmit').textContent = 'บันทึกการแก้ไข';
  $('#ppCancel').hidden = false;
  $('#ppFold').open = true;
  $('#ppForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function editAchievement(a) {
  P.editing = { type: 'achievement', data: a };
  unlockTypeSeg();

  // เตรียมค่าเริ่มต้นของช่องเยี่ยมบ้านเผื่อผู้ใช้สลับประเภทเป็น "เยี่ยมบ้าน"
  P.pickedPeople = new Set(auth.profile ? [auth.profile.id] : []);
  P.pickedNames = new Set();
  P.otherPeople = [];
  P.links = new Map();
  P.linksOrig = new Set();
  if ($('#ppPatientCount')) $('#ppPatientCount').value = '';
  $('#ppVisitOn').checked = false;
  $('#ppPeopleOn').checked = false;
  $('#ppVisitBox').hidden = true;
  $('#ppPeopleBox').hidden = true;
  $('#ppVisitPick').hidden = true;
  renderLinks();
  renderPeople();
  renderOthers();
  updatePeopleCounts();

  setType('achievement');

  $('#ppTitle').value = a.title;
  $('#ppBody').value = a.body || '';
  $('#ppDate').value = a.work_date || String(a.created_at).slice(0, 10);
  $('#ppUnit').value = String(a.unit_id ?? '');
  onDateChange();

  P.critPicked.clear();
  (a.item_ids || []).forEach((id) => P.critPicked.add(id));
  $('#ppCritQ').value = '';
  renderCrit();

  P.formAi = null;
  $('#ppAiOut').innerHTML = '';
  P.imgKit.set(a.image_path ? [a.image_path] : []);

  $('#ppFormTitle').textContent = 'แก้ไขผลงาน';
  $('#ppSubmit').textContent = 'บันทึกการแก้ไข';
  $('#ppCancel').hidden = false;
  $('#ppFold').open = true;
  $('#ppForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

