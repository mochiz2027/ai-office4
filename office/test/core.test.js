import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseContract } from '../server/engine.js';
import { Store } from '../server/store.js';
import { Orchestrator } from '../server/orchestrator.js';
import { computeLedger } from '../server/ledger.js';

test('parseContract: 마지막 json 블록을 읽는다', () => {
  const t = '설명\n```json\n{"a":1}\n```\n더\n```json\n{"summary":"ok","questions":[]}\n```';
  assert.equal(parseContract(t).summary, 'ok');
  assert.deepEqual(parseContract('없음'), {});
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mwa-'));
const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 50)); } };

test('자동 모드: mock 엔진으로 기획부터 모든 에픽까지 끝난다', async () => {
  process.env.MWA_MOCK_DELAY = '5';
  const dir = tmp();
  const store = new Store(dir);
  const orch = new Orchestrator(store, { engine: 'mock' });
  orch.postMessage(2, '테스트 아이디어');
  await until(() => store.state.phase === 'done');
  assert.ok(store.state.epics.every((e) => e.status === 'done'));
  assert.ok(store.state.questions.every((q) => q.status === 'auto'));
  const l = computeLedger(store.state, dir);
  assert.equal(l.mustFill.filter((m) => m.key.startsWith('doc:') && !m.ok).length, 0);
});

test('수동 모드: 승인 전에는 다음 단계로 넘어가지 않는다', async () => {
  process.env.MWA_MOCK_DELAY = '5';
  const dir = tmp();
  const store = new Store(dir);
  store.state.mode = 'manual';
  const orch = new Orchestrator(store, { engine: 'mock' });
  orch.postMessage(2, '아이디어');
  await until(() => store.state.approvals.length === 1 && !orch.busy);
  assert.equal(store.state.stages[1].status, 'todo');
  orch.approve(store.state.approvals[0].id);
  await until(() => store.state.stages[1].status === 'done');
});

test('빌드 중 3F 메시지는 변경 요청 티켓이 된다', async () => {
  process.env.MWA_MOCK_DELAY = '30';
  const dir = tmp();
  const store = new Store(dir);
  const orch = new Orchestrator(store, { engine: 'mock' });
  orch.postMessage(2, '아이디어');
  await until(() => store.state.phase === 'building');
  orch.postMessage(3, '버튼 색을 바꿔 주세요');
  await until(() => store.state.phase === 'done', 30000);
  const cr = store.state.epics.flatMap((e) => e.tickets).find((t) => t.cr);
  assert.ok(cr && cr.status === 'done');
});

test('scaffold: 스타터 골격을 만들고 기존 파일은 덮어쓰지 않는다', async () => {
  const { scaffold } = await import('../server/scaffold.js');
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '내 규칙');
  const r = scaffold(dir, { starter: 'nextjs-fastapi', version: 't' });
  for (const f of ['api/app/main.py', 'web/package.json', 'uv.lock', 'mwa-starter.json', 'skills-lock.json', '.bmad-loop/loop.json', '.claude/skills/mwa-dev/SKILL.md'])
    assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), '내 규칙');
  assert.ok(r.skipped.includes('AGENTS.md'));
  assert.ok(!fs.readFileSync(path.join(dir, 'web/app/page.tsx'), 'utf8').includes('{{name}}'));
  const store = new Store(dir);
  new Orchestrator(store, { engine: 'mock' });
  assert.equal(store.state.testCommand, 'bash scripts/test.sh');
});

test('설치 점검: 필수 항목이 빠지면 빌드를 시작하지 않는다', async () => {
  const dir = tmp();
  const bin = tmp();
  const which = (c) => (process.env.PATH.split(':').map((d) => path.join(d, c)).find((p) => fs.existsSync(p)));
  fs.symlinkSync(which('git'), path.join(bin, 'git')); // claude 는 일부러 빼 둡니다
  const oldPath = process.env.PATH;
  process.env.PATH = bin;
  try {
    const store = new Store(dir);
    store.update((s) => { s.phase = 'building'; s.epics = [{ id: 'E1', title: 'x', status: 'active', tickets: [{ id: 'T1', title: 't', desc: '', acceptance: [], status: 'todo', attempts: 0 }] }]; });
    const orch = new Orchestrator(store, { engine: 'claude' });
    orch.kick();
    await until(() => !orch.busy);
    assert.deepEqual(store.state.setupBlock, ['Claude Code CLI']);
    assert.equal(store.state.epics[0].tickets[0].status, 'todo');
    assert.ok(computeLedger(store.state, dir).humanTurns.some((h) => h.kind === 'setup'));
  } finally { process.env.PATH = oldPath; }
});
