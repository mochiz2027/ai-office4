// 설치 점검: 터미널(mwa doctor)과 1F 로비 카드가 같은 결과를 씁니다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const run = (cmd, args, timeout = 15000) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
};

/**
 * @returns {{checkedAt:string, ok:boolean, items:Array<{key,label,ok,required,detail,fix}>}}
 * ok = 필수 항목이 모두 통과했는지
 */
export function runChecks(projectDir, { engine = 'claude' } = {}) {
  const items = [];
  const add = (key, label, ok, required, detail, fix = '') => items.push({ key, label, ok: !!ok, required, detail, fix });
  const exists = (rel) => fs.existsSync(path.join(projectDir, rel));

  const major = Number(process.versions.node.split('.')[0]);
  add('node', 'Node.js 20 이상', major >= 20, true, process.version, 'nvm install 22');

  const git = run('git', ['--version']);
  add('git', 'git', git.ok, true, git.ok ? git.out : '설치되어 있지 않습니다', 'sudo apt install -y git');

  const needClaude = engine === 'claude';
  const cl = run('claude', ['--version']);
  add('claude', 'Claude Code CLI', cl.ok, needClaude, cl.ok ? cl.out : '설치되어 있지 않습니다', 'npm i -g @anthropic-ai/claude-code');
  if (cl.ok) {
    const st = run('claude', ['auth', 'status']);
    let logged = null, method = '';
    try { const j = JSON.parse(st.out); logged = !!j.loggedIn; method = j.authMethod ?? ''; } catch { /* 구버전 CLI */ }
    if (logged === null && (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN)) logged = true;
    if (logged === null) add('login', 'Claude 로그인', false, false, '확인할 수 없습니다(구버전 CLI) — 터미널에서 claude 를 한 번 실행해 확인하세요', 'claude');
    else add('login', 'Claude 로그인', logged, needClaude, logged ? `로그인됨${method ? ` (${method})` : ''}` : '로그인되어 있지 않습니다', 'claude  → 로그인 후 /exit');
  }

  const wsl = os.release().toLowerCase().includes('microsoft');
  add('os', '실행 환경', process.platform !== 'win32', false, process.platform === 'win32' ? 'Windows 직접 실행 — WSL 권장' : wsl ? 'WSL' : process.platform, 'wsl --install');
  add('apikey', 'API 키', true, false, process.env.ANTHROPIC_API_KEY ? '설정됨 — API 요금으로 과금됩니다' : '없음 — 구독 로그인으로 실행합니다');

  // 스타터 프로젝트 전용
  if (exists('pyproject.toml')) {
    const uv = run('uv', ['--version']);
    add('uv', 'uv (Python)', uv.ok, true, uv.ok ? uv.out : '설치되어 있지 않습니다', 'curl -LsSf https://astral.sh/uv/install.sh | sh && source ~/.bashrc');
    add('venv', 'Python 의존성', exists('.venv'), false, exists('.venv') ? '.venv 있음' : '아직 설치 전입니다', 'bash scripts/setup.sh');
  }
  if (exists('web/package.json')) {
    add('npm', '웹 의존성', exists('web/node_modules'), false, exists('web/node_modules') ? 'node_modules 있음' : '아직 설치 전입니다(타입 검사를 건너뜁니다)', 'bash scripts/setup.sh');
  }
  add('rules', 'AGENTS.md · CLAUDE.md', exists('AGENTS.md') && exists('CLAUDE.md'), false, exists('AGENTS.md') ? '있음' : '없음', 'mwa init');

  return { checkedAt: new Date().toISOString(), ok: items.every((i) => i.ok || !i.required), items };
}
