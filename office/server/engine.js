// 에이전트 실행 엔진.
//  - claude: Claude Code CLI 의 headless 모드(`claude -p`)를 호출합니다. 로그인된 구독 계정을 쓰므로 API 키가 없어도 됩니다.
//  - mock  : Claude 없이 화면·흐름만 시연하는 가짜 엔진입니다.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function hasClaude() {
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** 응답 텍스트 맨 끝의 ```json 블록을 파싱합니다. */
export function parseContract(text) {
  if (!text) return {};
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  for (let i = blocks.length - 1; i >= 0; i--) {
    try { return JSON.parse(blocks[i][1]); } catch { /* 다음 후보 */ }
  }
  const brace = text.lastIndexOf('\n{');
  if (brace >= 0) { try { return JSON.parse(text.slice(brace)); } catch { /* 없음 */ } }
  return {};
}

// 테스트 실행만 허용하는 명령(리뷰어·스크럼 마스터도 테스트 결과를 직접 확인)
const TEST_CMDS = ['Bash(node --test:*)', 'Bash(npm test:*)', 'Bash(npm run test:*)', 'Bash(pytest:*)', 'Bash(uv run pytest:*)', 'Bash(bash scripts/test.sh:*)'];
const TOOLSETS = {
  plan: ['Read', 'Write', 'Edit', 'Glob', 'Grep', ...TEST_CMDS],
  // 리뷰·운영: 코드는 못 고치지만 테스트는 직접 돌려 확인할 수 있습니다.
  review: ['Read', 'Glob', 'Grep', 'Bash(git diff:*)', 'Bash(git status:*)', 'Bash(git log:*)', ...TEST_CMDS],
  dev: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
  chat: ['Read', 'Glob', 'Grep'], // 대화 답변: 읽기만
};

/**
 * @param {object} o
 * @param {'claude'|'mock'} o.engine
 * @param {string} o.prompt
 * @param {'plan'|'review'|'dev'} o.toolset
 * @param {string} o.cwd
 * @param {(line:string)=>void} o.onLog
 * @param {object} o.mock  mock 엔진용 힌트 { stage, ticket, doc }
 * @param {AbortSignal} o.signal
 * @param {string} [o.model]
 */
export function runAgent(o) {
  return o.engine === 'mock' ? runMock(o) : runClaude(o);
}

function runClaude({ prompt, toolset, cwd, onLog, signal, model, runFile }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'acceptEdits', '--allowedTools', TOOLSETS[toolset].join(',')];
    if (model) args.push('--model', model);
    const child = spawn('claude', args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = runFile ? fs.createWriteStream(runFile) : null;
    let buf = '', result = '', cost = 0, lastText = '';
    const onAbort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (d) => {
      out?.write(d);
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'assistant') {
          for (const c of ev.message?.content ?? []) {
            if (c.type === 'text' && c.text.trim()) { lastText = c.text; onLog(c.text.trim().slice(0, 400)); }
            if (c.type === 'tool_use') onLog(`🔧 ${c.name} ${summarizeInput(c.input)}`);
          }
        } else if (ev.type === 'result') {
          result = ev.result ?? lastText; cost = ev.total_cost_usd ?? 0;
          if (ev.is_error) onLog(`⚠️ 결과 오류: ${ev.subtype ?? ''}`);
        }
      }
    });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      out?.end();
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(new Error('중단되었습니다'));
      if (/Not logged in|Please run \/login|Invalid API key/i.test(result || lastText || err)) return reject(new Error('Claude 로그인이 되어 있지 않습니다. WSL 창에서 claude 를 실행해 /login 으로 로그인한 뒤 다시 시도해 주세요.'));
      if (code !== 0 && !result) return reject(new Error(`claude 종료 코드 ${code}: ${err.slice(-500)}`));
      resolve({ text: result || lastText, cost, contract: parseContract(result || lastText) });
    });
    child.stdin.end(prompt);
  });
}

function summarizeInput(input = {}) {
  const v = input.file_path ?? input.command ?? input.pattern ?? input.path ?? '';
  return String(v).slice(0, 160);
}

// ---------------- mock ----------------
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('중단되었습니다')); }, { once: true });
});

async function runMock({ cwd, onLog, signal, mock = {}, prompt, runFile }) {
  if (runFile && prompt) fs.writeFileSync(runFile, JSON.stringify({ type: 'mock-prompt', prompt }) + '\n'); // 시연 엔진도 받은 지시문을 남깁니다
  const delay = Number(process.env.MWA_MOCK_DELAY ?? 600);
  onLog(`(mock) ${mock.title ?? '작업'} 시작`);
  await sleep(delay, signal);
  const write = (rel, body) => {
    const p = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    onLog(`🔧 Write ${rel}`);
  };
  if (mock.chat) { // 대화 답변 (mock)
    await sleep(delay, signal);
    if (mock.afterPlan) {
      const q = /[?？]\s*$/.test(mock.chat.trim()) || /(확인해|알려|궁금|되는지|됐어|됐나|할까)/.test(mock.chat);
      const contract = q ? { action: 'none' } : { action: 'change', ticket: { title: String(mock.chat).slice(0, 30), desc: mock.chat, acceptance: ['요청이 반영되었다'] } };
      const text = `(mock) ${mock.who}입니다. ${q ? '질문으로 이해했습니다. 지금 상태를 확인해 답드립니다(시연 엔진이라 실제 확인은 하지 않습니다).' : '작업 지시로 이해했습니다. 티켓으로 만들어 개발·테스트·리뷰까지 진행하겠습니다.'}`;
      onLog('(mock) 답변 완료');
      return { text: text + '\n```json\n' + JSON.stringify(contract) + '\n```', cost: 0, contract };
    }
    const text = `(mock) ${mock.who}입니다. 말씀하신 "${String(mock.chat).slice(0, 60)}" 내용을 확인했습니다.\n\n**처리 방식:** ${mock.route}\n\n추가로 정하실 것이 있으면 이어서 말씀해 주세요.`;
    onLog('(mock) 답변 완료');
    return { text, cost: 0, contract: {} };
  }
  const contract = { summary: `(mock) ${mock.title} 을(를) 완료했습니다.`, questions: [], assumptions: [] };

  if (mock.stage) {
    write(mock.doc, `# ${mock.title}\n\n(mock 엔진이 만든 예시 문서입니다.)\n\n## 아이디어\n${mock.idea}\n`);
    if (mock.stage === 'prd') {
      contract.questions.push({ q: 'MVP 에 로그인 기능을 포함할까요?', options: ['포함', '제외(다음 에픽)'], recommended: 1, why: 'MVP 범위를 줄이기 위해서입니다.' });
      contract.assumptions.push('사용자는 PC 브라우저로 접속한다고 가정했습니다.');
    }
    if (mock.stage === 'arch') {
      contract.testCommand = 'node --test';
      contract.questions.push({ q: '백엔드 스택을 무엇으로 할까요?', options: ['Next.js 단독', 'Next.js + FastAPI'], recommended: 1, why: '데이터 처리 요구가 있어 분리가 유리합니다.' });
    }
    if (mock.stage === 'ux') contract.screens = [
      { name: '홈', route: '/', desc: '서비스 소개와 견적 요청 시작', next: ['견적 요청'] },
      { name: '견적 요청', route: '/quote/new', desc: '사진·치수 업로드 폼', next: ['요청 완료'] },
      { name: '요청 완료', route: '/quote/done', desc: '접수 번호 안내', next: [] },
      { name: '관리자 로그인', route: '/admin/login', desc: '관리자 인증', next: ['요청 목록'] },
      { name: '요청 목록', route: '/admin/quotes', desc: '접수된 견적 요청 관리', next: [] },
    ];
    if (mock.stage === 'arch') {
      contract.apis = [
        { method: 'POST', path: '/api/quotes', desc: '견적 요청 접수', auth: false },
        { method: 'GET', path: '/api/quotes', desc: '요청 목록(관리자)', auth: true },
        { method: 'POST', path: '/api/auth/login', desc: '관리자 로그인', auth: false },
      ];
      contract.entities = [
        { name: 'Quote', fields: ['id', 'name', 'phone', 'width_mm', 'height_mm', 'photo_url', 'status'] },
        { name: 'AdminUser', fields: ['id', 'email', 'password_hash'] },
      ];
    }
    if (mock.stage === 'tickets') {
      contract.epics = [
        { title: '프로젝트 골격', tickets: [
          { title: '저장소 골격과 테스트 환경', desc: '폴더 구조와 테스트 러너 설정', acceptance: ['테스트 명령이 통과한다'], area: '하네스' },
          { title: '홈 화면', desc: '첫 화면', acceptance: ['홈 화면이 렌더링된다'], area: '화면' } ] },
        { title: '견적 요청', tickets: [
          { title: 'Quote 모델과 저장', desc: '견적 요청 테이블', acceptance: ['저장된다'], area: '데이터' },
          { title: '견적 요청 API', desc: 'POST /api/quotes', acceptance: ['201 응답'] },
          { title: '견적 요청 화면', desc: '사진·치수 업로드 폼', acceptance: ['폼 제출이 된다'] } ] },
        { title: '관리자', tickets: [
          { title: '관리자 로그인', desc: 'JWT 인증', acceptance: ['로그인된다'] },
          { title: 'docker 배포 설정', desc: 'infra/docker-compose', acceptance: ['컨테이너가 뜬다'] } ] },
      ];
    }
    if (mock.stage === 'gate') contract.verdict = 'PASS';
  } else if (mock.ticket) {
    const slug = mock.ticket.id.toLowerCase();
    write(`src/${slug}.js`, `// ${mock.ticket.title}\nexport const done = true;\n`);
    write(`test/${slug}.test.js`, `import test from 'node:test';\nimport assert from 'node:assert';\nimport { done } from '../src/${slug}.js';\ntest('${slug}', () => assert.ok(done));\n`);
  } else if (mock.review) {
    contract.verdict = 'APPROVE';
    contract.feedback = [];
  } else if (mock.refine) {
    contract.tickets = null; // 변경 없음
  }
  await sleep(delay, signal);
  onLog(`(mock) 완료`);
  return { text: '```json\n' + JSON.stringify(contract) + '\n```', cost: 0, contract };
}
