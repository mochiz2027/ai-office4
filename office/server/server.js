// 로컬 HTTP 서버: 정적 UI + JSON API + SSE(실시간 진행).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { Orchestrator } from './orchestrator.js';
import { computeLedger } from './ledger.js';
import { FLOORS, ROLES, PLANNING_STAGES, AREAS } from './roles.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

export function startServer({ projectDir, port = 4780, host = '127.0.0.1', engine = 'claude', model } = {}) {
  const store = new Store(projectDir);
  const orch = new Orchestrator(store, { engine, model });
  const clients = new Set();
  const send = (event, data) => { const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(msg); };
  const snapshot = () => ({ state: store.state, ledger: computeLedger(store.state, projectDir), meta: { projectDir, engine, busy: orch.busy }, setup: orch.setup ?? null });
  let pending = null;
  store.on('state', () => { if (!pending) pending = setTimeout(() => { pending = null; send('state', snapshot()); }, 80); });
  store.on('log', (e) => send('log', e));

  const readBody = (req) => new Promise((res) => { let b = ''; req.on('data', (d) => { b += d; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch { res({}); } }); });
  const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

  const routes = {
    'GET /api/meta': () => ({ floors: FLOORS, roles: ROLES, stages: PLANNING_STAGES, areas: AREAS.map(({ kw, ...a }) => a), projectDir, engine }),
    'GET /api/snapshot': () => snapshot(),
    'GET /api/logs': () => store.logs,
    'POST /api/message': (b) => orch.postMessage(Number(b.floor), b.text),
    'POST /api/mode': (b) => orch.setMode(b.mode),
    'POST /api/answer': (b) => orch.answer(b.id, b.answer),
    'POST /api/assumption': (b) => orch.confirmAssumption(b.id, b.ok !== false),
    'POST /api/approve': (b) => orch.approve(b.id, b.action, b.note),
    'POST /api/retry': (b) => orch.retry(b.kind, b.id),
    'POST /api/skip': (b) => orch.skipTicket(b.id),
    'POST /api/pause': () => orch.pause(),
    'POST /api/resume': () => orch.resume(),
    'POST /api/setup': () => orch.recheckSetup(),
    'POST /api/recheck': () => { store.save(); return computeLedger(store.state, projectDir); },
  };

  const server = http.createServer(async (req, res) => {
    // 다른 사이트가 로컬 서버를 조작하지 못하도록 같은 출처 요청만 허용합니다.
    const origin = req.headers.origin;
    if (req.method !== 'GET' && origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'forbidden origin' });
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (url.pathname === '/api/doc') { // 기획 문서 열람 (프로젝트 내부 .md 만)
        const rel = url.searchParams.get('path') ?? '';
        const abs = path.resolve(projectDir, rel);
        if (!abs.startsWith(path.resolve(projectDir) + path.sep) || !abs.endsWith('.md') || !fs.existsSync(abs)) return json(res, 404, { error: 'not found' });
        return json(res, 200, { path: rel, text: fs.readFileSync(abs, 'utf8') });
      }
      const h = routes[`${req.method} ${url.pathname}`];
      if (h) { const body = req.method === 'POST' ? await readBody(req) : {}; return json(res, 200, (await h(body)) ?? { ok: true }); }
      if (req.method !== 'GET') return json(res, 404, { error: 'not found' });
      const file = path.join(WEB, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([/\\])+/, ''));
      if (!file.startsWith(WEB) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });

  return new Promise((resolve) => server.listen(port, host, () => {
    // 서버가 다시 켜졌을 때 진행 중이던 단계를 이어서 합니다.
    store.update((s) => {
      for (const st of s.stages) if (st.status === 'running') st.status = 'todo';
      for (const e of s.epics) for (const t of e.tickets) if (['dev', 'test', 'review'].includes(t.status)) t.status = 'todo';
    });
    orch.recheckSetup();
    resolve({ server, store, orch, url: `http://${host}:${server.address().port}` });
  }));
}
