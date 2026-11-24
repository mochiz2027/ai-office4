// 공백 장부: 빌드 전에 아직 정해지지 않은 것을 세 칸으로 보여 줍니다.
//  1) 꼭 채울 것   2) 확인 안 된 가정   3) 예정된 사람 차례
import fs from 'node:fs';
import path from 'node:path';
import { PLANNING_STAGES } from './roles.js';

export function computeLedger(state, projectDir) {
  const exists = (rel) => fs.existsSync(path.join(projectDir, rel));
  const mustFill = [];
  for (const s of PLANNING_STAGES) {
    const ok = exists(s.doc);
    mustFill.push({ key: `doc:${s.id}`, label: s.title, ok, detail: ok ? s.doc : '없음' });
  }
  mustFill.push({ key: 'rule:agents', label: 'AGENTS.md', ok: exists('AGENTS.md'), detail: exists('AGENTS.md') ? '있음' : '없음' });
  mustFill.push({ key: 'rule:claude', label: 'CLAUDE.md', ok: exists('CLAUDE.md'), detail: exists('CLAUDE.md') ? '있음' : '없음' });
  mustFill.push({ key: 'test', label: '테스트 명령', ok: !!state.testCommand, detail: state.testCommand || '아키텍처 단계에서 정합니다' });

  const assumptions = state.assumptions.filter((a) => !a.confirmed);

  const humanTurns = [];
  for (const q of state.questions) {
    if (q.status === 'open') humanTurns.push({ kind: 'question', id: q.id, text: q.q, blocking: true });
  }
  for (const a of state.approvals) humanTurns.push({ kind: 'approval', id: a.id, text: a.text, blocking: true });
  for (const s of state.stages) {
    if (s.status === 'failed') humanTurns.push({ kind: 'stage-failed', id: s.id, text: `기획 단계 실패: ${s.id} — ${s.error ?? ''}`, blocking: true });
  }
  for (const e of state.epics) for (const t of e.tickets) {
    if (t.status === 'failed') humanTurns.push({ kind: 'ticket-failed', id: t.id, text: `${t.id} ${t.title} — 재시도 한도를 넘었습니다`, blocking: true });
  }

  const missing = mustFill.filter((m) => !m.ok).length;
  return {
    checkedAt: new Date().toISOString(),
    readyToBuild: missing === 0 && humanTurns.every((h) => !h.blocking),
    mustFill, assumptions, humanTurns,
    counts: { mustFill: missing, assumptions: assumptions.length, humanTurns: humanTurns.length },
  };
}
