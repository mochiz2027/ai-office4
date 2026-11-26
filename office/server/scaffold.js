// 프로젝트 폴더 골격 생성기 (mwa init).
// 이미 있는 파일은 절대 덮어쓰지 않고 건너뜁니다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROLES } from './roles.js';

const OFFICE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS_SRC = path.join(OFFICE, 'agents');
export const STARTERS = fs.existsSync(path.join(OFFICE, 'starters')) ? fs.readdirSync(path.join(OFFICE, 'starters')) : [];
export const OUT = { planning: '_bmad-output/planning-artifacts', impl: '_bmad-output/implementation-artifacts' };

const RULES = `# 프로젝트 규칙 (MWA 사무실)

## 문서
- 기획 문서: \`${OUT.planning}/\` (01 아이디어 ~ 07 개발 직전 점검). 구현 전에 PRD(03)·UX(04)·아키텍처(05)·티켓(06)을 먼저 읽습니다.
- 에픽 메모·회고: \`${OUT.impl}/\`
- 스타터 정보: \`mwa-starter.json\` (있으면 그 스택·명령을 기본으로 따릅니다)

## 작성 규칙
- 모든 문서와 커밋 메시지는 한국어로 작성하고, 문서는 존댓말 보고체("~했습니다")를 씁니다.
- 확실하지 않은 수치는 추측하지 말고 [확인필요]로 표시합니다.
- 티켓 범위 밖의 변경은 하지 않습니다. 수용 기준마다 자동 테스트를 둡니다.

## 건드리지 않는 것
- \`.mwa/\` (사무실 진행 상태), \`.bmad-loop/\` (루프 설정 — 사람이 관리), \`.env\` (비밀값)
`;

const LOOP = {
  maxAttempts: 3,
  testTimeoutMin: 10,
  models: { plan: '', dev: '', review: '', chat: '' },
  note: '빈 값이면 claude 기본 모델을 씁니다. 예: "sonnet", "opus"',
};

const GITIGNORE = `.mwa/
.env
node_modules/
.venv/
__pycache__/
*.pyc
web/.next/
data/
`;

const CLAUDE_SETTINGS = {
  permissions: {
    deny: ['Read(./.env)', 'Edit(./.env)', 'Edit(./.mwa/**)', 'Edit(./.bmad-loop/**)'],
  },
};

function skillMd(key) {
  const role = ROLES[key];
  const body = fs.readFileSync(path.join(OFFICE, 'agents', role.prompt), 'utf8');
  return `---\nname: mwa-${key}\ndescription: MWA 사무실 ${role.floor}F ${role.name} 역할로 일할 때 사용합니다.\n---\n\n${body}\n${fs.readFileSync(path.join(OFFICE, 'agents', '_contract.md'), 'utf8')}`;
}

function copyTemplate(src, dest, vars, created, skipped, base) {
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name), d = path.join(dest, ent.name);
    if (ent.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyTemplate(s, d, vars, created, skipped, base); continue; }
    const rel = path.relative(base, d);
    if (fs.existsSync(d)) { skipped.push(rel); continue; }
    const isText = !/\.(png|jpg|ico|lock)$/.test(ent.name) || ent.name === 'uv.lock';
    let data = fs.readFileSync(s);
    if (isText && ent.name !== 'uv.lock') data = data.toString('utf8').replace(/\{\{name\}\}/g, vars.name);
    fs.writeFileSync(d, data, { mode: fs.statSync(s).mode });
    created.push(rel);
  }
}

/**
 * @param {string} dir 프로젝트 폴더
 * @param {{starter?: string|null, version?: string}} opt
 */
export function scaffold(dir, { starter = null, version = '0' } = {}) {
  const created = [], skipped = [];
  const name = path.basename(path.resolve(dir)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'my-app';
  const put = (rel, content) => {
    const p = path.join(dir, rel);
    if (fs.existsSync(p)) { skipped.push(rel); return; }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
    created.push(rel);
  };

  fs.mkdirSync(path.join(dir, '.mwa'), { recursive: true });
  put('AGENTS.md', RULES);
  put('CLAUDE.md', '@AGENTS.md\n');
  put('.gitignore', GITIGNORE);
  put(`${OUT.planning}/.gitkeep`, '');
  put(`${OUT.impl}/.gitkeep`, '');
  put('_bmad-output/README.md', `# _bmad-output\n\nBMAD 단계별 산출물이 쌓이는 폴더입니다.\n\n- planning-artifacts/: 아이디어·브리프·PRD·UX·아키텍처·티켓·점검 문서\n- implementation-artifacts/: 에픽 다듬기 메모와 회고\n`);
  put('.bmad-loop/loop.json', LOOP);
  // 역할별 페르소나(대표가 고치는 파일). 기본으로 개발자 페르소나를 넣습니다.
  for (const f of fs.readdirSync(path.join(AGENTS_SRC, 'personas'))) put(`.bmad-loop/personas/${f}`, fs.readFileSync(path.join(AGENTS_SRC, 'personas', f), 'utf8'));
  put('.bmad-loop/README.md', '# .bmad-loop\n\n진행기(기획 → 에픽 다듬기 → 빌드 → 에픽 마무리 → 다음 에픽) 루프 설정입니다.\n\n- `loop.json`: 티켓당 최대 시도 횟수, 테스트 제한 시간(분), 단계별 모델(models.plan / dev / review / chat, 예: "opus")\n- `personas/<역할>.md`: 역할별 페르소나. 파일이 있으면 그 역할의 지시문에 덧붙습니다. 역할 이름: analyst, pm, ux, architect, po, sm, reviewer, dev\n');
  put('.claude/settings.json', CLAUDE_SETTINGS);

  // 역할 프롬프트를 Claude Code 스킬로 설치하고 잠금 파일에 해시를 남깁니다.
  const lock = { version: 1, generatedBy: `mwa@${version}`, skills: {} };
  for (const key of Object.keys(ROLES).filter((k) => ROLES[k].prompt)) {
    const md = skillMd(key);
    put(`.claude/skills/mwa-${key}/SKILL.md`, md);
    lock.skills[`mwa-${key}`] = { source: `mwa@${version}`, path: `.claude/skills/mwa-${key}/SKILL.md`, sha256: crypto.createHash('sha256').update(md).digest('hex') };
  }
  put('skills-lock.json', lock);

  if (starter) {
    if (!STARTERS.includes(starter)) throw new Error(`알 수 없는 스타터: ${starter} (사용 가능: ${STARTERS.join(', ')})`);
    copyTemplate(path.join(OFFICE, 'starters', starter), dir, { name }, created, skipped, dir);
  }
  put('README.md', `# ${name}\n\nMWA 사무실로 개발하는 프로젝트입니다.\n\n\`\`\`bash\nmwa up        # 사무실 열기 (2F 기획실에 아이디어를 쓰면 시작)\n${starter ? 'bash scripts/setup.sh   # 의존성 설치\nbash scripts/dev.sh     # 웹 3000 / API 8000 실행\nbash scripts/test.sh    # 테스트\n' : ''}\`\`\`\n`);
  return { created, skipped, name };
}
