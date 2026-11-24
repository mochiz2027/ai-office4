// 프로젝트 폴더의 .mwa/state.json 을 읽고 쓰는 상태 저장소.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PLANNING_STAGES } from './roles.js';

export function freshState() {
  return {
    schema: 1,
    mode: 'auto', // auto: 추천안대로 진행, manual: 단계마다 사람에게 묻기
    phase: 'idle', // idle | planning | building | paused | done | error
    idea: '',
    stages: PLANNING_STAGES.map((s) => ({ id: s.id, status: 'todo', doc: s.doc, summary: '' })),
    epics: [],
    currentEpic: null,
    testCommand: '',
    questions: [],
    assumptions: [],
    messages: [],
    changeRequests: [],
    activity: { floor: 1, role: null, label: '대기 중', ticket: null },
    approvals: [], // 수동 모드 단계 승인 대기 { id, kind, ref, text }
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export class Store extends EventEmitter {
  constructor(projectDir) {
    super();
    this.projectDir = projectDir;
    this.dir = path.join(projectDir, '.mwa');
    this.file = path.join(this.dir, 'state.json');
    this.logFile = path.join(this.dir, 'log.jsonl');
    fs.mkdirSync(path.join(this.dir, 'runs'), { recursive: true });
    this.state = this.#load();
    this.logs = this.#loadLogs();
    this.seq = 0;
  }

  #load() {
    try {
      const s = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { ...freshState(), ...s };
    } catch {
      return freshState();
    }
  }

  #loadLogs() {
    try {
      return fs.readFileSync(this.logFile, 'utf8').trim().split('\n').filter(Boolean).slice(-500).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }

  save() {
    this.state.updatedAt = new Date().toISOString();
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
    this.emit('state', this.state);
  }

  update(fn) {
    fn(this.state);
    this.save();
  }

  log(entry) {
    const e = { ts: new Date().toISOString(), seq: ++this.seq, ...entry };
    this.logs.push(e);
    if (this.logs.length > 500) this.logs.shift();
    fs.appendFileSync(this.logFile, JSON.stringify(e) + '\n');
    this.emit('log', e);
    return e;
  }

  nextId(prefix, list) {
    let n = list.length + 1;
    while (list.some((x) => x.id === `${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  }
}
