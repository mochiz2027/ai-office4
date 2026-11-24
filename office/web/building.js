// 사무실 건물 렌더러 — 입체 단면(cutaway) 스타일, 순수 SVG.
// 좌표: x = 건물 가로(오른쪽 아래로), y = 깊이(왼쪽 아래로), z = 높이.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = 26, W = 14, D = 6, H = 4.6;
const CX = 0.95, SX = 0.2, CY = 0.62, SY = 0.3;
export const FLOOR_COLORS = { 1: '#f59e0b', 2: '#14b8a6', 3: '#8b5cf6', 4: '#3b82f6' };
const FLOOR_TINT = { 1: '#f6efe4', 2: '#eaf6f3', 3: '#f1eefb', 4: '#ecf2fc' };

const P = (x, y, z) => [(x * CX - y * CY) * S, (x * SX + y * SY) * S - z * S];
const pts = (...a) => a.map((p) => P(...p).map((n) => n.toFixed(1)).join(',')).join(' ');
const poly = (fill, a, extra = '') => `<polygon points="${pts(...a)}" fill="${fill}" ${extra}/>`;

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${[f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
const STROKE = 'stroke="rgba(15,23,42,.18)" stroke-width=".6" stroke-linejoin="round"';

/** 입체 상자: 윗면 + 보이는 두 옆면 */
function box(x0, y0, z0, w, d, h, color) {
  const x1 = x0 + w, y1 = y0 + d, z1 = z0 + h;
  return poly(shade(color, 0.82), [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], STROKE) +
    poly(shade(color, 0.7), [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], STROKE) +
    poly(color, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], STROKE);
}
/** 뒷벽(y=0 평면) 위 사각형 */
const wallY = (x0, x1, z0, z1, fill, extra = '') => poly(fill, [[x0, 0.03, z0], [x1, 0.03, z0], [x1, 0.03, z1], [x0, 0.03, z1]], extra);
/** 왼쪽 벽(x=0 평면) 위 사각형 */
const wallX = (y0, y1, z0, z1, fill, extra = '') => poly(fill, [[0.03, y0, z0], [0.03, y1, z0], [0.03, y1, z1], [0.03, y0, z1]], extra);

// ---------- 소품 ----------
const item = (depth, svg) => ({ depth, svg });
function desk(x, y, z, monitors = 1) {
  let s = box(x, y, z, 1.7, 0.85, 0.72, '#e3cfae'); // 원목 책상
  const mw = monitors > 1 ? 0.34 : 0.55; // 모니터는 오른쪽에 두어 직원 얼굴을 가리지 않게 합니다.
  for (let i = 0; i < monitors; i++) s += box(x + 1.0 + i * (mw + 0.04), y + 0.12, z + 0.72, mw, 0.07, 0.45, '#273142');
  return item(x + y + 1.7, s);
}
function chair(x, y, z) { return item(x + y - 0.2, box(x, y, z, 0.5, 0.5, 0.42, '#5b6b80') + box(x, y, z + 0.42, 0.5, 0.1, 0.55, '#5b6b80')); }
function plant(x, y, z) {
  const [cx, cy] = P(x + 0.2, y + 0.2, z + 1.05);
  return item(x + y + 0.4, box(x, y, z, 0.4, 0.4, 0.42, '#c2703d') +
    `<circle cx="${cx}" cy="${cy}" r="11" fill="#3f9b5a"/><circle cx="${cx - 5}" cy="${cy + 3}" r="7" fill="#57b56f"/><circle cx="${cx + 5}" cy="${cy - 4}" r="6" fill="#2f7f47"/>`);
}
function shelf(x, y, z, w) {
  let s = box(x, y, z, w, 0.45, 2.0, '#9a6b47');
  const books = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#64748b'];
  for (let r = 0; r < 3; r++) for (let i = 0; i < Math.floor(w / 0.22); i++) {
    const bx = x + 0.06 + i * 0.22, bz = z + 0.15 + r * 0.62;
    s += poly(books[(i + r * 2) % books.length], [[bx, y + 0.46, bz], [bx + 0.16, y + 0.46, bz], [bx + 0.16, y + 0.46, bz + 0.42], [bx, y + 0.46, bz + 0.42]]);
  }
  return item(x + y + w, s);
}
function sofa(x, y, z) { return item(x + y + 2, box(x, y, z, 2.2, 0.25, 0.85, '#6b7fa3') + box(x, y + 0.25, z, 2.2, 0.75, 0.42, '#7d91b5')); }
function rack(x, y, z) {
  let s = box(x, y, z, 0.8, 0.8, 2.3, '#2b3646');
  for (let i = 0; i < 6; i++) { const [lx, ly] = P(x + 0.8, y + 0.2, z + 0.3 + i * 0.35); s += `<circle class="led" cx="${lx + 2}" cy="${ly}" r="1.6" fill="${i % 2 ? '#22c55e' : '#38bdf8'}"/>`; }
  return item(x + y + 1.6, s);
}

// ---------- 픽셀아트 고양이 ----------
// O 외곽선, F 털, S 줄무늬, L 밝은 털, E 눈, W 눈 하이라이트, P 분홍(귀·코), C 목걸이(역할 색)
const CAT = [
  '..O........O...',
  '.OFO......OFO..',
  '.OPFO....OFPO..',
  '.OFFFOOOOFFFO..',
  'OFFFFFSFSFFFFO.',
  'OFFEWFFFFEWFFO.',
  'OFFEEFFFFEEFFO.',
  'OFLFFFPPFFFLFO.',
  '.OFLLFFFFLLFO..',
  '..OCCCCCCCCO...',
  '.OFFFLLLLFFFO.O',
  '.OFFLLLLLLFFOFO',
  '.OFFLLLLLLFFOFO',
  '.OFLLFFFFLLFFO.',
  '.OOOOOOOOOOOO..',
];
// 역할별 털 색 [털, 줄무늬, 밝은 털, 눈]
const FUR = {
  ceo: ['#f59e0b', '#c2410c', '#fde7c2', '#1f2937'],       // 치즈 태비(대표)
  analyst: ['#9ca3af', '#6b7280', '#e5e7eb', '#1f2937'],   // 회색 태비
  pm: ['#f2d3a0', '#d4a65f', '#fff7e8', '#1f2937'],        // 크림
  ux: ['#f8fafc', '#cbd5e1', '#ffffff', '#2563eb'],        // 흰 고양이(파란 눈)
  architect: ['#334155', '#1e293b', '#64748b', '#facc15'], // 검은 고양이(노란 눈)
  po: ['#fb923c', '#292524', '#fff7ed', '#1f2937'],        // 삼색이
  sm: ['#a16207', '#713f12', '#fde68a', '#1f2937'],        // 갈색 태비
  qa: ['#cbd5e1', '#94a3b8', '#f1f5f9', '#0f766e'],        // 은색
  reviewer: ['#1f2937', '#111827', '#f8fafc', '#84cc16'],  // 턱시도
  dev: ['#f97316', '#9a3412', '#ffedd5', '#1f2937'],       // 주황 태비
};
const PX = 2.6;
const spriteCache = {};
function catSprite(key, collar) {
  const id = `${key}:${collar}`;
  if (spriteCache[id]) return spriteCache[id];
  const [fur, stripe, light, eye] = FUR[key] ?? FUR.dev;
  const col = { O: '#1c1917', F: fur, S: stripe, L: light, E: eye, W: '#ffffff', P: '#f9a8d4', C: collar };
  const w = CAT[0].length, h = CAT.length;
  let out = '';
  CAT.forEach((row, y) => {
    // 같은 색이 이어지는 칸은 하나의 사각형으로 합칩니다.
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let n = 1; while (x + n < row.length && row[x + n] === ch) n++;
      if (ch !== '.') out += `<rect x="${(x * PX).toFixed(1)}" y="${(y * PX).toFixed(1)}" width="${(n * PX + 0.05).toFixed(2)}" height="${(PX + 0.05).toFixed(2)}" fill="${col[ch]}"/>`;
      x += n;
    }
  });
  return (spriteCache[id] = `<g class="cat" shape-rendering="crispEdges" transform="translate(${(-w * PX / 2).toFixed(1)},${(-h * PX).toFixed(1)})">${out}</g>`);
}

/** 직원 캐릭터(픽셀 고양이) */
function person(x, y, z, role, opts = {}) {
  const [cx, cy] = P(x, y, z);
  const cls = `person ${opts.active ? 'active' : ''} ${opts.dim ? 'dim' : ''}`;
  const tag = role.short ?? role.name.slice(0, 2);
  const tw = 12 + tag.length * 9;
  return item(x + y + 0.05, `<g class="${cls}" transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})"><title>${esc(role.name)}</title>
    <ellipse class="shadow" cx="0" cy="0" rx="13" ry="4"/>
    <g class="fig"><circle class="halo" cx="0" cy="-20" r="18" stroke="${role.color}"/>${catSprite(opts.key, role.color)}</g>
    <g class="tag" transform="translate(0,-56)"><rect x="${-tw / 2}" y="0" width="${tw}" height="14" rx="7"/><text x="0" y="10.5">${esc(tag)}</text></g></g>`);
}

// ---------- 층별 배치 ----------
const ROWY = 3.0; // 책상 줄 깊이
function seatX(i, n) { return 1.2 + i * ((W - 2.4) / n); }

function furniture(floor, z, roles) {
  const it = [];
  if (floor === 1) {
    it.push(item(1.5 + 3.4 + 2.4, box(1.5, 3.4, z, 2.6, 0.8, 1.05, '#e9e2d6') + box(1.5, 3.4, z + 1.05, 2.6, 0.8, 0.08, '#b98a5e')));
    it.push(sofa(5.3, 3.9, z), plant(0.4, 5.2, z), plant(8.2, 4.6, z), shelf(8.8, 0.25, z, 2.2), plant(12.9, 0.4, z));
    it.push(desk(10.3, ROWY, z, 1), chair(10.9, ROWY - 0.75, z));
  } else {
    const n = floor === 4 ? 4 : roles.length;
    for (let i = 0; i < n; i++) {
      const x = floor === 4 ? 1.2 + i * 3.0 : seatX(i, n);
      it.push(desk(x, ROWY, z, floor === 4 ? 2 : 1), chair(x + 0.6, ROWY - 0.75, z));
    }
    if (floor === 2) it.push(plant(12.9, 4.9, z), item(13, box(10.2, 4.4, z, 2.2, 1.1, 0.7, '#f1f5f9')));
    if (floor === 3) it.push(rack(12.6, 0.5, z), plant(12.9, 4.9, z));
    if (floor === 4) it.push(plant(13.0, 4.8, z), plant(0.4, 5.2, z));
  }
  return it;
}

function windowsAndBoards(floor, z, state) {
  let s = '';
  // 왼쪽 벽 창문
  for (let i = 0; i < 3; i++) s += wallX(0.6 + i * 1.8, 1.9 + i * 1.8, z + 0.9, z + 3.6, 'url(#glassGrad)', 'stroke="#9fb9cc" stroke-width=".8"');
  // 뒷벽: 층마다 다른 보드/창문
  const winRow = (from, to) => { for (let x = from; x + 1.4 <= to; x += 1.8) s += wallY(x, x + 1.4, z + 1.2, z + 3.7, 'url(#glassGrad)', 'stroke="#9fb9cc" stroke-width=".8"'); };
  if (floor === 2) { // 기획 화이트보드: 단계 진행
    s += wallY(1.0, 8.6, z + 0.5, z + 1.9, '#ffffff', 'stroke="#cbd5e1" stroke-width="1"');
    state.stages.forEach((st, i) => {
      const c = st.status === 'done' ? '#22c55e' : st.status === 'running' ? '#14b8a6' : st.status === 'failed' ? '#ef4444' : '#e2e8f0';
      s += wallY(1.3 + i * 1.03, 2.1 + i * 1.03, z + 0.9, z + 1.6, c);
    });
    winRow(9.2, 13.6);
  } else if (floor === 3) { // 칸반 보드
    s += wallY(1.0, 9.6, z + 0.35, z + 2.05, '#fbfaf5', 'stroke="#cbd5e1" stroke-width="1"');
    const all = state.epics.flatMap((e) => e.tickets);
    [['todo', '#cbd5e1'], ['dev', '#60a5fa'], ['test', '#c084fc'], ['review', '#f87171'], ['done', '#4ade80']].forEach(([k, c], i) => {
      const n = all.filter((t) => t.status === k || (k === 'todo' && ['failed', 'skipped'].includes(t.status))).length;
      s += wallY(1.2 + i * 1.68, 2.7 + i * 1.68, z + 1.75, z + 1.92, shade(c, 0.85));
      for (let j = 0; j < Math.min(n, 4); j++) s += wallY(1.3 + i * 1.68, 2.6 + i * 1.68, z + 1.62 - j * 0.32, z + 1.38 - j * 0.32, c);
    });
    winRow(10.2, 12.2);
  } else if (floor === 4) {
    winRow(0.8, 13.6);
  } else {
    winRow(0.8, 8.4);
    s += wallY(11.2, 13.4, z + 0.05, z + 2.7, '#d7dee7', 'stroke="#9fb9cc" stroke-width=".8"'); // 출입문
    s += wallY(12.3, 12.34, z + 0.05, z + 2.7, '#9fb9cc');
  }
  return s;
}

function slab(floor, z, top) {
  const t = 0.32;
  const tint = top ? '#dfe5ec' : FLOOR_TINT[floor];
  let s = poly(tint, [[0, 0, z], [W, 0, z], [W, D, z], [0, D, z]], STROKE);
  s += poly('#cfd6df', [[W, 0, z], [W, D, z], [W, D, z - t], [W, 0, z - t]], STROKE);
  s += poly('#c3cbd5', [[0, D, z], [W, D, z], [W, D, z - t], [0, D, z - t]], STROKE);
  if (!top) { // 층 색 라인(바닥 가장자리 조명)
    s += poly(FLOOR_COLORS[floor], [[0, D, z - 0.02], [W, D, z - 0.02], [W, D, z - 0.14], [0, D, z - 0.14]], 'opacity=".9"');
    s += poly(FLOOR_COLORS[floor], [[W, 0, z - 0.02], [W, D, z - 0.02], [W, D, z - 0.14], [W, 0, z - 0.14]], 'opacity=".75"');
  }
  return s;
}

function walls(z) {
  return poly('#eef1f5', [[0, 0, z], [0, D, z], [0, D, z + H], [0, 0, z + H]], STROKE) +
    poly('#e6eaf0', [[0, 0, z], [W, 0, z], [W, 0, z + H], [0, 0, z + H]], STROKE);
}

/** 정적 골격(층·엘리베이터 샤프트) — 한 번만 그립니다. */
export function buildStatic(svg, meta, onFloor) {
  const floors = meta.floors.length;
  let html = `<defs><linearGradient id="glassGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe6f5"/><stop offset="1" stop-color="#9cc4de"/></linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-opacity=".12"/></filter></defs>`;
  // 바닥 그림자
  html += poly('rgba(15,23,42,.08)', [[-0.6, -0.4, -0.35], [W + 3.4, -0.4, -0.35], [W + 3.4, D + 0.8, -0.35], [-0.6, D + 0.8, -0.35]]);
  for (let f = 1; f <= floors; f++) {
    const z = (f - 1) * H;
    html += `<g class="floor-g" data-floor="${f}">${walls(z)}<g id="wall-${f}"></g>${slab(f, z)}<g id="dyn-${f}"></g></g>`;
  }
  // 옥상 + 간판
  const zt = floors * H;
  html += slab(0, zt, true) + box(0, 0, zt, W, 0.2, 0.45, '#d5dbe3') + box(0, 0.2, zt, 0.2, D - 0.2, 0.45, '#d5dbe3');
  html += box(3.4, 2.4, zt, 6.6, 0.3, 1.2, '#1f2937');
  const [sx, sy] = P(3.7, 2.7, zt + 0.32);
  html += `<text transform="matrix(${CX},${SX},0,1,${sx},${sy})" class="roof-sign" font-size="${0.72 * S}">MWA OFFICE</text>`;
  // 엘리베이터 샤프트(유리)
  const ex = W + 0.5, ey = 0.4, ew = 2.3, ed = 2.2, eh = floors * H + 0.6;
  html += poly('#cfd8e2', [[ex, ey, 0], [ex + ew, ey, 0], [ex + ew, ey, eh], [ex, ey, eh]], STROKE);
  html += poly('#d9e1ea', [[ex, ey, 0], [ex, ey + ed, 0], [ex, ey + ed, eh], [ex, ey, eh]], STROKE);
  for (let f = 1; f <= floors; f++) html += poly('#b9c4d0', [[ex, ey, (f - 1) * H], [ex + ew, ey, (f - 1) * H], [ex + ew, ey + ed, (f - 1) * H], [ex, ey + ed, (f - 1) * H]]);
  html += `<g id="car">${box(ex + 0.25, ey + 0.25, 0.05, ew - 0.5, ed - 0.5, 2.9, '#f5a524')}</g>`;
  html += poly('rgba(160,205,235,.28)', [[ex + ew, ey, 0], [ex + ew, ey + ed, 0], [ex + ew, ey + ed, eh], [ex + ew, ey, eh]], 'stroke="#8fb3cc" stroke-width="1"');
  html += poly('rgba(160,205,235,.22)', [[ex, ey + ed, 0], [ex + ew, ey + ed, 0], [ex + ew, ey + ed, eh], [ex, ey + ed, eh]], 'stroke="#8fb3cc" stroke-width="1"');
  html += box(ex, ey, eh, ew, ed, 0.3, '#c9d2dc');
  html += `<g id="labels"></g>`;
  svg.innerHTML = html;

  const [l] = P(0, D, 0), [r] = P(ex + ew, 0, 0), [, t] = P(0, 0, eh + 1.6), [, b] = P(W, D + 1, -0.4);
  svg.setAttribute('viewBox', `${(l - 290).toFixed(0)} ${(t - 20).toFixed(0)} ${(r - l + 480).toFixed(0)} ${(b - t + 40).toFixed(0)}`);
  svg.querySelectorAll('.floor-g').forEach((g) => g.addEventListener('click', () => onFloor(Number(g.dataset.floor))));
}

let lastKey = '';
/** 상태에 따라 바뀌는 부분(사람·보드·라벨·엘리베이터)을 다시 그립니다. */
export function renderDynamic(svg, meta, state, selectedFloor, setupOk = true) {
  const act = state.activity ?? {};
  const ceoTurn = state.approvals.length > 0 || state.questions.some((q) => q.status === 'open') || (state.setupBlock?.length ?? 0) > 0;
  const key = JSON.stringify([act, state.stages.map((x) => x.status), state.epics.map((e) => e.tickets.map((t) => t.status)), ceoTurn, selectedFloor, state.phase, setupOk]);
  if (key === lastKey) return; lastKey = key;

  let labels = '', bubbles = '';
  for (const f of meta.floors) {
    const z = (f.floor - 1) * H;
    svg.querySelector(`#wall-${f.floor}`).innerHTML = windowsAndBoards(f.floor, z, state);
    const its = furniture(f.floor, z, f.roles);
    f.roles.forEach((r, i) => {
      const role = meta.roles[r];
      let x = f.floor === 1 ? 11.15 : seatX(i, f.roles.length) + 0.85;
      if (f.floor === 4) x = 1.2 + 0.85; // 개발자는 첫 번째 자리
      const active = r === 'ceo' ? ceoTurn : act.role === r;
      its.push(person(x - 0.15, ROWY - 0.35, z + 0.4, role, { key: r, active, dim: !active && act.role && act.floor === f.floor }));
      if (active) {
        const label = r === 'ceo' ? '대표 차례입니다' : act.label ?? '';
        const [bx, by] = P(x - 0.15, ROWY - 0.35, z + 0.4);
        const w = Math.min(240, 24 + label.length * 11.5);
        bubbles += (`<g class="bubble" transform="translate(${(bx - w / 2).toFixed(1)},${(by - 104).toFixed(1)})"><rect width="${w}" height="28" rx="14" filter="url(#soft)"/><path d="M${w / 2 - 6},27 l6,8 l6,-8z"/><text x="${w / 2}" y="18.5">${esc(label)}</text></g>`);
      }
    });
    its.sort((a, b) => a.depth - b.depth);
    svg.querySelector(`#dyn-${f.floor}`).innerHTML = its.map((i) => i.svg).join('');

    // 층 라벨 카드
    const working = act.role && act.floor === f.floor;
    const chip = working ? ['작업 중', FLOOR_COLORS[f.floor]] : f.floor === 1 && !setupOk ? ['설치 점검 필요', '#ef4444'] : f.floor === 1 && ceoTurn ? ['대표 차례', '#ef4444'] : null;
    const [lx, ly] = P(0, D, z + H * 0.45);
    labels += `<g class="flabel ${selectedFloor === f.floor ? 'on' : ''}" data-floor="${f.floor}" transform="translate(${(lx - 276).toFixed(1)},${(ly - 30).toFixed(1)})">
      <rect width="246" height="${chip ? 66 : 50}" rx="12" filter="url(#soft)"/>
      <rect x="12" y="12" width="30" height="20" rx="6" fill="${FLOOR_COLORS[f.floor]}"/><text class="fb" x="27" y="26">${f.floor}F</text>
      <text class="t" x="50" y="27">${esc(f.name)}</text><text class="d" x="12" y="44">${esc(f.desc)}</text>
      ${chip ? `<rect x="12" y="50" width="${chip[0].length * 12 + 16}" height="14" rx="7" fill="${chip[1]}" opacity=".15"/><text class="chip" x="20" y="61" fill="${chip[1]}">${chip[0]}</text>` : ''}</g>`;
  }
  const lg = svg.querySelector('#labels');
  lg.innerHTML = labels + bubbles;
  lg.querySelectorAll('.flabel').forEach((g) => g.addEventListener('click', () => svg.dispatchEvent(new CustomEvent('floor', { detail: Number(g.dataset.floor) }))));

  const [, y0] = P(0, 0, 0), [, yf] = P(0, 0, ((act.role ? act.floor : 1) - 1) * H);
  svg.querySelector('#car').style.transform = `translateY(${(yf - y0).toFixed(1)}px)`;
}
