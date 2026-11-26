// 진행기: 기획 → 에픽 다듬기 → 빌드(개발→테스트→리뷰→main) → 에픽 마무리 → 다음 에픽.
// 자동 모드는 추천안대로 스스로 진행하고, 수동 모드는 단계마다 사람에게 묻습니다.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PLANNING_STAGES, ROLES, stageById, classifyArea } from './roles.js';
import { runAgent, hasClaude } from './engine.js';
import { runChecks } from './doctor.js';

const AGENTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'agents');
const MAX_ATTEMPTS = 3;
/** 직원 판단을 못 받았을 때 쓰는 간단한 질문 판별 */
export const looksLikeQuestion = (t) => /[?？]\s*$/.test(t.trim()) || /(확인해|알려|궁금|뭐야|뭐지|어때|되나|되는지|됐어|됐나|할까|인가요|나요\??$|건가)/.test(t);
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

export class Orchestrator {
  constructor(store, { engine = 'claude', model } = {}) {
    this.store = store;
    this.engine = engine;
    this.model = model;
    this.cwd = store.projectDir;
    this.busy = false;
    this.abort = null;
    const starter = readJson(path.join(this.cwd, 'mwa-starter.json'));
    if (starter?.commands?.test && !store.state.testCommand) store.update((s) => { s.testCommand = starter.commands.test; });
  }

  /** .bmad-loop/loop.json (없으면 기본값) */
  get loop() {
    const l = readJson(path.join(this.cwd, '.bmad-loop', 'loop.json')) ?? {};
    return { maxAttempts: l.maxAttempts ?? MAX_ATTEMPTS, testTimeoutMin: l.testTimeoutMin ?? 10, models: l.models ?? {} };
  }

  get s() { return this.store.state; }
  log(text, extra = {}) { return this.store.log({ text, ...extra }); }

  // ---------- 사람 쪽 입력 ----------
  postMessage(floor, text) {
    text = String(text ?? '').trim();
    if (!text) return;
    this.store.update((s) => s.messages.push({ floor, from: 'ceo', text, ts: new Date().toISOString() }));
    this.log(`대표 → ${floor}F: ${text}`, { floor, role: 'ceo' });
    let route = '';

    const phase = this.s.phase;
    if (phase === 'idle') {
      // 시작 전: 어느 층에 쓰든 아이디어로 받아 2F 기획을 시작합니다.
      this.store.update((s) => { s.idea = text; s.phase = 'planning'; });
      route = '시작 전이라 이 내용을 프로젝트 아이디어로 받아 2F 기획(아이디어 → 브리프 → PRD → UX → 설계 → 티켓)을 시작했습니다.';
      this.log('아이디어를 받아 2F 기획 세션을 시작했습니다.', { floor: 2 });
    } else if (phase === 'planning' || (phase === 'paused' && this.s.resumePhase === 'planning')) {
      // 기획 중: 다음 기획 단계 프롬프트에 그대로 들어갑니다(최근 메시지).
      route = '기획 진행 중이라 이 내용을 기획 지시로 받아 다음 기획 단계부터 문서에 반영합니다.';
      this.log('기획 지시로 접수했습니다. 다음 기획 단계부터 반영합니다.', { floor: 2 });
    } else {
      // 기획이 끝난 뒤: 담당 직원이 먼저 읽고, 작업 지시면 변경 요청 티켓으로 만들어 개발까지 진행합니다. 질문이면 답만 합니다.
      route = 'AFTER_PLAN';
    }
    this.kick();
    this.#reply(floor, text, route);
  }

  /** 실행 엔진 전환: claude(실제 개발) / mock(시연) */
  setEngine(engine) {
    if (!['claude', 'mock'].includes(engine)) return { ok: false, error: '알 수 없는 엔진입니다.' };
    if (engine === 'claude' && !hasClaude()) return { ok: false, error: 'claude CLI 를 찾지 못했습니다. 터미널에서 `claude --version` 과 `mwa doctor` 로 확인해 주세요.' };
    this.engine = engine;
    this.setup = null; // 설치 점검을 새 엔진 기준으로 다시 합니다.
    this.recheckSetup?.();
    this.log(engine === 'claude' ? '실제 Claude 엔진으로 전환했습니다. 이제 직원들이 실제로 문서를 쓰고 코드를 개발합니다.' : '시연(mock) 엔진으로 전환했습니다. 실제 개발은 하지 않습니다.', { floor: 1, level: engine === 'mock' ? 'warn' : undefined });
    this.store.save();
    return { ok: true, engine };
  }

  setMode(mode) {
    if (!['auto', 'manual'].includes(mode)) return;
    this.store.update((s) => {
      s.mode = mode;
      if (mode === 'auto') { // 자동 전환 시 열린 질문은 추천안으로, 승인 대기는 통과 처리
        for (const q of s.questions) if (q.status === 'open') Object.assign(q, { status: 'auto', answer: q.options?.[q.recommended] ?? '추천안' });
        s.approvals = [];
      }
    });
    this.log(`모드를 ${mode === 'auto' ? '자동' : '수동'}으로 바꿨습니다.`);
    this.kick();
  }

  answer(id, answer) {
    this.store.update((s) => {
      const q = s.questions.find((x) => x.id === id);
      if (q) Object.assign(q, { answer, status: 'answered' });
    });
    this.log(`결정: ${id} → ${answer}`, { role: 'ceo' });
    this.kick();
  }

  confirmAssumption(id, ok = true) {
    this.store.update((s) => {
      const a = s.assumptions.find((x) => x.id === id);
      if (a) { a.confirmed = true; a.rejected = !ok; }
    });
    this.kick();
  }

  /** 승인 대기(수동 모드) 처리. action: approve | redo */
  approve(id, action = 'approve', note = '') {
    const a = this.s.approvals.find((x) => x.id === id);
    if (!a) return;
    this.store.update((s) => {
      s.approvals = s.approvals.filter((x) => x.id !== id);
      if (action === 'redo' && a.kind === 'stage') {
        const st = s.stages.find((x) => x.id === a.ref);
        Object.assign(st, { status: 'todo', feedback: note });
      }
      if (a.kind === 'build' && action === 'approve') s.phase = 'building';
    });
    this.log(`승인: ${a.text} → ${action}`, { role: 'ceo' });
    this.kick();
  }

  retry(kind, id) {
    this.store.update((s) => {
      if (kind === 'stage') { const st = s.stages.find((x) => x.id === id); if (st) st.status = 'todo'; }
      if (kind === 'ticket') for (const e of s.epics) for (const t of e.tickets) if (t.id === id) Object.assign(t, { status: 'todo', attempts: 0 });
      if (s.phase === 'error') s.phase = s.epics.length ? 'building' : 'planning';
    });
    this.kick();
  }

  skipTicket(id) {
    this.store.update((s) => { for (const e of s.epics) for (const t of e.tickets) if (t.id === id) t.status = 'skipped'; });
    this.kick();
  }

  pause() {
    if (!['planning', 'building'].includes(this.s.phase)) return;
    this.store.update((s) => { s.resumePhase = s.phase; s.phase = 'paused'; });
    this.abort?.abort();
    this.log('일시정지했습니다. 진행 중이던 작업은 재개 시 처음부터 다시 합니다.');
  }

  resume() {
    if (this.s.phase !== 'paused') return;
    this.store.update((s) => { s.phase = s.resumePhase ?? 'planning'; });
    this.log('재개했습니다.');
    this.kick();
  }

  // ---------- 루프 ----------
  kick() {
    if (this.busy) return;
    this.busy = true;
    this.#loop().catch((e) => {
      this.log(`진행기 오류: ${e.message}`, { level: 'error' });
    }).finally(() => { this.busy = false; this.#setActivity(null); });
  }

  /** 설치 점검을 다시 하고, 막혀 있던 빌드를 풉니다. */
  recheckSetup() {
    this.setup = runChecks(this.cwd, { engine: this.engine });
    if (this.setup.ok && this.s.setupBlock?.length) {
      this.store.update((s) => { s.setupBlock = []; });
      this.log('설치 점검을 통과했습니다. 빌드를 이어 갑니다.', { floor: 1 });
    } else this.store.save();
    this.kick();
    return this.setup;
  }

  isBlocked() {
    const s = this.s;
    return (s.setupBlock?.length ?? 0) > 0 || s.approvals.length > 0 || s.questions.some((q) => q.status === 'open');
  }

  async #loop() {
    while (true) {
      const s = this.s;
      if (!['planning', 'building'].includes(s.phase) || this.isBlocked()) return;
      const did = s.phase === 'planning' ? await this.#stepPlanning() : await this.#stepBuilding();
      if (!did) return;
    }
  }

  // ---------- 기획 ----------
  async #stepPlanning() {
    const st = this.s.stages.find((x) => x.status !== 'done');
    if (!st) return this.#finishPlanning();
    if (st.status === 'failed') return false;
    await this.#runStage(st.id);
    return true;
  }

  #finishPlanning() {
    const gate = this.s.stages.find((x) => x.id === 'gate');
    if (gate.verdict === 'FAIL') {
      this.store.update((s) => s.approvals.push({ id: this.store.nextId('A', s.approvals), kind: 'stage', ref: 'gate',
        text: '개발 직전 점검이 FAIL 입니다. 문서를 고친 뒤 점검을 다시 하거나(재작성) 그대로 진행(승인)하세요.' }));
      // 승인하면 다음 루프에서 다시 여기로 오므로 verdict 를 덮어 둡니다.
      this.store.update((s) => { s.stages.find((x) => x.id === 'gate').verdict = 'FAIL-ACK'; });
      return false;
    }
    this.#ensureGit();
    if (this.s.mode === 'manual') {
      this.store.update((s) => { s.phase = 'ready'; s.approvals.push({ id: this.store.nextId('A', s.approvals), kind: 'build', ref: null, text: '기획이 끝났습니다. 빌드를 시작할까요?' }); });
      return false;
    }
    this.store.update((s) => { s.phase = 'building'; });
    this.log('기획을 마치고 빌드를 시작합니다.', { floor: 3 });
    return true;
  }

  async #runStage(id) {
    const def = stageById(id);
    this.store.update((s) => { Object.assign(s.stages.find((x) => x.id === id), { status: 'running', startedAt: new Date().toISOString() }); });
    this.#setActivity({ floor: 2, role: def.role, label: def.title });
    this.log(`${ROLES[def.role].name}: ${def.title} 시작`, { floor: 2, role: def.role });
    const stage = this.s.stages.find((x) => x.id === id);
    const prompt = this.#prompt(def.role, [
      `## 이번 작업: ${def.title}`, def.task,
      `결과 문서를 \`${def.doc}\` 에 작성(또는 덮어쓰기)하세요.`,
      stage.feedback ? `## 대표의 재작성 요청\n${stage.feedback}` : '',
    ]);
    try {
      const r = await this.#agent(def.role, 'plan', prompt, { stage: id, title: def.title, doc: def.doc, idea: this.s.idea });
      const c = r.contract;
      this.#absorb(c, id, 2);
      this.store.update((s) => {
        const x = s.stages.find((y) => y.id === id);
        Object.assign(x, { status: 'done', summary: c.summary ?? '', finishedAt: new Date().toISOString(), feedback: '' });
        if (id === 'arch' && c.testCommand) s.testCommand = c.testCommand;
        if (id === 'gate') x.verdict = c.verdict ?? 'CONCERNS';
        if (id === 'tickets' && Array.isArray(c.epics)) s.epics = this.#mkEpics(c.epics);
        s.blueprint ??= { screens: [], apis: [], entities: [] };
        if (Array.isArray(c.screens)) s.blueprint.screens = c.screens;
        if (Array.isArray(c.apis)) s.blueprint.apis = c.apis;
        if (Array.isArray(c.entities)) s.blueprint.entities = c.entities;
        if (s.mode === 'manual') s.approvals.push({ id: this.store.nextId('A', s.approvals), kind: 'stage', ref: id, text: `${def.title} 완료 — 확인 후 다음 단계로 넘어갈까요?` });
      });
      if (id === 'tickets' && !this.s.epics.length) this.#failStage(id, '티켓 트리(JSON epics)를 받지 못했습니다');
      this.log(`${def.title} 완료: ${c.summary ?? ''}`, { floor: 2, role: def.role });
    } catch (e) {
      if (this.s.phase === 'paused') { this.store.update((s) => { s.stages.find((x) => x.id === id).status = 'todo'; }); return; }
      this.#failStage(id, e.message);
    }
  }

  #failStage(id, msg) {
    this.store.update((s) => { Object.assign(s.stages.find((x) => x.id === id), { status: 'failed', error: msg }); });
    this.log(`단계 실패(${id}): ${msg}`, { level: 'error', floor: 2 });
  }

  #mkEpics(raw) {
    let n = 0;
    return raw.map((e, i) => ({
      id: `E${i + 1}`, title: e.title, status: 'todo',
      tickets: (e.tickets ?? []).map((t) => ({ id: `T${++n}`, title: t.title, desc: t.desc ?? '', acceptance: t.acceptance ?? [], area: classifyArea(t), status: 'todo', attempts: 0 })),
    }));
  }

  /** 에이전트 JSON 의 질문·가정을 상태에 흡수합니다. */
  #absorb(c, source, floor) {
    this.store.update((s) => {
      for (const q of c.questions ?? []) {
        const id = this.store.nextId('Q', s.questions);
        const rec = q.options?.[q.recommended ?? 0] ?? '추천안';
        const item = { id, source, floor, q: q.q, options: q.options ?? [], recommended: q.recommended ?? 0, why: q.why ?? '', status: 'open', answer: null };
        if (s.mode === 'auto') Object.assign(item, { status: 'auto', answer: rec });
        s.questions.push(item);
      }
      for (const a of c.assumptions ?? []) s.assumptions.push({ id: this.store.nextId('S', s.assumptions), text: a, source, confirmed: false });
    });
    for (const q of c.questions ?? []) this.log(`질문: ${q.q} (추천: ${q.options?.[q.recommended ?? 0] ?? '-'})`, { floor });
  }

  // ---------- 빌드 ----------
  async #stepBuilding() {
    const s = this.s;
    if (!this.setup?.ok) { // 빌드 직전 설치 점검: 필수 항목이 빠지면 시작하지 않습니다.
      this.setup = runChecks(this.cwd, { engine: this.engine });
      if (!this.setup.ok) {
        const miss = this.setup.items.filter((i) => i.required && !i.ok).map((i) => i.label);
        this.store.update((x) => { x.setupBlock = miss; });
        this.log(`설치 점검 미통과로 빌드를 멈췄습니다: ${miss.join(', ')} — 1F 로비의 설치 점검 카드를 확인하세요.`, { floor: 1, level: 'error' });
        return false;
      }
    }
    if (s.changeRequests.some((c) => c.status === 'pending')) { this.#applyChangeRequests(); return true; }
    const epic = s.epics.find((e) => e.status !== 'done');
    if (!epic) {
      this.store.update((x) => { x.phase = 'done'; });
      this.log('모든 에픽을 마쳤습니다. 🎉', { floor: 1 });
      return false;
    }
    this.store.update((x) => { x.currentEpic = epic.id; });
    if (epic.status === 'todo') { await this.#refineEpic(epic.id); return true; }
    const t = epic.tickets.find((x) => !['done', 'skipped'].includes(x.status));
    if (t?.status === 'failed') return false;
    if (t) { await this.#runTicket(epic.id, t.id); return true; }
    await this.#wrapEpic(epic.id);
    return true;
  }

  #applyChangeRequests() {
    this.store.update((s) => {
      const epic = s.epics.find((e) => e.status !== 'done') ?? (s.epics.push({ id: `E${s.epics.length + 1}`, title: '변경 요청', status: 'active', tickets: [] }), s.epics.at(-1));
      const used = new Set(s.epics.flatMap((e) => e.tickets.map((t) => t.id)));
      let n = s.epics.reduce((m, e) => m + e.tickets.length, 0);
      for (const c of s.changeRequests.filter((x) => x.status === 'pending')) {
        const idx = epic.tickets.findIndex((t) => t.status === 'todo');
        do n++; while (used.has(`T${n}`)); used.add(`T${n}`);
        const tk = c.spec ?? {};
        const t = { id: `T${n}`, title: `[변경] ${(tk.title ?? c.text).slice(0, 40)}`, desc: tk.desc ? `${tk.desc}\n\n(대표 원문) ${c.text}` : c.text,
          acceptance: tk.acceptance?.length ? tk.acceptance : ['대표의 변경 요청이 반영되었다'], status: 'todo', attempts: 0, cr: c.id };
        t.area = classifyArea(t);
        idx < 0 ? epic.tickets.push(t) : epic.tickets.splice(idx, 0, t);
        c.status = 'ticketed'; c.ticket = t.id;
      }
    });
    this.log('변경 요청을 티켓으로 만들어 현재 에픽에 끼워 넣었습니다.', { floor: 3, role: 'sm' });
  }

  async #refineEpic(epicId) {
    const epic = () => this.s.epics.find((e) => e.id === epicId);
    this.#setActivity({ floor: 3, role: 'sm', label: `${epicId} 에픽 다듬기` });
    this.log(`스크럼 마스터: ${epicId} ${epic().title} 다듬기`, { floor: 3, role: 'sm' });
    const prompt = this.#prompt('sm', [
      `## 이번 작업: 에픽 다듬기 (${epicId} ${epic().title})`,
      '현재 코드와 문서를 확인하고 아래 티켓의 순서·범위를 조정하세요. 바꿀 필요가 없으면 tickets 를 null 로 두세요.',
      '```json\n' + JSON.stringify(epic().tickets.map(({ title, desc, acceptance }) => ({ title, desc, acceptance })), null, 1) + '\n```',
      `결과 메모를 \`_bmad-output/implementation-artifacts/${epicId}.md\` 에 남기세요.`,
    ]);
    try {
      const r = await this.#agent('sm', 'plan', prompt, { refine: true, title: '에픽 다듬기' });
      this.#absorb(r.contract, epicId, 3);
      this.store.update((s) => {
        const e = s.epics.find((x) => x.id === epicId);
        if (Array.isArray(r.contract.tickets) && r.contract.tickets.length) {
          const base = e.tickets[0] ? Number(e.tickets[0].id.slice(1)) : 1;
          e.tickets = r.contract.tickets.map((t) => ({ id: '', title: String(t.title ?? '').replace(/^\s*T\d+(\.\d+)*[:.)]?\s+/, ''), desc: t.desc ?? '', acceptance: t.acceptance ?? [], area: classifyArea(t), status: 'todo', attempts: 0 }));
          e.tickets.forEach((t, i) => { t.id = i === 0 ? `T${base}` : `T${base}.${i}`; });
        }
        e.status = 'active';
      });
    } catch (e) {
      if (this.s.phase === 'paused') return;
      this.log(`에픽 다듬기 실패, 원래 티켓으로 진행합니다: ${e.message}`, { level: 'warn', floor: 3 });
      this.store.update((s) => { s.epics.find((x) => x.id === epicId).status = 'active'; });
    }
  }

  async #runTicket(epicId, ticketId) {
    const get = () => this.s.epics.find((e) => e.id === epicId).tickets.find((t) => t.id === ticketId);
    const setT = (patch) => this.store.update(() => Object.assign(get(), patch));
    const branch = `mwa/${ticketId}`;
    this.#git(['checkout', '-q', '-B', branch, 'main']);
    let feedback = get().feedback ?? '';

    const maxAttempts = this.loop.maxAttempts;
    while (get().attempts < maxAttempts) {
      setT({ status: 'dev', attempts: get().attempts + 1 });
      const t = get();
      // 1) 4F 개발
      this.#setActivity({ floor: 4, role: 'dev', label: `${t.id} 구현 (${t.attempts}회차)`, ticket: t.id });
      this.log(`개발자: ${t.id} ${t.title} 구현 ${t.attempts}회차`, { floor: 4, role: 'dev' });
      try {
        const r = await this.#agent('dev', 'dev', this.#prompt('dev', [
          `## 이번 티켓: ${t.id} ${t.title}`, t.desc,
          `### 수용 기준\n${t.acceptance.map((a) => `- ${a}`).join('\n')}`,
          `### 테스트 명령\n\`${this.s.testCommand || '(아직 없음 — 아키텍처 문서를 보고 정해 JSON testCommand 로 알려 주세요)'}\``,
          feedback ? `### 이전 시도에서 받은 피드백 (반드시 해결)\n${feedback}` : '',
        ]), { ticket: t, title: `${t.id} 구현` });
        this.#absorb(r.contract, t.id, 4);
        if (r.contract.testCommand && !this.s.testCommand) this.store.update((s) => { s.testCommand = r.contract.testCommand; });
      } catch (e) {
        if (this.s.phase === 'paused') { setT({ status: 'todo', attempts: get().attempts - 1 }); return; }
        feedback = `에이전트 실행 오류: ${e.message}`; setT({ feedback }); continue;
      }

      // 2) 3F 자동 테스트
      setT({ status: 'test' });
      this.#setActivity({ floor: 3, role: 'qa', label: `${t.id} 자동 테스트`, ticket: t.id });
      const test = await this.#runTests();
      setT({ lastTest: { ok: test.ok, tail: test.tail } });
      if (!test.ok) {
        feedback = `테스트 실패 (\`${this.s.testCommand}\`):\n${test.tail}`;
        setT({ feedback });
        this.log(`${t.id} 테스트 실패 → 개발실로 되돌립니다`, { floor: 3, role: 'qa', level: 'warn' });
        continue;
      }
      this.log(`${t.id} 테스트 통과`, { floor: 3, role: 'qa' });

      // 3) 3F 리뷰
      setT({ status: 'review' });
      this.#setActivity({ floor: 3, role: 'reviewer', label: `${t.id} 코드 리뷰`, ticket: t.id });
      this.#git(['add', '-A']);
      let verdict = 'APPROVE', fb = [];
      try {
        const r = await this.#agent('reviewer', 'review', this.#prompt('reviewer', [
          `## 리뷰 대상: ${t.id} ${t.title}`, `### 수용 기준\n${t.acceptance.map((a) => `- ${a}`).join('\n')}`,
          '`git diff --cached main` 으로 변경분을 확인하세요.',
        ]), { review: true, title: `${t.id} 리뷰` });
        verdict = r.contract.verdict ?? 'APPROVE';
        fb = r.contract.feedback ?? [];
      } catch (e) {
        if (this.s.phase === 'paused') { setT({ status: 'todo' }); return; }
        this.log(`리뷰 실행 오류, 테스트 통과 기준으로 진행합니다: ${e.message}`, { level: 'warn', floor: 3 });
      }
      if (verdict !== 'APPROVE') {
        feedback = `리뷰 요청 사항:\n${fb.map((x) => `- ${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n')}`;
        setT({ feedback });
        this.log(`${t.id} 리뷰 CHANGES → 개발실로 되돌립니다`, { floor: 3, role: 'reviewer', level: 'warn' });
        continue;
      }

      // 4) main 반영
      this.#git(['add', '-A']);
      this.#git(['commit', '-q', '--allow-empty', '-m', `${t.id}: ${t.title}`]);
      this.#git(['checkout', '-q', 'main']);
      const m = this.#git(['merge', '-q', '--no-ff', branch, '-m', `merge ${branch}`]);
      if (m.status !== 0) { this.#git(['merge', '--abort']); feedback = `main 병합 충돌: ${m.stderr}`; setT({ feedback }); this.#git(['checkout', '-q', branch]); continue; }
      setT({ status: 'done', feedback: '', doneAt: new Date().toISOString() });
      this.log(`${t.id} 리뷰 승인 → main 반영 완료`, { floor: 3, role: 'reviewer' });
      return;
    }
    // 재시도 한도 초과
    this.#git(['add', '-A']);
    this.#git(['commit', '-q', '--allow-empty', '-m', `WIP ${ticketId} (실패)`]);
    this.#git(['checkout', '-q', 'main']);
    setT({ status: 'failed' });
    this.log(`${ticketId} 재시도 ${maxAttempts}회 실패 — 대표 차례입니다(재시도/건너뛰기). 작업 내용은 ${branch} 브랜치에 남겼습니다.`, { level: 'error', floor: 3 });
  }

  async #wrapEpic(epicId) {
    const e = this.s.epics.find((x) => x.id === epicId);
    this.#setActivity({ floor: 3, role: 'sm', label: `${epicId} 에픽 마무리` });
    try {
      await this.#agent('sm', 'plan', this.#prompt('sm', [
        `## 이번 작업: 에픽 마무리(회고) — ${epicId} ${e.title}`,
        `완료 티켓: ${e.tickets.map((t) => `${t.id}(${t.status})`).join(', ')}`,
        `회고를 \`_bmad-output/implementation-artifacts/${epicId}-retro.md\` 에 작성하세요.`,
      ]), { title: '에픽 마무리', refine: true });
    } catch (err) {
      if (this.s.phase === 'paused') return;
      this.log(`회고 작성 실패(진행에는 영향 없음): ${err.message}`, { level: 'warn' });
    }
    this.#git(['add', '-A']);
    this.#git(['commit', '-q', '--allow-empty', '-m', `${epicId} 회고`]);
    this.store.update((s) => {
      s.epics.find((x) => x.id === epicId).status = 'done';
      if (s.mode === 'manual' && s.epics.some((x) => x.status !== 'done')) {
        s.approvals.push({ id: this.store.nextId('A', s.approvals), kind: 'epic', ref: epicId, text: `${epicId} 에픽을 마쳤습니다. 다음 에픽으로 넘어갈까요?` });
      }
    });
    this.log(`${epicId} 에픽 마무리 완료`, { floor: 3, role: 'sm' });
  }

  #addChangeRequest(floor, text, ticket) {
    const phase = this.s.phase;
    let cr;
    this.store.update((s) => {
      cr = { id: this.store.nextId('CR', s.changeRequests), text, floor, status: 'pending', spec: ticket?.title ? ticket : null };
      s.changeRequests.push(cr);
      if (s.phase === 'done') s.phase = 'building'; // 완료된 프로젝트도 다시 일을 시작합니다.
    });
    const when = { ready: '빌드를 승인하면 가장 먼저', building: '진행 중인 티켓이 끝나는 대로', paused: '재개하면', done: '지금 바로', error: '오류를 다시 시도하면' }[phase] ?? '곧';
    this.log(`변경 요청 ${cr.id}을(를) 접수했습니다. ${when} 티켓으로 만들어 개발합니다.`, { floor });
    this.kick();
    return cr;
  }

  // ---------- 대화: 대표 메시지에 담당 직원이 바로 답합니다 ----------
  static CHAT_ROLE = { 1: 'pm', 2: 'pm', 3: 'sm', 4: 'dev' };
  #chatChain = Promise.resolve();
  #reply(floor, text, route) {
    const role = Orchestrator.CHAT_ROLE[floor] ?? 'pm';
    this.store.update((s) => { s.chatPending = { ...(s.chatPending ?? {}), [floor]: role }; });
    this.#chatChain = this.#chatChain.then(() => this.#answerChat(floor, role, text, route)).catch(() => {});
    return this.#chatChain;
  }
  async #answerChat(floor, role, text, route) {
    const s = this.s, R = ROLES[role], afterPlan = route === 'AFTER_PLAN';
    const conv = s.messages.filter((m) => m.floor === floor).slice(-13, -1)
      .map((m) => `- ${m.from === 'ceo' ? '대표' : ROLES[m.from]?.name ?? m.from}: ${m.text.slice(0, 800)}`).join('\n');
    const stages = s.stages.map((x) => `${stageById(x.id)?.title ?? x.id}=${x.status}`).join(', ');
    const tickets = s.epics.flatMap((e) => e.tickets.map((t) => `${t.id} ${t.title} (${t.status})`)).slice(-15).join('\n');
    const docs = s.stages.filter((x) => x.status === 'done').map((x) => `- ${x.doc}`).join('\n');
    const prompt = [
      `당신은 "MWA 바이브코딩 사무실" ${floor}F의 ${R.name}입니다. 지금 대표(사람)와 채팅으로 대화하고 있습니다.`,
      this.#persona(role) && `## 당신의 페르소나 (대표 지정)\n${this.#persona(role)}`,
      '## 답변 규칙',
      '- 한국어 존댓말로, 대표에게 직접 말하듯 답합니다. 핵심을 먼저 말하고 길이는 3~12줄 정도로 합니다.',
      '- 필요하면 프로젝트 파일과 기획 문서를 읽어 근거를 확인합니다. 파일은 절대 수정하지 않습니다(작업은 사무실 진행기가 따로 합니다).',
      '- 대표가 정해야 할 것이 있으면 번호 목록으로 선택지를 주고 추천안을 밝힙니다.',
      '- 확실하지 않은 수치·사실은 추측하지 말고 [확인필요]로 표시합니다.',
      afterPlan ? null : '- JSON 블록은 쓰지 않습니다.',
      `## 프로젝트 상황\n- 단계: ${s.phase}\n- 아이디어: ${s.idea || '(아직 없음)'}\n- 기획 단계: ${stages}`,
      tickets && `## 최근 티켓\n${tickets}`,
      docs && `## 작성된 기획 문서\n${docs}`,
      conv && `## 이전 대화\n${conv}`,
      afterPlan ? `## 이 메시지의 처리 방식 (중요)\n기획은 끝났고 프로젝트 단계는 "${s.phase}"입니다. 대표의 메시지가 **무언가를 만들거나 고치라는 작업 지시**인지, **질문·확인 요청·잡담**인지 판단하세요.\n- 작업 지시이면: 답변에서 "티켓으로 만들어 개발·테스트·리뷰까지 진행하겠습니다"라고 알리고, 맨 끝 JSON 에 action "change" 와 개발자가 바로 작업할 수 있는 티켓을 적습니다.\n- 질문·확인 요청이면: 파일·문서·티켓 상태를 읽어 근거 있게 답하고, JSON 의 action 은 "none" 입니다. (예: "개발되는지 확인해 줘" → 현재 티켓·코드 상태를 확인해 보고)\n- 맨 끝에 아래 JSON 블록을 정확히 하나 붙입니다(대표에게는 보이지 않습니다).\n\`\`\`json\n{"action": "change", "ticket": {"title": "짧은 제목", "desc": "무엇을 어떻게 바꾸는지", "acceptance": ["완료 기준"]}}\n\`\`\`` : `## 이 메시지의 처리 방식 (시스템)\n${route}`,
      `## 대표의 새 메시지\n${text}`,
    ].filter(Boolean).join('\n\n');
    let answer, contract = {};
    try {
      const r = await runAgent({
        engine: this.engine, model: this.model || this.loop.models.chat || undefined, prompt, toolset: 'chat', cwd: this.cwd,
        runFile: path.join(this.store.dir, 'runs', `${Date.now()}-chat-${role}.jsonl`),
        mock: { chat: text, who: R.name, route, afterPlan }, onLog: () => {},
      });
      if (r.cost) this.store.update((x) => { x.costUsd = (x.costUsd ?? 0) + r.cost; });
      contract = r.contract ?? {};
      answer = String(r.text ?? '').replace(/```json[\s\S]*?```\s*$/, '').trim();
    } catch (e) {
      answer = `답변을 만들지 못했습니다(${e.message.slice(0, 120)}).`;
    }
    if (afterPlan) {
      // 직원 판단이 없으면(오류 등) 질문처럼 보이지 않는 한 작업 지시로 봅니다.
      const isChange = contract.action ? contract.action === 'change' : !looksLikeQuestion(text);
      if (isChange) {
        const cr = this.#addChangeRequest(floor, text, contract.ticket);
        answer = (answer ? answer + '\n\n' : '') + `**접수:** 변경 요청 ${cr.id}로 티켓을 만들어 개발·테스트·리뷰까지 진행합니다.`;
      } else if (!answer) answer = '질문으로 받았습니다. 티켓은 만들지 않았습니다.';
    } else if (!answer) answer = route;
    this.store.update((x) => {
      x.messages.push({ floor, from: role, text: answer, ts: new Date().toISOString() });
      const p = { ...(x.chatPending ?? {}) }; delete p[floor]; x.chatPending = p;
    });
  }

  /** 프로젝트별 페르소나: .bmad-loop/personas/<역할>.md (대표가 직접 고치는 파일, 에이전트는 수정 불가) */
  #persona(role) {
    try { return fs.readFileSync(path.join(this.cwd, '.bmad-loop', 'personas', `${role}.md`), 'utf8').trim(); } catch { return ''; }
  }

  // ---------- 공용 ----------
  #prompt(role, parts) {
    const s = this.s;
    const rolePrompt = fs.readFileSync(path.join(AGENTS_DIR, ROLES[role].prompt), 'utf8');
    const persona = this.#persona(role);
    const contract = fs.readFileSync(path.join(AGENTS_DIR, '_contract.md'), 'utf8');
    const decisions = s.questions.filter((q) => q.answer).map((q) => `- ${q.q} → **${q.answer}**${q.status === 'auto' ? ' (자동: 추천안)' : ''}`).join('\n');
    const rejected = s.assumptions.filter((a) => a.rejected).map((a) => `- (틀린 가정) ${a.text}`).join('\n');
    const msgs = s.messages.slice(-12).map((m) => `- [${m.floor}F ${m.from === 'ceo' || !m.from ? '대표' : ROLES[m.from]?.name ?? m.from}] ${m.text.slice(0, 600)}`).join('\n');
    const docs = s.stages.filter((x) => x.status === 'done').map((x) => `- ${x.doc}`).join('\n');
    return [
      rolePrompt, persona && `## 이 프로젝트에서 당신의 페르소나 (대표 지정)\n${persona}`, contract,
      `## 프로젝트 아이디어 (대표 원문)\n${s.idea}`,
      decisions && `## 지금까지 확정된 결정\n${decisions}`,
      rejected && `## 대표가 틀렸다고 표시한 가정\n${rejected}`,
      msgs && `## 대표와의 최근 대화\n${msgs}`,
      docs && `## 이미 작성된 기획 문서 (먼저 읽으세요)\n${docs}`,
      ...parts,
    ].filter(Boolean).join('\n\n');
  }

  async #agent(role, toolset, prompt, mock) {
    this.abort = new AbortController();
    const runFile = path.join(this.store.dir, 'runs', `${Date.now()}-${role}.jsonl`);
    const floor = ROLES[role].floor;
    const r = await runAgent({
      engine: this.engine, model: this.model || this.loop.models[toolset === 'review' ? 'review' : toolset] || undefined, prompt, toolset, cwd: this.cwd, runFile,
      signal: this.abort.signal, mock: { ...mock, idea: this.s.idea },
      onLog: (line) => this.log(line, { floor, role, agent: true }),
    });
    if (r.cost) this.store.update((s) => { s.costUsd = (s.costUsd ?? 0) + r.cost; });
    return r;
  }

  #runTests() {
    const cmd = this.s.testCommand;
    if (!cmd) return Promise.resolve({ ok: true, tail: '(테스트 명령 없음 — 통과로 간주)' });
    return new Promise((resolve) => {
      const child = spawn(cmd, { cwd: this.cwd, shell: true, env: { ...process.env, CI: '1' } });
      let out = '';
      const add = (d) => { out += d; if (out.length > 20000) out = out.slice(-20000); };
      child.stdout.on('data', add); child.stderr.on('data', add);
      const timer = setTimeout(() => child.kill('SIGKILL'), this.loop.testTimeoutMin * 60 * 1000);
      this.abort = new AbortController();
      this.abort.signal.addEventListener('abort', () => child.kill('SIGKILL'));
      child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, tail: out.slice(-3000) }); });
    });
  }

  #git(args) {
    const r = spawnSync('git', args, { cwd: this.cwd, encoding: 'utf8' });
    if (r.status !== 0 && !['merge'].includes(args[0])) this.log(`git ${args.join(' ')} 실패: ${r.stderr?.trim()}`, { level: 'warn' });
    return r;
  }

  #ensureGit() {
    if (!fs.existsSync(path.join(this.cwd, '.git'))) this.#git(['init', '-q', '-b', 'main']);
    const ig = path.join(this.cwd, '.gitignore');
    const cur = fs.existsSync(ig) ? fs.readFileSync(ig, 'utf8') : '';
    if (!cur.split('\n').includes('.mwa/')) fs.appendFileSync(ig, (cur && !cur.endsWith('\n') ? '\n' : '') + '.mwa/\nnode_modules/\n');
    const id = ['-c', 'user.name=MWA Office', '-c', 'user.email=mwa@localhost'];
    const head = spawnSync('git', ['rev-parse', '--verify', 'main'], { cwd: this.cwd });
    if (head.status !== 0) {
      this.#git(['checkout', '-q', '-B', 'main']);
      this.#git(['add', '-A']);
      this.#git([...id, 'commit', '-q', '--allow-empty', '-m', 'MWA: 기획 문서']);
    } else {
      this.#git(['add', '-A']);
      this.#git([...id, 'commit', '-q', '-m', 'MWA: 기획 문서']);
    }
    // 이후 커밋에서도 사용자 정보가 없을 수 있으므로 로컬 설정을 채워 둡니다.
    if (spawnSync('git', ['config', 'user.email'], { cwd: this.cwd }).status !== 0) {
      this.#git(['config', 'user.name', 'MWA Office']); this.#git(['config', 'user.email', 'mwa@localhost']);
    }
  }

  #setActivity(a) {
    this.store.update((s) => { s.activity = a ?? { floor: 1, role: null, label: this.isBlocked() ? '대표 차례' : '대기 중', ticket: null }; });
  }
}

export { PLANNING_STAGES };
