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
