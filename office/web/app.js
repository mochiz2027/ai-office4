// MWA 사무실 화면 — 의존성 없는 바닐라 JS
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = (p, body) => fetch(p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}).then((r) => r.json());

let META = null, SNAP = null, LOGS = [];
let floor = 2, tab = 'detail';
const FLOOR_COLORS = { 1: '#f59e0b', 2: '#14b8a6', 3: '#6366f1', 4: '#3b82f6' };
const PHASE = { idle: '시작 전', planning: '기획 중', ready: '빌드 승인 대기', building: '빌드 중', paused: '일시정지', done: '완료', error: '오류' };
const ST = { todo: '대기', running: '진행 중', done: '완료', failed: '실패', dev: '개발', test: '테스트', review: '리뷰', skipped: '건너뜀', active: '진행', waiting: '대기' };

// ---------------- 건물(아이소메트릭 SVG) ----------------
const S = 26, TILT = 0.42, W = 12, D = 6, H = 5;
const P = (x, y, z) => [(x - y) * 0.866 * S, (x + y) * TILT * S - z * S];
const pts = (...a) => a.map((p) => P(...p).map((n) => n.toFixed(1)).join(',')).join(' ');
const poly = (cls, ...a) => `<polygon class="${cls}" points="${pts(...a)}"/>`;
function box(x0, y0, z0, w, d, h, top = 'desk-top', side = 'desk') {
  const x1 = x0 + w, y1 = y0 + d, z1 = z0 + h;
  return poly(side, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]) +
    poly(side, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]) +
    poly(top, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
}
const seat = (role, i, n) => ({ x: 1.6 + (i + 0.5) * ((W - 2.4) / n), y: D - 1.5 });

function buildStatic() {
  const svg = $('#building');
  let html = '';
  for (const f of META.floors) {
    const z = (f.floor - 1) * H;
    html += `<g class="floor-g" data-floor="${f.floor}">`;
    html += poly('wall', [0, 0, z], [0, D, z], [0, D, z + H], [0, 0, z + H]);
    html += poly('wall2', [0, 0, z], [W, 0, z], [W, 0, z + H], [0, 0, z + H]);
    html += poly('slab', [0, 0, z], [W, 0, z], [W, D, z], [0, D, z]);
    html += poly('slab-edge', [W, 0, z], [W, D, z], [W, D, z - 0.25], [W, 0, z - 0.25]);
    html += poly('slab-edge', [0, D, z], [W, D, z], [W, D, z - 0.25], [0, D, z - 0.25]);
    html += `<polygon points="${pts([0, D, z], [W, D, z], [W, D, z - 0.25], [0, D, z - 0.25])}" fill="${FLOOR_COLORS[f.floor]}" opacity=".55"/>`;
    // 층별 소품
    const roles = f.roles;
    roles.forEach((r, i) => { const s = seat(r, i, roles.length); html += box(s.x - 0.7, s.y - 1.5, z, 1.4, 0.8, 0.9); });
    if (f.floor === 1) html += box(1, 1, z, 3, 1, 1.1) + box(W - 3, 0.6, z, 2, 0.6, 2.2); // 접수대, 책장
    if (f.floor === 4) roles.forEach((r, i) => { const s = seat(r, i, roles.length); html += box(s.x - 0.4, s.y - 1.45, z + 0.9, 0.8, 0.1, 0.6, 'glass', 'desk'); });
    html += `<g id="dyn-${f.floor}"></g>`;
    // 층 라벨
    const [lx, ly] = P(0, D, z + H * 0.3);
    html += `<g class="flabel" transform="translate(${lx - 250},${ly - 22})"><rect width="190" height="44" rx="10"/><circle cx="20" cy="22" r="11" fill="${FLOOR_COLORS[f.floor]}"/><text x="20" y="22" fill="#fff" font-size="9" font-weight="700" text-anchor="middle" dominant-baseline="central">${f.floor}F</text><text class="t" x="38" y="18">${esc(f.name)}</text><text class="d" x="38" y="33">${esc(f.desc)}</text></g>`;
    html += `</g>`;
  }
  // 엘리베이터 샤프트
  const top = META.floors.length * H + 0.4;
  html += `<g>${poly('glass', [W + 0.3, 0, 0], [W + 0.3, 2.2, 0], [W + 0.3, 2.2, top], [W + 0.3, 0, top])}`;
  html += `<g id="car" class="car">${box(W + 0.5, 0.4, 0.05, 1.6, 1.4, 2.6, 'car', 'car')}</g>`;
  html += `${poly('glass', [W + 0.3, 2.2, 0], [W + 2.5, 2.2, 0], [W + 2.5, 2.2, top], [W + 0.3, 2.2, top])}</g>`;
  svg.innerHTML = html;
  const [a] = P(0, D, 0), [b] = P(W + 2.5, 0, 0), [, t] = P(0, 0, top), [, bt] = P(W, D, 0);
  svg.setAttribute('viewBox', `${a - 270} ${t - 60} ${b - a + 300} ${bt - t + 90}`);
  svg.querySelectorAll('.floor-g').forEach((g) => g.addEventListener('click', () => selectFloor(Number(g.dataset.floor))));
}

let dynKey = '';
function renderBuilding() {
  const s = SNAP.state, act = s.activity ?? {};
  const key = JSON.stringify([act, s.stages.map((x) => x.status), s.epics.map((e) => e.tickets.map((t) => t.status)), s.approvals.length]);
  if (key === dynKey) return; dynKey = key;
  for (const f of META.floors) {
    const z = (f.floor - 1) * H;
    let html = '';
    if (f.floor === 2) { // 화이트보드: 기획 단계 진행
      s.stages.forEach((st, i) => {
        const c = st.status === 'done' ? '#22c55e' : st.status === 'running' ? '#14b8a6' : st.status === 'failed' ? '#ef4444' : '#cbd5e1';
        const y = 0.5 + i * 0.72;
        html += `<polygon points="${pts([0.02, y, z + 2.2], [0.02, y + 0.58, z + 2.2], [0.02, y + 0.58, z + 3.0], [0.02, y, z + 3.0])}" fill="${c}"/>`;
      });
    }
    if (f.floor === 3) { // 칸반 보드: 상태별 티켓 수
      const all = s.epics.flatMap((e) => e.tickets);
      const cols = [['todo', '#cbd5e1'], ['dev', '#3b82f6'], ['test', '#a855f7'], ['review', '#ef4444'], ['done', '#22c55e']];
      cols.forEach(([k, c], i) => {
        const n = all.filter((t) => t.status === k).length;
        for (let j = 0; j < Math.min(n, 6); j++) {
          const y = 0.5 + i * 1.05, zz = z + 3.4 - j * 0.4;
          html += `<polygon points="${pts([0.02, y, zz], [0.02, y + 0.85, zz], [0.02, y + 0.85, zz - 0.3], [0.02, y, zz - 0.3])}" fill="${c}"/>`;
        }
      });
    }
    f.roles.forEach((r, i) => {
      const s2 = seat(r, i, f.roles.length), role = META.roles[r];
      const active = act.role === r || (r === 'ceo' && (s.approvals.length || s.questions.some((q) => q.status === 'open')));
      const [cx, cy] = P(s2.x, s2.y, z + 1.2);
      html += `<g class="agent ${active ? 'active' : ''}" transform="translate(${cx},${cy})"><title>${esc(role.name)}</title>
        <circle class="halo" r="13" stroke="${role.color}"/><circle class="body" r="12" fill="${role.color}"/><text>${esc(role.short ?? role.name.slice(0, 2))}</text></g>`;
      if (active) {
        const label = r === 'ceo' ? '대표 차례입니다' : act.label;
        const w = Math.min(220, 18 + label.length * 11);
        html += `<g class="bubble" transform="translate(${cx - w / 2},${cy - 52})"><rect width="${w}" height="26" rx="13"/><text x="${w / 2}" y="17" text-anchor="middle">${esc(label)}</text></g>`;
      }
    });
    $(`#dyn-${f.floor}`).innerHTML = html;
  }
  const [, y1] = P(0, 0, 0), [, yf] = P(0, 0, ((act.floor ?? 1) - 1) * H);
  $('#car').style.transform = `translateY(${yf - y1}px)`;
}

// ---------------- 패널 ----------------
function selectFloor(f) { floor = f; renderAll(); }
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
  $('#cost').textContent = s.costUsd ? `누적 $${s.costUsd.toFixed(2)}` : `엔진: ${SNAP.meta.engine}`;
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

function renderFloorInfo() {
  const s = SNAP.state, f = META.floors.find((x) => x.floor === floor);
  let body = '';
  if (floor === 1) body = `<p class="muted">프로젝트 폴더: <code>${esc(SNAP.meta.projectDir)}</code></p>
    <p>${s.idea ? `<b>아이디어</b><br>${esc(s.idea)}` : '아직 아이디어가 없습니다. 2F 기획실에서 시작하세요.'}</p>`;
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
  $('#msg').placeholder = floor === 2 && s.phase === 'idle' ? '만들고 싶은 것을 한 단락으로 써 주세요. (외주 공고를 그대로 붙여 넣어도 됩니다)'
    : floor >= 3 && ['building', 'paused'].includes(s.phase) ? '변경 요청을 쓰면 진행 중인 티켓이 끝난 뒤 새 티켓으로 반영합니다.'
      : `${f.name} 직원에게 보낼 메시지 (다음 작업 지시에 함께 전달됩니다)`;
}

function renderFeed() {
  const s = SNAP.state;
  const items = [
    ...s.messages.filter((m) => m.floor === floor).map((m) => ({ ts: m.ts, html: `<div class="msg ceo"><span class="who">대표(당신)</span>${esc(m.text)}</div>` })),
    ...LOGS.filter((l) => l.floor === floor && l.role !== 'ceo').slice(-60).map((l) => ({ ts: l.ts, html: `<div class="msg ${l.level ?? ''}"><span class="who">${esc(META.roles[l.role]?.name ?? '사무실')}</span>${esc(l.text)}</div>` })),
  ].sort((a, b) => a.ts.localeCompare(b.ts)).slice(-60);
  const el = $('#feed');
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.innerHTML = items.map((i) => i.html).join('') || '<p class="muted">아직 대화가 없습니다.</p>';
  if (atBottom) el.scrollTop = el.scrollHeight;
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
  const docs = [...SNAP.state.stages.map((s) => s.doc), 'AGENTS.md', 'CLAUDE.md', ...SNAP.state.epics.flatMap((e) => [`docs/planning/epics/${e.id}.md`, `docs/planning/epics/${e.id}-retro.md`])];
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
  renderTop(); renderFloorNav(); renderBuilding();
  if (tab === 'detail') { renderFloorInfo(); renderFeed(); renderLedger(); }
  if (tab === 'progress') renderProgress();
  if (tab === 'log') renderLog();
  if (tab === 'inspect') renderInspect();
}

// ---------------- 이벤트 ----------------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  const d = t.dataset, msg = $('#msg');
  if (d.tab) { tab = d.tab; showTab(); }
  else if (d.mode) await api('/api/mode', { mode: d.mode });
  else if (d.answer) await api('/api/answer', { id: d.answer, answer: d.val });
  else if (d.answerFree) { if (!msg.value.trim()) return msg.focus(); await api('/api/answer', { id: d.answerFree, answer: msg.value.trim() }); msg.value = ''; }
  else if (d.approve) await api('/api/approve', { id: d.approve, action: 'approve' });
  else if (d.redo) { await api('/api/approve', { id: d.redo, action: 'redo', note: msg.value.trim() }); msg.value = ''; }
  else if (d.retry) { const [kind, id] = d.retry.split(':'); await api('/api/retry', { kind, id }); }
  else if (d.skip) await api('/api/skip', { id: d.skip });
  else if (d.assume) await api('/api/assumption', { id: d.assume, ok: d.ok === '1' });
  else if (d.doc) openDoc(d.doc);
  else if (t.id === 'recheck') { SNAP.ledger = await api('/api/recheck', {}); renderAll(); }
});
$('#pauseBtn').onclick = () => api(SNAP.state.phase === 'paused' ? '/api/resume' : '/api/pause', {});
$('#docOpen').onclick = () => openDoc($('#docSel').value);
$('#logFloor').onchange = renderLog;
const send = async () => { const text = $('#msg').value.trim(); if (!text) return; $('#msg').value = ''; await api('/api/message', { floor, text }); };
$('#sendBtn').onclick = send;
$('#msg').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });

(async () => {
  META = await api('/api/meta');
  LOGS = await api('/api/logs');
  buildStatic();
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => { SNAP = JSON.parse(e.data); renderAll(); });
  es.addEventListener('log', (e) => { LOGS.push(JSON.parse(e.data)); if (LOGS.length > 600) LOGS.shift(); if (tab === 'detail') renderFeed(); if (tab === 'log') renderLog(); });
  es.onerror = () => { $('#status').textContent = '서버와 연결이 끊겼습니다. 터미널에서 mwa up 이 켜져 있는지 확인하세요.'; };
})();
