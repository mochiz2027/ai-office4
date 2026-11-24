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

const RULES = `# 프로젝트 규칙 (MWA 사무실)

- 기획 문서는 docs/planning/ 에 있습니다. 구현 전에 PRD(03), UX(04), 아키텍처(05), 티켓(06)을 먼저 읽습니다.
- 모든 문서와 커밋 메시지는 한국어로 작성합니다. 문서는 존댓말 보고체("~했습니다")를 씁니다.
- 확실하지 않은 수치는 추측하지 말고 [확인필요]로 표시합니다.
- 티켓 범위 밖의 변경은 하지 않습니다. 수용 기준마다 자동 테스트를 둡니다.
- .mwa/ 폴더는 사무실(하네스) 상태이므로 수정하지 않습니다.
`;

function init({ quiet } = {}) {
  fs.mkdirSync(path.join(projectDir, '.mwa'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'docs', 'planning'), { recursive: true });
  for (const f of ['AGENTS.md', 'CLAUDE.md']) {
    const p = path.join(projectDir, f);
    if (!fs.existsSync(p)) { fs.writeFileSync(p, f === 'CLAUDE.md' ? '@AGENTS.md\n' : RULES); if (!quiet) console.log(`  + ${f}`); }
    else if (!quiet) console.log(`  = ${f} (이미 있어 그대로 두었습니다)`);
  }
  if (!quiet) console.log(`초기화했습니다: ${projectDir}`);
}

function doctor() {
  const checks = [];
  const major = Number(process.versions.node.split('.')[0]);
  checks.push(['Node.js 20 이상', major >= 20, process.version]);
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  checks.push(['git', git.status === 0, git.stdout?.trim() || '설치 필요']);
  const cl = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  checks.push(['Claude Code CLI (claude)', cl.status === 0, cl.status === 0 ? cl.stdout.trim() : 'npm i -g @anthropic-ai/claude-code 후 claude 로 로그인']);
  const isWin = process.platform === 'win32';
  const wsl = os.release().toLowerCase().includes('microsoft');
  checks.push(['실행 환경', !isWin, isWin ? 'Windows 는 WSL(Ubuntu) 안에서 실행을 권장합니다' : wsl ? 'WSL' : process.platform]);
  checks.push(['ANTHROPIC_API_KEY', true, process.env.ANTHROPIC_API_KEY ? '설정됨(API 과금)' : '없음 — claude 로그인 구독으로 실행합니다']);
  for (const [name, ok, detail] of checks) console.log(`${ok ? '✅' : '❌'} ${name.padEnd(26)} ${detail}`);
  return checks.every(([, ok]) => ok);
}

function openBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : (os.release().toLowerCase().includes('microsoft') ? 'wslview' : 'xdg-open');
  try { spawn(opener, [url], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).on('error', () => {}).unref(); } catch { /* 무시 */ }
}

async function up() {
  init({ quiet: true });
  let engine = flag('engine', 'claude');
  if (engine === 'claude' && spawnSync('claude', ['--version']).status !== 0) {
    console.log('⚠️  claude CLI 를 찾지 못해 mock(시연) 엔진으로 실행합니다. `mwa doctor` 로 확인하세요.');
    engine = 'mock';
  }
  const { startServer } = await import(path.join(ROOT, 'office/server/server.js'));
  const { url, store } = await startServer({ projectDir, port: Number(flag('port', 4780)), host: flag('host', '127.0.0.1'), engine, model: flag('model') });
  const mode = flag('mode');
  if (mode === 'auto' || mode === 'manual') store.update((s) => { s.mode = mode; });
  console.log(`\n🏢  MWA 사무실이 열렸습니다 → ${url}`);
  console.log(`    프로젝트: ${projectDir}`);
  console.log(`    엔진: ${engine}  ·  모드: ${store.state.mode === 'auto' ? '자동' : '수동'}  ·  종료: Ctrl+C\n`);
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
  mwa up [--mode auto|manual] [--engine claude|mock] [--port 4780] [--model <id>] [--no-open]
         현재 폴더에서 사무실 서버를 켜고 브라우저를 엽니다.
  mwa init      AGENTS.md / CLAUDE.md / docs/planning 을 만듭니다.
  mwa doctor    설치 상태(Node, git, Claude Code, WSL)를 점검합니다.
  mwa status    현재 진행 상황을 터미널에 보여 줍니다.
  mwa version   버전을 표시합니다.
공통 옵션: --dir <프로젝트 폴더>`;

switch (cmd) {
  case 'up': await up(); break;
  case 'init': init(); break;
  case 'doctor': process.exitCode = doctor() ? 0 : 1; break;
  case 'status': status(); break;
  case 'version': case '--version': case '-v': console.log(pkg.version); break;
  default: console.log(help);
}
