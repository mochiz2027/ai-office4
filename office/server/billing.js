// 요금 청구 방지: 구독 로그인으로만 Claude 를 실행합니다.
// API 키·클라우드(Bedrock/Vertex)·외부 게이트웨이처럼 사용량만큼 돈이 나가는 경로는 막습니다.
import { spawnSync } from 'node:child_process';

/** 자식 프로세스에 넘기지 않는 환경변수(있으면 API 과금 경로로 실행될 수 있음) */
export const BILLED_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];

/** 구독 로그인으로 보는 인증 방식(이 목록 밖이면 안전하게 막습니다) */
const SUBSCRIPTION_AUTH = /^(oauth_token|claude\.?ai|claudeai|subscription|oauth)$/i;

export const allowApi = () => process.env.MWA_ALLOW_API === '1';

/** 과금 경로 환경변수를 뺀 실행 환경 */
export function safeEnv() {
  const env = { ...process.env };
  if (!allowApi()) for (const k of BILLED_ENV) delete env[k];
  return env;
}

/** `claude auth status` 로 구독 로그인인지 확인합니다. { ok, method, provider, reason } */
export function checkBilling() {
  if (allowApi()) return { ok: true, method: 'api 허용(MWA_ALLOW_API=1)', provider: '', reason: '' };
  const r = spawnSync('claude', ['auth', 'status'], { encoding: 'utf8', env: safeEnv(), timeout: 20000 });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { /* 구버전 */ }
  if (!j) return { ok: false, method: '', provider: '', reason: '로그인 방식을 확인할 수 없습니다(claude auth status). 요금 청구를 막기 위해 실행하지 않습니다.' };
  if (!j.loggedIn) return { ok: false, method: '', provider: j.apiProvider ?? '', reason: '로그인되어 있지 않습니다.' };
  const method = String(j.authMethod ?? ''), provider = String(j.apiProvider ?? '');
  if (provider && provider !== 'firstParty') return { ok: false, method, provider, reason: `클라우드 과금 경로(${provider})로 연결되어 있습니다.` };
  if (!SUBSCRIPTION_AUTH.test(method)) return { ok: false, method, provider, reason: `구독이 아닌 로그인 방식(${method || '알 수 없음'})입니다. API 요금이 청구될 수 있습니다.` };
  return { ok: true, method, provider, reason: '' };
}

let cache = { at: 0, v: null };
/** 에이전트 실행 직전 확인(5분 캐시) */
export function billingGuard() {
  if (Date.now() - cache.at > 5 * 60 * 1000 || !cache.v?.ok) cache = { at: Date.now(), v: checkBilling() };
  return cache.v;
}
