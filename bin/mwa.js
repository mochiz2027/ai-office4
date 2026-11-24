#!/usr/bin/env node
// mwa — 바이브코딩 사무실 CLI
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const [cmd = 'help', ...rest] = process.argv.slice(2);
const flag = (name, def) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? (rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : true) : def; };
const projectDir = path.resolve(flag('dir', process.cwd()));

async function init({ quiet, starter } = {}) {
  const { scaffold } = await import(path.join(ROOT, 'office/server/scaffold.js'));
  const r = scaffold(projectDir, { starter, version: pkg.version });
  if (!quiet) {
    for (const f of r.created) console.log(`  + ${f}`);
    if (r.skipped.length) console.log(`  = 이미 있어 그대로 둔 파일 ${r.skipped.length}개: ${r.skipped.slice(0, 8).join(', ')}${r.skipped.length > 8 ? ' …' : ''}`);
    console.log(`\n초기화했습니다: ${projectDir}${starter ? `  (스타터: ${starter})` : ''}`);
    if (starter) console.log('다음 단계: bash scripts/setup.sh  →  mwa up');
  }
  return r;
}

async function doctor() {
  const { runChecks } = await import(path.join(ROOT, 'office/server/doctor.js'));
  const r = runChecks(projectDir, { engine: flag('engine', 'claude') });
  for (const i of r.items) {
    const mark = i.ok ? '✅' : i.required ? '❌' : '⚠️ ';
    console.log(`${mark} ${i.label.padEnd(22)} ${i.detail}${!i.ok && i.fix ? `\n     → ${i.fix}` : ''}`);
  }
  console.log(r.ok ? '\n필수 항목을 모두 통과했습니다.' : '\n❌ 필수 항목이 빠져 있습니다. 위의 → 명령으로 고친 뒤 다시 점검하세요.');
  return r.ok;
}

function openBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : (os.release().toLowerCase().includes('microsoft') ? 'wslview' : 'xdg-open');
  try { spawn(opener, [url], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).on('error', () => {}).unref(); } catch { /* 무시 */ }
}

async function up() {
  const st = flag('starter', null);
  await init({ quiet: true, starter: st === true || st === 'none' ? null : st });
  let engine = flag('engine', 'claude');
  if (engine === 'claude' && spawnSync('claude', ['--version']).status !== 0) {
    console.log('⚠️  claude CLI 를 찾지 못해 mock(시연) 엔진으로 실행합니다. 이 상태에서는 실제 개발을 하지 않습니다.\n    `claude --version` 과 `mwa doctor` 로 확인한 뒤, 화면 위쪽 엔진 버튼으로 실제 개발로 바꾸세요.');
    engine = 'mock';
  }
  const { startServer } = await import(path.join(ROOT, 'office/server/server.js'));
  const { url, store } = await startServer({ projectDir, port: Number(flag('port', 4780)), host: flag('host', '127.0.0.1'), engine, model: flag('model') });
  const mode = flag('mode');
  if (mode === 'auto' || mode === 'manual') store.update((s) => { s.mode = mode; });
  console.log(`\n🏢  MWA 사무실이 열렸습니다 → ${url}`);
  console.log(`    프로젝트: ${projectDir}`);
  console.log(`    엔진: ${engine === 'claude' ? '실제 개발(Claude)' : '⚠️ 시연(mock) — 실제 개발 안 함'}  ·  모드: ${store.state.mode === 'auto' ? '자동' : '수동'}  ·  종료: Ctrl+C\n`);
  if (!flag('no-open', false)) openBrowser(url);
}

function status() {
  const f = path.join(projectDir, '.mwa', 'state.json');
  if (!fs.existsSync(f)) return console.log('아직 이 폴더에서 mwa up 을 실행한 적이 없습니다.');
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log(`단계: ${s.phase} · 모드: ${s.mode} · 활동: ${s.activity?.label}`);
  for (const st of s.stages) console.log(`  [${st.status}] ${st.id}`);
  for (const e of s.epics) console.log(`  ${e.id} ${e.title} (${e.status}) ${e.tickets.map((t) => `${t.id}:${t.status}`).join(' ')}`);
}

const help = `mwa ${pkg.version} — 바이브코딩 사무실

사용법:
  mwa up [--mode auto|manual] [--engine claude|mock] [--port 4780] [--model <id>] [--starter <이름>] [--no-open]
         현재 폴더에서 사무실 서버를 켜고 브라우저를 엽니다.
  mwa init [--starter nextjs-fastapi|none]
         프로젝트 골격을 만듭니다(기본: Next.js + FastAPI 스타터). 있는 파일은 덮어쓰지 않습니다.
  mwa doctor    설치 상태(Node, git, Claude Code, WSL)를 점검합니다.
  mwa status    현재 진행 상황을 터미널에 보여 줍니다.
  mwa version   버전을 표시합니다.
공통 옵션: --dir <프로젝트 폴더>`;

switch (cmd) {
  case 'up': await up(); break;
  case 'init': { const st = flag('starter', 'nextjs-fastapi'); await init({ starter: st === 'none' || st === true ? null : st }); break; }
  case 'doctor': process.exitCode = (await doctor()) ? 0 : 1; break;
  case 'status': status(); break;
  case 'version': case '--version': case '-v': console.log(pkg.version); break;
  default: console.log(help);
}
