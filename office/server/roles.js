// 층 / 역할 / 기획 단계 정의. BMAD Method 의 4단계(분석·기획·솔루셔닝·구현)를 건물 층에 매핑했다.
export const FLOORS = [
  { floor: 1, name: '로비 · 대표실', desc: '세션 입장 · 대표(사람) 자리', roles: ['ceo'] },
  { floor: 2, name: '기획실', desc: '아이디어 → 기획 문서 → 티켓', roles: ['analyst', 'pm', 'ux', 'architect', 'po'] },
  { floor: 3, name: '운영실', desc: '티켓 보드 → 자동 테스트 → 리뷰 → main', roles: ['sm', 'qa', 'reviewer'] },
  { floor: 4, name: '개발실', desc: '풀스택 구현', roles: ['dev'] },
];

export const ROLES = {
  ceo: { name: '대표(당신)', short: '대표', floor: 1, color: '#f59e0b' },
  analyst: { name: '비즈니스 분석가', short: '분석', floor: 2, color: '#14b8a6', prompt: 'analyst.md' },
  pm: { name: '프로덕트 매니저', short: 'PM', floor: 2, color: '#0ea5e9', prompt: 'pm.md' },
  ux: { name: 'UX 디자이너', short: 'UX', floor: 2, color: '#a855f7', prompt: 'ux.md' },
  architect: { name: '아키텍트', short: '설계', floor: 2, color: '#6366f1', prompt: 'architect.md' },
  po: { name: '프로덕트 오너', short: 'PO', floor: 2, color: '#22c55e', prompt: 'po.md' },
  sm: { name: '스크럼 마스터', short: 'SM', floor: 3, color: '#eab308', prompt: 'sm.md' },
  qa: { name: '자동 테스트', short: 'QA', floor: 3, color: '#64748b' },
  reviewer: { name: '코드 리뷰어', short: '리뷰', floor: 3, color: '#ef4444', prompt: 'reviewer.md' },
  dev: { name: '풀스택 개발자', short: '개발', floor: 4, color: '#3b82f6', prompt: 'dev.md' },
};

// 2F 기획 단계 (순서대로 진행). doc 은 프로젝트 기준 상대경로.
export const PLANNING_STAGES = [
  { id: 'idea', role: 'analyst', title: '아이디어 다듬기', doc: 'docs/planning/01-idea.md',
    task: '대표가 쓴 아이디어 한 단락을 다듬어 문제·대상 사용자·핵심 가치·성공 기준을 정리합니다.' },
  { id: 'brief', role: 'analyst', title: '브리프 초안', doc: 'docs/planning/02-brief.md',
    task: '프로덕트 브리프를 작성합니다: 배경, 목표, 범위 안/밖, 이해관계자, 리스크, 일정 가정.' },
  { id: 'prd', role: 'pm', title: 'PRD 초안', doc: 'docs/planning/03-prd.md',
    task: 'PRD 를 작성합니다: 기능 요구사항(FR-번호), 비기능 요구사항(NFR-번호), MVP 범위, 완료 조건(Definition of Done), 제외 범위.' },
  { id: 'ux', role: 'ux', title: 'UX 문서(화면 설계)', doc: 'docs/planning/04-ux.md',
    task: '화면 목록, 화면별 구성 요소, 사용자 흐름, 상태(빈/로딩/오류)를 텍스트 와이어프레임으로 작성합니다.' },
  { id: 'arch', role: 'architect', title: '아키텍처 결정 · 스타터 추천', doc: 'docs/planning/05-architecture.md',
    task: '기술 스택, 폴더 구조, 데이터 모델, API 목록, 스타터 템플릿, 테스트 전략을 결정합니다. 반드시 JSON 의 testCommand 에 프로젝트 루트에서 실행할 테스트 명령을 넣으세요.' },
  { id: 'tickets', role: 'po', title: '티켓 트리 쪼개기', doc: 'docs/planning/06-tickets.md',
    task: '에픽 → 스토리(티켓) 트리로 쪼갭니다. 티켓마다 수용 기준을 붙이고, 첫 에픽은 프로젝트 골격·테스트 실행 환경부터 시작하세요. JSON 의 epics 필드에 트리를 넣으세요.' },
  { id: 'gate', role: 'architect', title: '개발 직전 자동 점검', doc: 'docs/planning/07-readiness.md',
    task: '구현 준비 상태를 점검합니다: PRD↔UX↔아키텍처↔티켓 간 누락/모순, 테스트 명령 실행 가능성. JSON 의 verdict 에 PASS / CONCERNS / FAIL 중 하나를 넣으세요.' },
];

export const stageById = (id) => PLANNING_STAGES.find((s) => s.id === id);
