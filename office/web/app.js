// MWA 사무실 화면 — 의존성 없는 바닐라 JS
import { buildStatic, renderDynamic, FLOOR_COLORS } from './building.js';
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = (p, body) => fetch(p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}).then((r) => r.json());

let META = null, SNAP = null, LOGS = [];
let floor = 2, tab = 'detail', view = 'building', area = null;
// 3D 사옥: WebGL 이 되면 기본으로 켜고, 사용자가 2D 를 고르면 기억합니다.
let three = null, use3d = true;
try { use3d = localStorage.getItem('mwa.view3d') !== '0'; } catch { /* 저장소 없음 */ }
const PHASE = { idle: '시작 전', planning: '기획 중', ready: '빌드 승인 대기', building: '빌드 중', paused: '일시정지', done: '완료', error: '오류' };
const ST = { todo: '대기', running: '진행 중', done: '완료', failed: '실패', dev: '개발', test: '테스트', review: '리뷰', skipped: '건너뜀', active: '진행', waiting: '대기' };

// ---------------- 건물 ----------------
function renderBuilding() {
  const ok = SNAP.setup?.ok !== false;
  if (three && use3d) three.render(SNAP.state, floor, ok); else renderDynamic($('#building'), META, SNAP.state, floor, ok);
}

async function init3d() {
  if (three || !use3d) return;
  try {
    const mod = await import('./building3d.js');
    if (!mod.webglAvailable()) throw new Error('WebGL 미지원');
    three = mod.create3D($('#scene3d'), META, { onFloor: (f) => selectFloor(f), onExit: () => renderAll() });
  } catch (e) {
    console.warn('3D 사옥을 켤 수 없어 2D 로 표시합니다:', e.message);
    three = null; use3d = false;
    $('#toggle3d').disabled = true; $('#toggle3d').title = '이 브라우저는 3D(WebGL)를 지원하지 않습니다.';
  }
  renderAll();
}
function set3d(on) {
  use3d = on;
  try { localStorage.setItem('mwa.view3d', on ? '1' : '0'); } catch { /* 저장소 없음 */ }
  if (on && !three) return init3d();
  renderAll();
}

// ---------------- 프로젝트 지도 ----------------
const STC = { done: 'done', dev: 'running', test: 'running', review: 'running', failed: 'failed', todo: '', skipped: '' };
const allTickets = () => SNAP.state.epics.flatMap((e) => e.tickets.map((t) => ({ ...t, epic: e.id })));
const areaOf = (t) => t.area ?? '미상';

/** 이름이 티켓 제목·설명에 등장하는지로 설계 항목의 진행 상태를 추정합니다. */
function itemStatus(words) {
  const ws = words.filter(Boolean).map((w) => String(w).toLowerCase()).filter((w) => w.length > 1);
  const ts = allTickets().filter((t) => ws.some((w) => `${t.title} ${t.desc}`.toLowerCase().includes(w)));
  if (!ts.length) return ['none', '티켓 없음'];
  if (ts.every((t) => t.status === 'done')) return ['done', '완료'];
  if (ts.some((t) => ['dev', 'test', 'review'].includes(t.status))) return ['running', '진행 중'];
  if (ts.some((t) => t.status === 'failed')) return ['failed', '실패'];
  return ['todo', `대기 ${ts.length}`];
}

function renderViewChips() {
  const ts = SNAP ? allTickets() : [];
  const chip = (key, label, on, color, count) => `<button class="vchip ${on ? 'on' : ''}" data-view="${key}" ${color ? `style="--c:${color}"` : ''}>${label}${count != null ? ` <small>${count}</small>` : ''}</button>`;
  $('#viewChips').innerHTML = chip('building', '🏢 건물 전체', view === 'building') + chip('map', '🗺 프로젝트 지도', view === 'map' && !area) + '<span class="sep"></span>' +
    META.areas.map((a) => chip(`area:${a.id}`, a.id, view === 'map' && area === a.id, a.color, ts.filter((t) => areaOf(t) === a.id).length || null)).join('');
}

function renderMap() {
  const s = SNAP.state, ts = allTickets(), bp = s.blueprint ?? { screens: [], apis: [], entities: [] };
  const done = ts.filter((t) => t.status === 'done').length;
  const pct = ts.length ? Math.round((done / ts.length) * 100) : 0;
  const planDone = s.stages.filter((x) => x.status === 'done').length;
  const areas = META.areas.filter((a) => !area || a.id === area);
  const bar = (p, c = 'var(--accent)') => `<div class="bar"><i style="width:${p}%;background:${c}"></i></div>`;
  const tRow = (t) => `<li><span class="st ${STC[t.status] ?? ''} ${t.status}">${ST[t.status] ?? t.status}</span><b>${esc(t.id)}</b> ${esc(t.title)} <small class="muted">${esc(t.epic)}</small></li>`;

  let html = `<div class="pm-head card">
    <div class="row"><h2>${esc(s.idea ? s.idea.split(/[.\n]/)[0].slice(0, 60) : '아직 프로젝트가 없습니다')}</h2><span class="st ${s.phase === 'done' ? 'done' : 'running'}">${PHASE[s.phase] ?? s.phase}</span></div>
    <div class="kpis">
      <div><small>기획 문서</small><b>${planDone}/${s.stages.length}</b>${bar(planDone / s.stages.length * 100, '#14b8a6')}</div>
      <div><small>티켓 완료</small><b>${done}/${ts.length}</b>${bar(pct)}</div>
      <div><small>화면</small><b>${bp.screens.length}</b></div><div><small>API</small><b>${bp.apis.length}</b></div><div><small>데이터 모델</small><b>${bp.entities.length}</b></div>
    </div>
    ${s.epics.length ? `<div class="epics">${s.epics.map((e) => { const d = e.tickets.filter((t) => t.status === 'done').length; return `<div class="ep"><span><b>${e.id}</b> ${esc(e.title)}</span><small>${d}/${e.tickets.length}</small>${bar(e.tickets.length ? d / e.tickets.length * 100 : 0, e.status === 'done' ? '#22c55e' : 'var(--accent)')}</div>`; }).join('')}</div>` : ''}
  </div>`;
  if (!ts.length && !bp.screens.length) html += `<div class="card empty">2F 기획실에 아이디어를 쓰면 기획이 진행되면서 이 지도가 채워집니다. 화면 목록은 UX 단계, API·데이터 모델은 아키텍처 단계, 구역별 티켓은 티켓 트리 단계에서 생깁니다.</div>`;

  // 구역 카드
  html += `<h3 class="pm-sec">구역별 진행</h3><div class="areas">${areas.map((a) => {
    const at = ts.filter((t) => areaOf(t) === a.id), d = at.filter((t) => t.status === 'done').length;
    if (!area && !at.length && a.id === '미상') return '';
    return `<div class="card area" style="--c:${a.color}"><div class="row"><b>${a.id}</b><small class="muted">${a.desc}</small><span class="cnt">${d}/${at.length}</span></div>${bar(at.length ? d / at.length * 100 : 0, a.color)}
      <ul>${at.map(tRow).join('') || '<li class="muted">티켓 없음</li>'}</ul></div>`;
  }).join('')}</div>`;

  // 화면 흐름
  if ((!area || area === '화면') && bp.screens.length) html += `<h3 class="pm-sec">화면 흐름 <small class="muted">UX 문서 기준</small></h3><div class="flow">${bp.screens.map((sc) => {
    const [k, label] = itemStatus([sc.name, sc.route]);
    return `<div class="scr ${k}"><div class="phone"><div class="bar2"></div><b>${esc(sc.name)}</b><code>${esc(sc.route ?? '')}</code><p>${esc(sc.desc ?? '')}</p></div>
      <span class="st ${k}">${label}</span>${(sc.next ?? []).length ? `<small class="muted">→ ${sc.next.map(esc).join(', ')}</small>` : ''}</div>`;
  }).join('')}</div>`;

  // API
  if ((!area || area === '서버' || area === '권한') && bp.apis.length) html += `<h3 class="pm-sec">API <small class="muted">아키텍처 문서 기준</small></h3><div class="card"><table class="api">${bp.apis.filter((a) => area !== '권한' || a.auth || /auth|login/i.test(a.path)).map((a) => {
    const [k, label] = itemStatus([a.path, a.desc]);
    return `<tr><td><span class="m m-${esc(a.method)}">${esc(a.method)}</span></td><td><code>${esc(a.path)}</code></td><td>${esc(a.desc ?? '')}</td><td>${a.auth ? '🔒' : ''}</td><td><span class="st ${k}">${label}</span></td></tr>`;
  }).join('')}</table></div>`;

  // 데이터 모델
  if ((!area || area === '데이터') && bp.entities.length) html += `<h3 class="pm-sec">데이터 모델</h3><div class="ents">${bp.entities.map((en) => {
    const [k, label] = itemStatus([en.name]);
    return `<div class="ent ${k}"><div class="row"><b>${esc(en.name)}</b><span class="st ${k}">${label}</span></div><ul>${(en.fields ?? []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>`;
  }).join('')}</div>`;

  $('#projectMap').innerHTML = html;
}

// ---------------- 패널 ----------------
function selectFloor(f) {
  floor = f;
  if (view === 'map') { view = 'building'; area = null; }
  if (three && use3d) three.enter(f);
  renderAll();
}
function renderFloorNav() {
  const s = SNAP.state;
  $('#floorNav').innerHTML = [...META.floors].reverse().map((f) => `<button class="${f.floor === floor ? 'on' : ''}" data-f="${f.floor}">
    <span class="badge" style="background:${FLOOR_COLORS[f.floor]}">${f.floor}F</span>${esc(f.name)}<span class="dot ${s.activity?.floor === f.floor && s.activity?.role ? 'live' : ''}"></span></button>`).join('');
  $('#floorNav').querySelectorAll('button').forEach((b) => b.onclick = () => selectFloor(Number(b.dataset.f)));
}

function renderTop() {
  const s = SNAP.state, l = SNAP.ledger;
  const act = s.activity?.role ? `${s.activity.floor}F ${META.roles[s.activity.role]?.name}: ${s.activity.label}` : s.activity?.label;
  const hint = s.phase === 'idle' ? '아직 빌드 전입니다 — 2F 기획실에 만들고 싶은 것을 한 단락 써 주세요.' : act;
  $('#status').textContent = `● ${PHASE[s.phase] ?? s.phase} · ${hint ?? ''}${l.counts.humanTurns ? ` · 대표 차례 ${l.counts.humanTurns}건` : ''}`;
  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === s.mode));
  $('#pauseBtn').textContent = s.phase === 'paused' ? '재개' : '일시정지';
  $('#pauseBtn').disabled = !['planning', 'building', 'paused'].includes(s.phase);
  $('#cost').textContent = s.costUsd ? `누적 $${s.costUsd.toFixed(2)}` : '';
  const real = SNAP.meta.engine === 'claude';
  $('#engineBtn').textContent = real ? '엔진: 실제 개발(Claude)' : '엔진: 시연(mock)';
  $('#engineBtn').classList.toggle('warn', !real); $('#engineBtn').dataset.engine = real ? 'mock' : 'claude';
  $('#engineBtn').title = real ? '누르면 시연(mock) 엔진으로 바꿉니다' : '누르면 실제 개발(Claude) 엔진으로 바꿉니다';
  $('#mockBar').classList.toggle('hidden', real);
}

function stageList() {
  const s = SNAP.state;
  return `<ul class="stages">${META.stages.map((d) => {
    const st = s.stages.find((x) => x.id === d.id) ?? {};
    return `<li><span class="st ${st.status}">${ST[st.status] ?? st.status}</span>${esc(d.title)} <span class="muted">· ${esc(META.roles[d.role].name)}</span>
      ${st.verdict ? `<span class="st ${st.verdict}">${esc(st.verdict)}</span>` : ''}
      ${st.status === 'done' ? `<button class="link" data-doc="${esc(d.doc)}">문서</button>` : ''}
      ${st.status === 'failed' ? `<button class="btn small" data-retry="stage:${d.id}">재시도</button>` : ''}</li>`;
  }).join('')}</ul>`;
}

function board() {
  const all = SNAP.state.epics.flatMap((e) => e.tickets.map((t) => ({ ...t, epic: e.id })));
  const cols = [['todo', '대기'], ['dev', '개발'], ['test', '테스트'], ['review', '리뷰'], ['done', 'main']];
  return `<div class="board">${cols.map(([k, n]) => `<div class="col"><h4>${n}</h4>${all.filter((t) => t.status === k || (k === 'todo' && ['failed', 'skipped'].includes(t.status)))
    .map((t) => `<div class="ticket" title="${esc(t.desc)}"><b>${esc(t.id)}</b> ${esc(t.title)} ${t.status === 'failed' ? '<span class="st failed">실패</span>' : ''}${t.status === 'skipped' ? '<span class="st">건너뜀</span>' : ''}</div>`).join('')}</div>`).join('')}</div>`;
}

function setupCard() {
  const r = SNAP.setup;
  if (!r) return '';
  const ago = Math.max(0, Math.round((Date.now() - new Date(r.checkedAt)) / 60000));
  return `<div class="setup ${r.ok ? 'pass' : 'fail'}"><div class="row"><b>설치 점검</b><span class="st ${r.ok ? 'done' : 'failed'}">${r.ok ? '통과' : '필수 항목 누락'}</span>
    <small class="muted">${ago}분 전</small><button class="btn small" data-setup="1">다시 보기</button></div>
    <ul>${r.items.map((i) => `<li><span class="${i.ok ? 'ok-mark' : i.required ? 'no-mark' : 'warn-mark'}">${i.ok ? '●' : i.required ? '✕' : '!'}</span> ${esc(i.label)} <span class="muted">${esc(i.detail)}</span>
      ${!i.ok && i.fix ? `<code class="fix">${esc(i.fix)}</code>` : ''}</li>`).join('')}</ul>
    ${r.ok ? '' : '<p class="muted" style="margin:6px 0 0">필수 항목(✕)을 Ubuntu 터미널에서 고친 뒤 "다시 보기"를 누르세요. 빌드는 통과할 때까지 시작되지 않습니다.</p>'}</div>`;
}

function renderFloorInfo() {
  const s = SNAP.state, f = META.floors.find((x) => x.floor === floor);
  let body = '';
  if (floor === 1) body = `<p class="muted">프로젝트 폴더: <code>${esc(SNAP.meta.projectDir)}</code></p>
    <p>${s.idea ? `<b>아이디어</b><br>${esc(s.idea)}` : '아직 아이디어가 없습니다. 2F 기획실에서 시작하세요.'}</p>`;
  if (floor === 1) body += setupCard();
  if (floor === 2) body = stageList();
  if (floor === 3) body = s.epics.length ? `${s.epics.map((e) => `<div class="row"><span><b>${e.id}</b> ${esc(e.title)}</span><span class="st ${e.status}">${ST[e.status] ?? e.status}</span></div>`).join('')}<div style="height:8px"></div>${board()}` : '<p class="muted">티켓은 2F 기획이 끝나면 생깁니다.</p>';
  if (floor === 4) {
    const t = s.epics.flatMap((e) => e.tickets).find((x) => ['dev', 'test', 'review'].includes(x.status));
    const last = s.epics.flatMap((e) => e.tickets).filter((x) => x.lastTest).at(-1);
    body = t ? `<p><b>${esc(t.id)} ${esc(t.title)}</b> <span class="st ${t.status}">${ST[t.status]}</span> · ${t.attempts}회차</p><p class="muted">${esc(t.desc)}</p>` : '<p class="muted">지금 구현 중인 티켓이 없습니다.</p>';
    if (last) body += `<details><summary>최근 테스트 출력 (${esc(last.id)} ${last.lastTest.ok ? '통과' : '실패'})</summary><pre class="doc">${esc(last.lastTest.tail)}</pre></details>`;
    body += `<p class="muted">테스트 명령: <code>${esc(s.testCommand || '미정')}</code></p>`;
  }
  $('#floorInfo').innerHTML = `<div class="card"><h3>${floor}F ${esc(f.name)}</h3><p class="muted" style="margin:0 0 8px">${esc(f.desc)}</p>${body}</div>`;
  $('#msgLabel').textContent = `메시지 — ${f.name}`;
  const planning = s.phase === 'planning' || (s.phase === 'paused' && s.resumePhase === 'planning');
  $('#msg').placeholder = s.phase === 'idle' ? '만들고 싶은 것을 한 단락으로 써 주세요. 보내면 바로 2F 기획을 시작합니다. (외주 공고를 그대로 붙여 넣어도 됩니다)'
    : planning ? '기획 지시를 쓰면 다음 기획 단계부터 반영합니다.'
      : s.phase === 'done' ? '추가·수정할 내용을 쓰면 새 티켓으로 만들어 바로 다시 작업합니다.'
        : '변경 요청을 쓰면 새 티켓으로 만들어 작업합니다. (진행 중인 티켓이 끝난 뒤 반영)';
}

/** 직원 답변용 간단한 마크다운(굵게·코드·목록·문단) */
function md(text) {
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = []; let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^#{1,4}\s+(.*)/))) { close(); out.push(`<p><b>${inline(m[1])}</b></p>`); }
    else if (!line.trim()) close();
    else { close(); out.push(`<p>${inline(line)}</p>`); }
  }
  close();
  return out.join('');
}

function renderFeed() {
  const s = SNAP.state;
  const conv = s.messages.filter((m) => m.floor === floor);
  const items = [
    ...conv.map((m) => {
      const ceo = !m.from || m.from === 'ceo';
      const who = ceo ? '대표(당신)' : META.roles[m.from]?.name ?? m.from;
      return { ts: m.ts, html: ceo ? `<div class="msg ceo"><span class="who">${who}</span>${esc(m.text)}</div>`
        : `<div class="msg staff" style="--c:${META.roles[m.from]?.color ?? '#888'}"><span class="who">${esc(who)}</span><div class="md">${md(m.text)}</div></div>` };
    }),
    // 작업 소식(에이전트 도구 로그 제외): 접수·완료 같은 짧은 알림만 대화 사이에 보여 줍니다.
    ...LOGS.filter((l) => l.floor === floor && l.role !== 'ceo' && !l.agent).slice(-30).map((l) => ({ ts: l.ts, html: `<div class="note ${l.level ?? ''}">${esc(l.text)}</div>` })),
  ].sort((a, b) => a.ts.localeCompare(b.ts)).slice(-80);
  const pending = s.chatPending?.[floor];
  if (pending) items.push({ html: `<div class="msg staff typing" style="--c:${META.roles[pending]?.color ?? '#888'}"><span class="who">${esc(META.roles[pending]?.name ?? '')}</span><span class="dots"><i></i><i></i><i></i></span> 답변을 쓰고 있습니다</div>` });
  $('#chatCount').textContent = conv.length ? `${conv.length}개` : '';
  const el = $('#feed');
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  const html = items.map((i) => i.html).join('') || '<p class="muted">아직 대화가 없습니다. 아래 메시지 칸에 쓰고 보내기를 누르면 담당 직원이 답합니다.</p>';
  if (el._html === html && el.dataset.floor === String(floor)) return; // 바뀐 게 없으면 다시 그리지 않아 스크롤이 튀지 않습니다
  const floorChanged = el.dataset.floor !== String(floor);
  el._html = html; el.dataset.floor = floor;
  el.innerHTML = html;
  if (atBottom || floorChanged || pending) el.scrollTop = el.scrollHeight;
}

function humanTurn(h) {
  const s = SNAP.state;
  if (h.kind === 'question') {
    const q = s.questions.find((x) => x.id === h.id);
    return `<div class="turn"><div><b>${esc(q.id)}</b> ${esc(q.q)}</div>${q.why ? `<small class="muted">추천 이유: ${esc(q.why)}</small>` : ''}
      <div class="opts">${q.options.map((o, i) => `<button class="btn small ${i === q.recommended ? 'primary' : ''}" data-answer="${esc(q.id)}" data-val="${esc(o)}">${esc(o)}${i === q.recommended ? ' (추천)' : ''}</button>`).join('')}
      <button class="btn small ghost" data-answer-free="${esc(q.id)}">메시지 칸 내용으로 답하기</button></div></div>`;
  }
  if (h.kind === 'approval') return `<div class="turn"><div>${esc(h.text)}</div><div class="opts"><button class="btn small primary" data-approve="${esc(h.id)}">승인</button>
    ${s.approvals.find((a) => a.id === h.id)?.kind === 'stage' ? `<button class="btn small" data-redo="${esc(h.id)}">재작성(메시지 칸 내용을 지시로)</button>` : ''}</div></div>`;
  if (h.kind === 'ticket-failed') return `<div class="turn"><div>${esc(h.text)}</div><div class="opts"><button class="btn small primary" data-retry="ticket:${esc(h.id)}">재시도</button><button class="btn small" data-skip="${esc(h.id)}">건너뛰기</button></div></div>`;
  if (h.kind === 'setup') return `<div class="turn"><div>${esc(h.text)}</div><div class="opts"><button class="btn small primary" data-setup="1">다시 점검</button><button class="btn small" data-goto="1">1F 설치 점검 보기</button></div></div>`;
  if (h.kind === 'stage-failed') return `<div class="turn"><div>${esc(h.text)}</div><div class="opts"><button class="btn small primary" data-retry="stage:${esc(h.id)}">재시도</button></div></div>`;
  return '';
}

function renderLedger() {
  const l = SNAP.ledger, s = SNAP.state;
  const ago = Math.max(0, Math.round((Date.now() - new Date(l.checkedAt)) / 1000));
  $('#ledger').innerHTML = `<div class="card ledger"><h3>공백 장부 · 프로젝트 전체 <small class="muted">${ago}초 전 점검</small><button class="btn small" id="recheck">다시 점검</button></h3>
    <p class="muted" style="margin:0 0 8px">${s.mode === 'auto' ? '자동 모드: 질문은 추천안으로 정하고 계속 진행합니다. 결정은 나중에 바꿀 수 있습니다.' : '수동 모드: 단계마다 승인을 받은 뒤 진행합니다.'}</p>
    <div class="cols">
      <div><h4>① 꼭 채울 것 (${l.counts.mustFill})</h4><ul>${l.mustFill.map((m) => `<li><span class="${m.ok ? 'ok-mark' : 'no-mark'}">${m.ok ? '●' : '○'}</span> ${esc(m.label)} <span class="muted">${esc(m.detail)}</span></li>`).join('')}</ul></div>
      <div><h4>② 확인 안 된 가정 (${l.counts.assumptions})</h4><ul>${l.assumptions.map((a) => `<li>${esc(a.text)} <span class="muted">(${esc(a.source)})</span> <button class="link" data-assume="${esc(a.id)}" data-ok="1">맞음</button> <button class="link" data-assume="${esc(a.id)}" data-ok="0">틀림</button></li>`).join('') || '<li class="muted">없음</li>'}</ul></div>
      <div><h4>③ 예정된 사람 차례 (${l.counts.humanTurns})</h4>${l.humanTurns.map(humanTurn).join('') || '<p class="muted" style="margin:0">지금은 대표가 할 일이 없습니다.</p>'}</div>
    </div></div>`;
}

function renderProgress() {
  const s = SNAP.state;
  const qs = s.questions.slice().reverse();
  $('#tab-progress').innerHTML = `
    <div class="card"><h3>기획 (2F)</h3>${stageList()}</div>
    <div class="card"><h3>빌드 (3F · 4F)</h3>${s.epics.length ? s.epics.map((e) => `<div style="margin-bottom:8px"><div class="row"><b>${e.id} ${esc(e.title)}</b><span class="st ${e.status}">${ST[e.status] ?? e.status}</span></div>
      ${e.tickets.map((t) => `<div class="row" style="font-size:12.5px"><span>${esc(t.id)} ${esc(t.title)}</span><span class="st ${t.status}">${ST[t.status] ?? t.status}${t.attempts > 1 ? ` ×${t.attempts}` : ''}</span></div>`).join('')}</div>`).join('') : '<p class="muted">아직 티켓이 없습니다.</p>'}</div>
    <div class="card"><h3>결정 기록</h3>${qs.length ? qs.map((q) => `<div style="margin-bottom:8px;font-size:12.5px"><b>${esc(q.id)}</b> ${esc(q.q)}<br>
      ${q.status === 'open' ? '<span class="st open">답 대기</span>' : `→ <b>${esc(q.answer)}</b> <span class="muted">${q.status === 'auto' ? '(자동·추천안)' : '(대표 결정)'}</span>`}
      <div class="opts" style="margin-top:4px">${q.options.map((o) => `<button class="btn small" data-answer="${esc(q.id)}" data-val="${esc(o)}">${esc(o)}</button>`).join(' ')}</div></div>`).join('') : '<p class="muted">아직 결정할 사항이 없습니다.</p>'}</div>`;
}

function renderLog() {
  const f = $('#logFloor').value;
  const el = $('#logList');
  el.innerHTML = LOGS.filter((l) => !f || String(l.floor) === f).slice(-300).map((l) => `<div><span class="t">${l.ts.slice(11, 19)}${l.floor ? ` ${l.floor}F` : ''}</span>${esc(l.text)}</div>`).join('');
  el.parentElement.scrollTop = el.parentElement.scrollHeight;
}

function renderInspect() {
  const sel = $('#docSel'), cur = sel.value;
  const docs = [...SNAP.state.stages.map((s) => s.doc), 'AGENTS.md', 'CLAUDE.md', ...SNAP.state.epics.flatMap((e) => [`_bmad-output/implementation-artifacts/${e.id}.md`, `_bmad-output/implementation-artifacts/${e.id}-retro.md`])];
  sel.innerHTML = docs.map((d) => `<option ${d === cur ? 'selected' : ''}>${esc(d)}</option>`).join('');
  $('#rawState').textContent = JSON.stringify(SNAP.state, null, 2);
}

async function openDoc(p) {
  tab = 'inspect'; showTab();
  $('#docSel').value = p;
  const r = await api(`/api/doc?path=${encodeURIComponent(p)}`);
  $('#docView').textContent = r.text ?? '아직 없는 문서입니다.';
}

function showTab() {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== `tab-${tab}`));
  renderAll();
}

function renderAll() {
  if (!SNAP || !META) return;
  renderTop(); renderViewChips(); renderFloorNav(); renderBuilding();
  const isMap = view === 'map', is3d = !!(three && use3d);
  $('#building').classList.toggle('hidden', isMap || is3d); $('#scene3d').classList.toggle('hidden', isMap || !is3d);
  $('#floorNav').classList.toggle('hidden', isMap); $('#view3dBar').classList.toggle('hidden', isMap);
  $('#toggle3d').textContent = is3d ? '2D로 보기' : '3D 사옥 보기';
  $('#exitFloor').hidden = !(is3d && three.entered);
  document.querySelector('.hint3d').hidden = !is3d;
  document.querySelector('.flow-label').classList.toggle('hidden', isMap); $('#projectMap').classList.toggle('hidden', !isMap);
  if (isMap) renderMap();
  if (tab === 'detail') { renderFloorInfo(); renderFeed(); renderLedger(); }
  if (tab === 'progress') renderProgress();
  if (tab === 'log') renderLog();
  if (tab === 'inspect') renderInspect();
}

// ---------------- 이벤트 ----------------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  const d = t.dataset, msg = $('#msg');
  if (d.view) {
    if (d.view.startsWith('area:')) { view = 'map'; area = d.view.slice(5); } else { view = d.view; area = null; }
    if (d.view === 'building' && three?.entered) three.exit(); else renderAll();
  }
  else if (d.tab) { tab = d.tab; showTab(); }
  else if (d.mode) await api('/api/mode', { mode: d.mode });
  else if (d.engine) {
    if (d.engine === 'mock' && !window.confirm('시연(mock) 엔진으로 바꾸면 실제 개발을 하지 않습니다. 바꿀까요?')) return;
    const r = await api('/api/engine', { engine: d.engine });
    if (!r.ok) window.alert(r.error ?? '엔진을 바꾸지 못했습니다.');
  }
  else if (d.answer) await api('/api/answer', { id: d.answer, answer: d.val });
  else if (d.answerFree) { if (!msg.value.trim()) return msg.focus(); await api('/api/answer', { id: d.answerFree, answer: msg.value.trim() }); msg.value = ''; }
  else if (d.approve) await api('/api/approve', { id: d.approve, action: 'approve' });
  else if (d.redo) { await api('/api/approve', { id: d.redo, action: 'redo', note: msg.value.trim() }); msg.value = ''; }
  else if (d.retry) { const [kind, id] = d.retry.split(':'); await api('/api/retry', { kind, id }); }
  else if (d.skip) await api('/api/skip', { id: d.skip });
  else if (d.assume) await api('/api/assumption', { id: d.assume, ok: d.ok === '1' });
  else if (d.doc) openDoc(d.doc);
  else if (d.setup) { t.disabled = true; t.textContent = '점검 중…'; SNAP.setup = await api('/api/setup', {}); renderAll(); }
  else if (d.goto) selectFloor(Number(d.goto));
  else if (t.id === 'recheck') { SNAP.ledger = await api('/api/recheck', {}); renderAll(); }
});
$('#toggle3d').onclick = () => set3d(!(three && use3d));
$('#exitFloor').onclick = () => three?.exit();
$('#pauseBtn').onclick = () => api(SNAP.state.phase === 'paused' ? '/api/resume' : '/api/pause', {});
$('#docOpen').onclick = () => openDoc($('#docSel').value);
$('#logFloor').onchange = renderLog;
const send = async () => { const text = $('#msg').value.trim(); if (!text) return; $('#msg').value = ''; await api('/api/message', { floor, text }); };
$('#sendBtn').onclick = send;
$('#msg').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });

(async () => {
  META = await api('/api/meta');
  LOGS = await api('/api/logs');
  buildStatic($('#building'), META, selectFloor);
  $('#building').addEventListener('floor', (e) => selectFloor(e.detail));
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => { SNAP = JSON.parse(e.data); renderAll(); });
  es.addEventListener('log', (e) => { LOGS.push(JSON.parse(e.data)); if (LOGS.length > 600) LOGS.shift(); if (tab === 'detail') renderFeed(); if (tab === 'log') renderLog(); });
  init3d();
  es.onerror = () => { $('#status').textContent = '서버와 연결이 끊겼습니다. 터미널에서 mwa up 이 켜져 있는지 확인하세요.'; };
})();
