// 3D 사옥 — three.js (office/web/vendor 에 포함, 인터넷 없이 동작)
// 마우스 드래그로 전면·측면 회전, 휠로 확대, 층을 누르면 그 층 내부로 들어갑니다.
import * as THREE from 'three';
import { OrbitControls } from './vendor/addons/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from './vendor/addons/CSS2DRenderer.js';
import { CAT, FUR, ZONES, FLOOR_COLORS } from './building.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- 치수 (단위: m 비슷하게) ----
const W = 14, D = 7, H = 4.2, T = 0.3;          // 사무실 가로·깊이·층고·슬래브 두께
const X0 = -W / 2, X1 = W / 2, Z0 = -D / 2, Z1 = D / 2;
const LW = 3;                                   // 오른쪽 엘리베이터 로비 폭
const SH = { x0: X1 + 0.3, x1: X1 + LW - 0.3, z0: Z0, z1: Z0 + 2.3 }; // 엘리베이터 샤프트
const DOOR = { cx: (SH.x0 + SH.x1) / 2, w: 1.3, h: 2.5 };
const SIDE = { z0: 0.3, z1: 1.5 };              // 사무실 옆문(로비 ↔ 사무실)
const ROW = -0.7;                               // 책상 줄 z
const base = (f) => (f - 1) * H;

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch { return false; }
}

export function create3D(container, meta, { onFloor, onExit } = {}) {
  // ---------- 렌더러·장면 ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'labels3d';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 400);
  const HOME = { pos: new THREE.Vector3(-18, 16.5, 37), target: new THREE.Vector3(1.5, 7.8, 0) };
  camera.position.copy(HOME.pos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME.target);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 7; controls.maxDistance = 70;
  controls.minAzimuthAngle = -1.35; controls.maxAzimuthAngle = 1.35; // 전면 ~ 양 측면까지
  controls.screenSpacePanning = true;
  const setPolar = (min, max) => { controls.minPolarAngle = min; controls.maxPolarAngle = max; };
  setPolar(0.95, 1.5);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-18, 30, 22); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 24, bottom: -6, near: 1, far: 90 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // ---------- 재료·도형 도우미 ----------
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const mats = new Map();
  const mat = (color, o = {}) => {
    const key = `${color}|${JSON.stringify(o)}`;
    if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, ...o }));
    return mats.get(key);
  };
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9cc8e6, transparent: true, opacity: 0.32, roughness: 0.1, metalness: 0.1, depthWrite: false });
  /** 상자: (x0,y0,z0) 모서리부터 크기 (w,h,d) */
  function box(parent, x0, y0, z0, w, h, d, color, o = {}) {
    const m = new THREE.Mesh(boxGeo, typeof color === 'object' ? color : mat(color, o.mat));
    m.scale.set(w, h, d); m.position.set(x0 + w / 2, y0 + h / 2, z0 + d / 2);
    m.castShadow = o.cast ?? true; m.receiveShadow = o.receive ?? true;
    parent.add(m);
    return m;
  }
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const redraw = (...a) => { draw(c.getContext('2d'), c, ...a); tex.needsUpdate = true; };
    redraw();
    return { tex, redraw, canvas: c };
  }
  let boardState = null; // 보드 캔버스가 그릴 최신 상태
  function label(parent, html, x, y, z, cls) {
    const el = document.createElement('div'); el.className = cls; el.innerHTML = html;
    const o = new CSS2DObject(el); o.position.set(x, y, z); parent.add(o);
    return o;
  }

  // ---------- 픽셀 고양이 텍스처 ----------
  const catTex = {};
  function catTexture(key, collar) {
    const id = `${key}|${collar}`;
    if (catTex[id]) return catTex[id];
    const [fur, stripe, light, eye] = FUR[key] ?? FUR.dev;
    const col = { O: '#1c1917', F: fur, S: stripe, L: light, E: eye, W: '#ffffff', P: '#f9a8d4', C: collar };
    const n = CAT.length, s = 8;
    const { tex } = canvasTex(n * s, n * s, (g) => {
      CAT.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') { g.fillStyle = col[ch]; g.fillRect(x * s, y * s, s, s); } }));
    });
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    return (catTex[id] = tex);
  }

  // ---------- 바닥·주변 ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ color: 0xeef1f5, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.31; ground.receiveShadow = true; scene.add(ground);
  box(scene, X0 - 2, -0.31, Z1, W + LW + 4, 0.06, 4, '#d9dee6', { cast: false }); // 앞 보도
  for (let i = 0; i < 6; i++) box(scene, X0 - 1.5 + i * 3.4, -0.25, Z1 + 1.6, 1.6, 0.02, 0.5, '#ffffff', { cast: false }); // 보도 줄

  // ---------- 층 ----------
  const floors = {};          // f → { group, edge, labelEl, doors:[l,r], side, ind, boards... }
  const pickables = [];
  const totalF = meta.floors.length;

  for (const fl of meta.floors) {
    const f = fl.floor, y = base(f), g = new THREE.Group(); g.userData.floor = f; scene.add(g);
    const fc = FLOOR_COLORS[f];
    const F = (floors[f] = { group: g });

    // 슬래브(사무실 + 로비)
    const tint = { 1: '#f3ece1', 2: '#e6f4f0', 3: '#efecf8', 4: '#e8eff9' }[f];
    pickables.push(box(g, X0, y - T, Z0, W, T, D, tint));
    pickables.push(box(g, X1, y - T, Z0, LW, T, D, '#e5e7eb'));
    F.edge = box(g, X0, y - T * 0.75, Z1, W + LW, 0.14, 0.04, fc, { mat: { emissive: fc, emissiveIntensity: 0.25 } });
    box(g, X0 - 0.04, y - T * 0.75, Z0, 0.04, 0.14, D, fc, { mat: { emissive: fc, emissiveIntensity: 0.25 } });

    // 뒷벽 + 왼쪽 외벽(창문)
    pickables.push(box(g, X0 - 0.2, y, Z0 - 0.2, W + LW + 0.2, H - T, 0.2, '#e9ecf1'));
    pickables.push(box(g, X0 - 0.2, y, Z0, 0.2, H - T, D, '#dfe4ea'));
    for (let i = 0; i < 3; i++) {
      box(g, X0 + 0.01, y + 1.0, Z0 + 0.6 + i * 2.15, 0.04, 2.2, 1.6, glassMat, { cast: false });
      box(g, X0 + 0.02, y + 2.05, Z0 + 0.6 + i * 2.15, 0.05, 0.06, 1.6, '#94a3b8');
    }

    // 엘리베이터 샤프트 앞벽 + 층별 엘리베이터 문
    const zf = SH.z1;
    box(g, SH.x0, y, Z0, 0.15, H - T, SH.z1 - Z0, '#cfd6df');
    box(g, SH.x1 - 0.15, y, Z0, 0.15, H - T, SH.z1 - Z0, '#cfd6df');
    box(g, SH.x0, y, zf - 0.15, DOOR.cx - DOOR.w / 2 - SH.x0, H - T, 0.15, '#dfe4ea');
    box(g, DOOR.cx + DOOR.w / 2, y, zf - 0.15, SH.x1 - DOOR.cx - DOOR.w / 2, H - T, 0.15, '#dfe4ea');
    box(g, DOOR.cx - DOOR.w / 2, y + DOOR.h, zf - 0.15, DOOR.w, H - T - DOOR.h, 0.15, '#dfe4ea');
    box(g, DOOR.cx - DOOR.w / 2 - 0.08, y, zf, 0.08, DOOR.h + 0.08, 0.04, fc);              // 문틀(층 색)
    box(g, DOOR.cx + DOOR.w / 2, y, zf, 0.08, DOOR.h + 0.08, 0.04, fc);
    box(g, DOOR.cx - DOOR.w / 2 - 0.08, y + DOOR.h, zf, DOOR.w + 0.16, 0.08, 0.04, fc);
    const dl = box(g, DOOR.cx - DOOR.w / 2, y, zf - 0.02, DOOR.w / 2, DOOR.h, 0.05, '#b8c2ce', { mat: { metalness: 0.5, roughness: 0.35 } });
    const dr = box(g, DOOR.cx, y, zf - 0.02, DOOR.w / 2, DOOR.h, 0.05, '#b8c2ce', { mat: { metalness: 0.5, roughness: 0.35 } });
    dl.userData.door = dr.userData.door = f;
    pickables.push(dl, dr);
    F.doors = [dl, dr]; F.doorOpen = 0;
    // 층 표시기
    F.ind = canvasTex(128, 48, (c2, c, cur) => {
      c2.fillStyle = '#111827'; c2.fillRect(0, 0, c.width, c.height);
      c2.fillStyle = '#fbbf24'; c2.font = 'bold 30px monospace'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
      c2.fillText(`${cur ?? 1}F`, c.width / 2, c.height / 2 + 2);
    });
    const indM = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.22), new THREE.MeshBasicMaterial({ map: F.ind.tex }));
    indM.position.set(DOOR.cx, y + DOOR.h + 0.32, zf + 0.03); g.add(indM);
    const btn = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), new THREE.MeshBasicMaterial({ color: fc }));
    btn.position.set(DOOR.cx + DOOR.w / 2 + 0.25, y + 1.2, zf + 0.03); g.add(btn);

    // 사무실 옆문(로비 ↔ 사무실): 칸막이 + 유리문(회전)
    box(g, X1 - 0.08, y, Z0, 0.12, H - T, SIDE.z0 - Z0, '#e2e8f0');
    box(g, X1 - 0.06, y, SIDE.z1, 0.06, H - T, Z1 - SIDE.z1, glassMat, { cast: false });
    box(g, X1 - 0.1, y + 2.4, SIDE.z0, 0.14, H - T - 2.4, SIDE.z1 - SIDE.z0, '#e2e8f0');
    box(g, X1 - 0.1, y, SIDE.z1, 0.1, H - T, 0.06, '#64748b');
    const pivot = new THREE.Group(); pivot.position.set(X1 - 0.04, y, SIDE.z0); g.add(pivot);
    const leaf = box(pivot, -0.03, 0, 0, 0.05, 2.4, SIDE.z1 - SIDE.z0 - 0.02, glassMat, { cast: false });
    box(pivot, -0.035, 0, 0, 0.06, 2.4, 0.05, '#64748b'); box(pivot, -0.035, 0, SIDE.z1 - SIDE.z0 - 0.07, 0.06, 2.4, 0.05, '#64748b');
    box(pivot, 0.03, 1.1, SIDE.z1 - SIDE.z0 - 0.25, 0.06, 0.3, 0.04, '#334155'); // 손잡이
    F.side = pivot; F.sideOpen = 0; leaf.userData.floor = f;
    const sideSign = label(g, `<span>${f}F ${esc(fl.name)}</span>`, X1 + 0.05, y + 2.65, (SIDE.z0 + SIDE.z1) / 2, 'sign3d');
    sideSign.element.style.setProperty('--c', fc);

    // 로비 오른쪽 유리 외벽
    box(g, X1 + LW - 0.05, y, Z0, 0.05, H - T, D, glassMat, { cast: false });
    for (let i = 0; i <= 3; i++) box(g, X1 + LW - 0.08, y, Z0 + i * (D / 3) - 0.04, 0.08, H - T, 0.08, '#64748b');
    box(g, X1 + LW - 0.08, y + 1.0, Z0, 0.08, 0.06, D, '#64748b');
    // 앞 기둥
    box(g, X0 - 0.2, y, Z1 - 0.2, 0.3, H - T, 0.3, '#cbd5e1');
    box(g, X1 + LW - 0.2, y, Z1 - 0.2, 0.3, H - T, 0.3, '#cbd5e1');

    // 층 라벨 카드(왼쪽)
    const lab = label(g, '', X0 - 0.6, y + H * 0.45, Z1, 'flabel3d');
    lab.element.dataset.floor = f; lab.element.style.setProperty('--c', FLOOR_COLORS[f]);
    lab.element.addEventListener('click', () => onFloor?.(f));
    F.label = lab.element; F.name = fl;

    F.people = new THREE.Group(); g.add(F.people);
    furnish(g, f, F);
  }

  // 엘리베이터 카(샤프트 안)
  const car = box(scene, SH.x0 + 0.25, 0.02, SH.z0 + 0.2, SH.x1 - SH.x0 - 0.5, 2.7, SH.z1 - SH.z0 - 0.5, '#f5a524', { mat: { emissive: '#f59e0b', emissiveIntensity: 0.15 } });
  let carFloor = 1;

  // 옥상
  const roof = new THREE.Group(); scene.add(roof);
  const ry = base(totalF + 1);
  box(roof, X0 - 0.2, ry - T, Z0 - 0.2, W + LW + 0.2, T, D + 0.2, '#e2e6ec');
  box(roof, X0 - 0.2, ry, Z1 - 0.15, W + LW + 0.2, 0.5, 0.15, '#d5dbe3'); box(roof, X0 - 0.2, ry, Z0 - 0.2, 0.15, 0.5, D + 0.2, '#d5dbe3');
  box(roof, X1 + 0.2, ry, Z0, LW - 0.4, 1.8, 2.6, '#dde2e9');                                  // 기계실(엘리베이터 상부)
  for (let i = 0; i < 6; i++) box(roof, X1 + 0.35, ry + 0.4 + i * 0.22, Z0 + 2.61, LW - 0.7, 0.06, 0.02, '#a3adb9', { cast: false });
  // 옥상 간판: 4층 위 옥상, 앞쪽 가장자리의 가운데(사무실+로비 전체 폭의 중앙)에 세웁니다.
  const SIGN = { cx: (X0 + X1 + LW) / 2, w: 8, h: 1.25, y: ry + 0.6, z: Z1 - 0.75 };
  box(roof, SIGN.cx - SIGN.w / 2 - 0.1, SIGN.y - 0.1, SIGN.z, SIGN.w + 0.2, SIGN.h + 0.2, 0.25, '#1f2937');
  for (const dx of [-SIGN.w / 3, 0, SIGN.w / 3]) box(roof, SIGN.cx + dx - 0.06, ry, SIGN.z + 0.05, 0.12, 0.6, 0.12, '#475569'); // 받침 기둥
  const sign = canvasTex(1024, 160, (g2, c) => {
    g2.fillStyle = '#1f2937'; g2.fillRect(0, 0, c.width, c.height);
    g2.font = 'bold 110px "Arial Black", sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.shadowColor = '#fde68a'; g2.shadowBlur = 28; g2.fillStyle = '#fde68a'; g2.fillText('BS OFFICE', c.width / 2, c.height / 2 + 6);
  });
  const signM = new THREE.Mesh(new THREE.PlaneGeometry(SIGN.w, SIGN.h), new THREE.MeshBasicMaterial({ map: sign.tex }));
  signM.position.set(SIGN.cx, SIGN.y + SIGN.h / 2, SIGN.z + 0.26); roof.add(signM);

  // ---------- 층별 가구 ----------
  function desk(g, x, z, y, monitors = 1, zoneColor) {
    box(g, x - 0.8, y, z - 0.4, 1.6, 0.72, 0.8, '#d9c19c');
    box(g, x - 0.82, y + 0.72, z - 0.42, 1.64, 0.05, 0.84, '#c9a97c');
    const ms = [];
    for (let i = 0; i < monitors; i++) {
      const mx = x + 0.1 + i * 0.36;
      box(g, mx + 0.12, y + 0.77, z - 0.2, 0.06, 0.18, 0.06, '#334155');
      ms.push(box(g, mx - 0.02, y + 0.92, z - 0.24, monitors > 1 ? 0.34 : 0.55, 0.34, 0.04, '#1f2937', { mat: { emissive: zoneColor ?? '#38bdf8', emissiveIntensity: 0.05 } }));
    }
    box(g, x - 0.25, y, z - 1.15, 0.5, 0.45, 0.5, '#475569'); box(g, x - 0.25, y + 0.45, z - 1.2, 0.5, 0.55, 0.08, '#475569'); // 의자
    return ms;
  }
  function plant(g, x, z, y) {
    box(g, x - 0.22, y, z - 0.22, 0.44, 0.45, 0.44, '#c2703d');
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), mat('#3f9b5a', { flatShading: true }));
    leaf.position.set(x, y + 0.95, z); leaf.castShadow = true; g.add(leaf);
  }
  function shelf(g, x, z, y, w) {
    box(g, x, y, z, w, 2.1, 0.45, '#9a6b47');
    const cols = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#64748b'];
    for (let r = 0; r < 3; r++) for (let i = 0; i < Math.floor(w / 0.2) - 1; i++) box(g, x + 0.1 + i * 0.2, y + 0.15 + r * 0.66, z + 0.3, 0.14, 0.46, 0.16, cols[(i + r * 2) % 6], { cast: false });
  }
  function wallBoard(g, x, y, w, h, drawFn) {
    const ct = canvasTex(Math.round(w * 100), Math.round(h * 100), drawFn);
    box(g, x - 0.06, y - 0.06, Z0 + 0.01, w + 0.12, h + 0.12, 0.04, '#94a3b8');
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: ct.tex, roughness: 0.9 }));
    m.position.set(x + w / 2, y + h / 2, Z0 + 0.06); g.add(m);
    return ct;
  }

  function furnish(g, f, F) {
    const y = base(f);
    F.seats = {};
    if (f === 1) {
      box(g, -6.2, y, 0.6, 2.8, 1.05, 0.8, '#ece4d8'); box(g, -6.25, y + 1.05, 0.55, 2.9, 0.08, 0.9, '#b98a5e'); // 안내 데스크
      box(g, -2.4, y, 1.4, 2.4, 0.42, 0.9, '#7d91b5'); box(g, -2.4, y, 2.2, 2.4, 0.85, 0.25, '#6b7fa3');           // 소파
      box(g, -2.0, y, 0.2, 1.6, 0.35, 0.8, '#a8a29e');                                                             // 테이블
      box(g, -3.2, y + 0.005, -0.3, 4, 0.01, 3.2, '#e7d8c2', { cast: false });                                     // 러그
      shelf(g, 0.6, Z0 + 0.05, y, 2.4);
      box(g, -1.2, y, Z0 + 0.01, 1.8, 2.7, 0.06, glassMat, { cast: false }); box(g, -0.32, y, Z0 + 0.02, 0.04, 2.7, 0.06, '#64748b'); // 정문
      plant(g, -6.5, 3.0, y); plant(g, 6.3, 2.8, y); plant(g, 3.4, -3.0, y);
      F.monitors = { ceo: desk(g, 4.4, ROW, y, 1) };
      F.seats.ceo = [4.4, ROW - 0.9];
    }
    if (f === 2) {
      box(g, -2.6, y, 0.4, 4.2, 0.74, 1.6, '#c9a97c');                                                             // 회의 테이블
      for (let i = 0; i < 4; i++) { box(g, -2.3 + i * 1.05, y, 2.15, 0.5, 0.45, 0.5, '#e5e7eb'); box(g, -2.3 + i * 1.05, y, -0.35, 0.5, 0.45, 0.5, '#e5e7eb'); }
      for (let i = 0; i < 5; i++) box(g, -2.3 + i * 0.8, y + 0.745, 0.9, 0.3, 0.005, 0.4, '#ffffff', { cast: false }); // 종이
      box(g, -3.3, y + 0.005, -0.6, 5.6, 0.01, 3.6, '#efe5d6', { cast: false });
      box(g, -6.6, y, 0.6, 0.5, 1.4, 1.4, '#334155'); box(g, -6.55, y + 1.4, 0.65, 0.08, 0.9, 1.3, '#111827');      // TV
      F.board = wallBoard(g, -5.5, y + 1.6, 6.2, 1.5, drawWhiteboard);
      F.monitors = {};
      meta.floors.find((x) => x.floor === 2).roles.forEach((r, i) => {
        const x = 2.0 + (i % 3) * 1.9, z = i < 3 ? -1.9 : 2.2;
        F.monitors[r] = desk(g, x, z, y, 1); F.seats[r] = [x, z - 0.9];
      });
      plant(g, 6.3, 3.0, y); plant(g, -6.4, 3.0, y);
    }
    if (f === 3) {
      F.board = wallBoard(g, -6.2, y + 1.3, 6.6, 2.0, drawKanban);
      F.monitors = {};
      ['sm', 'qa', 'reviewer'].forEach((r, i) => { const x = -4.8 + i * 3.2; F.monitors[r] = desk(g, x, ROW + 1.2, y, 2); F.seats[r] = [x, ROW + 0.3]; });
      box(g, 4.6, y, Z0 + 0.1, 0.9, 2.4, 0.9, '#2b3646'); box(g, 5.6, y, Z0 + 0.1, 0.9, 2.4, 0.9, '#2b3646');     // CI 서버랙
      F.leds = [];
      for (let k = 0; k < 2; k++) for (let i = 0; i < 6; i++) F.leds.push(box(g, 4.75 + k, y + 0.4 + i * 0.32, Z0 + 1.01, 0.12, 0.05, 0.02, i % 2 ? '#22c55e' : '#38bdf8', { cast: false, mat: { emissive: i % 2 ? '#22c55e' : '#38bdf8', emissiveIntensity: 1 } }));
      box(g, 0.5, y + 0.005, 1.6, 6, 0.01, 0.35, '#8b5cf6', { cast: false, mat: { emissive: '#8b5cf6', emissiveIntensity: 0.3 } }); // main 레일
      F.mainLabel = label(g, 'main 레일 → 병합', 3.5, y + 0.15, 1.8, 'tag3d rail');
      plant(g, 6.3, 3.0, y);
    }
    if (f === 4) {
      F.zoneMonitors = []; F.zonePills = [];
      ZONES.forEach(([id, color], i) => {
        const x = -5.6 + i * 2.25;
        box(g, x - 1.05, y + 0.006, ROW - 1.6, 2.1, 0.01, 2.9, color, { cast: false, mat: { transparent: true, opacity: 0.22 } }); // 구역 러그
        F.zoneMonitors.push(desk(g, x, ROW, y, 2, color));
        F.zonePills.push(label(g, '', x, y + 0.05, ROW + 0.9, 'zone3d'));
        F.zonePills[i].element.style.setProperty('--c', color);
      });
      F.seats.dev = [-5.6, ROW - 0.9];
      plant(g, 6.3, 3.0, y);
    }
  }

  // 보드 그리기
  function drawWhiteboard(g2, c) {
    g2.fillStyle = '#ffffff'; g2.fillRect(0, 0, c.width, c.height);
    g2.fillStyle = '#334155'; g2.font = 'bold 22px sans-serif'; g2.fillText('기획 진행', 16, 30);
    const st = boardState?.stages ?? [];
    meta.stages.forEach((d, i) => {
      const s = st.find((x) => x.id === d.id)?.status;
      const x = 16 + i * ((c.width - 32) / meta.stages.length), w = (c.width - 32) / meta.stages.length - 8;
      g2.fillStyle = s === 'done' ? '#22c55e' : s === 'running' ? '#14b8a6' : s === 'failed' ? '#ef4444' : '#e2e8f0';
      g2.fillRect(x, 50, w, 50);
      g2.fillStyle = s && s !== 'todo' ? '#ffffff' : '#64748b'; g2.font = 'bold 15px sans-serif';
      g2.fillText(d.title.slice(0, 6), x + 6, 82);
    });
    g2.fillStyle = '#94a3b8'; g2.font = '15px sans-serif'; g2.fillText(boardState?.idea ? boardState.idea.slice(0, 40) : '2F 에 아이디어를 써 주세요', 16, 135);
  }
  function drawKanban(g2, c) {
    g2.fillStyle = '#fbfaf5'; g2.fillRect(0, 0, c.width, c.height);
    const cols = [['todo', '대기', '#cbd5e1'], ['dev', '개발', '#60a5fa'], ['test', '테스트', '#c084fc'], ['review', '리뷰', '#f87171'], ['done', 'main', '#4ade80']];
    const ts = boardState?.epics?.flatMap((e) => e.tickets) ?? [];
    const cw = (c.width - 20) / cols.length;
    cols.forEach(([k, name, color], i) => {
      const x = 10 + i * cw;
      g2.fillStyle = color; g2.fillRect(x + 4, 10, cw - 8, 26);
      g2.fillStyle = '#1f2937'; g2.font = 'bold 17px sans-serif'; g2.fillText(name, x + 12, 29);
      ts.filter((t) => t.status === k || (k === 'todo' && ['failed', 'skipped'].includes(t.status))).slice(0, 5).forEach((t, j) => {
        g2.fillStyle = t.status === 'failed' ? '#fecaca' : '#fff7c2'; g2.fillRect(x + 6, 46 + j * 30, cw - 12, 24);
        g2.fillStyle = '#334155'; g2.font = '13px sans-serif'; g2.fillText(`${t.id} ${t.title}`.slice(0, 11), x + 10, 63 + j * 30);
      });
    });
  }

  // ---------- 상태 반영 ----------
  const people = {}; // role → { sprite, tag, bubble, floor }
  let entered = null, lastKey = '';
  function render(state, selectedFloor, setupOk = true) {
    const act = state.activity ?? {};
    const ceoTurn = state.approvals.length > 0 || state.questions.some((q) => q.status === 'open') || (state.setupBlock?.length ?? 0) > 0;
    const all = state.epics.flatMap((e) => e.tickets);
    const curT = all.find((t) => ['dev', 'test', 'review'].includes(t.status));
    const curArea = curT?.area === '미상' ? '하네스' : curT?.area;
    const key = JSON.stringify([act, state.stages.map((x) => x.status), all.map((t) => t.status + t.area), ceoTurn, selectedFloor, setupOk, state.idea?.length]);
    if (key === lastKey) return; lastKey = key;
    boardState = state;
    floors[2]?.board?.redraw(); floors[3]?.board?.redraw();

    for (const fl of meta.floors) {
      const F = floors[fl.floor];
      const working = act.role && act.floor === fl.floor;
      const chip = working ? ['작업 중', FLOOR_COLORS[fl.floor]] : fl.floor === 1 && !setupOk ? ['설치 점검 필요', '#ef4444'] : fl.floor === 1 && ceoTurn ? [`${meta.roles.ceo.name} 차례`, '#ef4444'] : null;
      F.label.classList.toggle('on', selectedFloor === fl.floor);
      F.label.innerHTML = `<b style="background:${FLOOR_COLORS[fl.floor]}">${fl.floor}F</b><div><strong>${esc(fl.name)}</strong><small>${esc(fl.desc)}</small>${chip ? `<em style="--c:${chip[1]}">${chip[0]}</em>` : ''}</div>`;

      fl.roles.forEach((r) => {
        const role = meta.roles[r];
        let seat = F.seats[r];
        if (r === 'dev') { const zi = Math.max(0, ZONES.findIndex(([id]) => id === curArea)); seat = [-5.6 + zi * 2.25, ROW - 0.9]; }
        if (!seat) return;
        let p = people[r];
        if (!p) {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: catTexture(r, role.color) }));
          sp.center.set(0.5, 0); sp.scale.set(1.15, 1.15, 1);
          const tag = label(sp, esc(role.short ?? role.name.slice(0, 2)), 0, 1.25, 0, 'tag3d');
          const bubble = label(sp, '', 0, 1.75, 0, 'bubble3d');
          F.people.add(sp);
          p = people[r] = { sp, tag, bubble, goal: new THREE.Vector3() };
          p.sp.position.set(seat[0], base(fl.floor) + 0.45, seat[1]);
        }
        p.goal.set(seat[0], base(fl.floor) + 0.45, seat[1]);
        const active = r === 'ceo' ? ceoTurn : act.role === r;
        p.active = active;
        p.bubble.element.classList.toggle('off', !active);
        p.bubble.element.textContent = r === 'ceo' ? `${meta.roles.ceo.name} 차례입니다` : act.label ?? '';
        p.sp.material.opacity = !active && act.role && act.floor === fl.floor ? 0.6 : 1;
        p.sp.material.transparent = true;
        (F.monitors?.[r] ?? []).forEach((m) => { m.material = mat('#1f2937', { emissive: active ? '#38bdf8' : '#38bdf8', emissiveIntensity: active ? 0.9 : 0.05 }); });
      });
    }
    // 4F 구역
    const F4 = floors[4];
    if (F4) ZONES.forEach(([id, color], i) => {
      const ts = all.filter((t) => (t.area === '미상' ? '하네스' : t.area) === id), d = ts.filter((t) => t.status === 'done').length;
      const on = act.floor === 4 && curArea === id;
      F4.zonePills[i].element.textContent = ts.length ? `${id} ${d}/${ts.length}` : id;
      F4.zonePills[i].element.classList.toggle('on', on);
      F4.zoneMonitors[i].forEach((m) => { m.material = mat('#1f2937', { emissive: color, emissiveIntensity: on ? 1 : d && d === ts.length ? 0.35 : 0.05 }); });
    });
    // 엘리베이터: 층에 들어가 있으면 그 층, 아니면 지금 일하는 층
    const target = entered ?? (act.role ? act.floor : 1);
    if (target !== carFloor) { carFloor = target; for (const f in floors) floors[f].ind.redraw(carFloor); }
  }

  // ---------- 층 진입/전체 보기 ----------
  let camGoal = null;
  function enter(f) {
    if (!floors[f]) return;
    entered = f;
    for (const k in floors) floors[k].group.visible = Number(k) === f; // 그 층만 남겨 내부를 봅니다
    roof.visible = false;
    for (const r in people) people[r].sp.visible = true;
    setPolar(0.45, 1.5);
    const y = base(f);
    camGoal = { pos: new THREE.Vector3(-3.5, y + 11.5, 20.5), target: new THREE.Vector3(3, y + 0.6, -0.6) };
    carFloor = f; for (const k in floors) floors[k].ind.redraw(carFloor);
    container.classList.add('entered');
  }
  function exit() {
    entered = null;
    for (const k in floors) floors[k].group.visible = true;
    roof.visible = true;
    setPolar(0.95, 1.5);
    camGoal = { pos: HOME.pos.clone(), target: HOME.target.clone() };
    container.classList.remove('entered');
    onExit?.();
  }
  controls.addEventListener('start', () => { camGoal = null; });

  // ---------- 마우스: 클릭으로 층 진입, 올리면 강조 ----------
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let downAt = null, hoverF = null;
  const pickFloor = (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(scene.children, true).find((h) => h.object.visible && h.object.material !== glassMat);
    let o = hit?.object;
    while (o && o.userData.floor == null) o = o.parent;
    return o?.userData.floor ?? null;
  };
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const f = pickFloor(e);
    if (f && f !== entered) onFloor?.(f);
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    const f = pickFloor(e);
    if (f === hoverF) return;
    if (hoverF) floors[hoverF].edge.material = mat(FLOOR_COLORS[hoverF], { emissive: FLOOR_COLORS[hoverF], emissiveIntensity: 0.25 });
    hoverF = f;
    if (f) floors[f].edge.material = mat(FLOOR_COLORS[f], { emissive: FLOOR_COLORS[f], emissiveIntensity: 1.2 });
    renderer.domElement.style.cursor = f && f !== entered ? 'pointer' : 'grab';
  });

  // ---------- 크기·루프 ----------
  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h); labelRenderer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  const clock = new THREE.Clock();
  let raf = 0;
  function tick() {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime, k = 1 - Math.exp(-dt * 4);
    if (camGoal) {
      camera.position.lerp(camGoal.pos, k); controls.target.lerp(camGoal.target, k);
      if (camera.position.distanceTo(camGoal.pos) < 0.05) camGoal = null;
    }
    controls.update();
    // 엘리베이터 카 이동, 도착한 층 문 열기
    const cy = base(carFloor) + 0.02;
    car.position.y += (cy + 1.35 - car.position.y) * 0.06;
    const arrived = Math.abs(car.position.y - (cy + 1.35)) < 0.05;
    for (const k in floors) {
      const F = floors[k], f = Number(k);
      const want = arrived && f === carFloor && (entered === f || !entered) ? 1 : 0;
      F.doorOpen += (want - F.doorOpen) * 0.08;
      const o = F.doorOpen * (DOOR.w / 2 - 0.06);
      F.doors[0].position.x = DOOR.cx - DOOR.w / 4 - o; F.doors[1].position.x = DOOR.cx + DOOR.w / 4 + o;
      const sw = entered === f ? 1 : 0;
      F.sideOpen += (sw - F.sideOpen) * 0.08;
      F.side.rotation.y = -F.sideOpen * 1.3;
    }
    // 직원 움직임
    for (const r in people) {
      const p = people[r];
      p.sp.position.x += (p.goal.x - p.sp.position.x) * 0.05; p.sp.position.z += (p.goal.z - p.sp.position.z) * 0.05;
      const by = p.goal.y + (p.active ? Math.abs(Math.sin(t * 5)) * 0.12 : 0);
      p.sp.position.y += (by - p.sp.position.y) * 0.3;
    }
    floors[3]?.leds?.forEach((l, i) => { l.visible = Math.sin(t * 3 + i * 1.7) > -0.3; });
    renderer.render(scene, camera); labelRenderer.render(scene, camera);
  }
  tick();

  return {
    render, enter, exit,
    get entered() { return entered; },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); container.innerHTML = ''; },
  };
}
