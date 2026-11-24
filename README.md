# MWA 사무실 (my-web-agency 스타일 독자 구현)

AI 에이전트들이 티켓을 하나씩 구현하는 빌드 과정을 **4층짜리 사무실 건물 화면**으로 보여 주는 개발 하네스입니다.
프로젝트 폴더에서 `mwa up` 을 실행하면 내 컴퓨터에 서버가 켜지고 브라우저가 열립니다.
2F 기획실에 만들고 싶은 것을 한 단락 쓰면 진행기가 **기획 → 에픽 다듬기 → 빌드 → 에픽 마무리 → 다음 에픽**까지 이어 갑니다.

> 공개 영상 설명과 화면 캡처만 보고 동작을 추정해 처음부터 새로 만든 구현입니다. 원본 저장소 코드는 사용하지 않았습니다.

## 건물 구성

| 층 | 이름 | 하는 일 | 직원(BMAD 역할) |
|---|---|---|---|
| 4F | 개발실 | 티켓 구현 + 테스트 작성 | 풀스택 개발자 |
| 3F | 운영실 | 티켓 보드 → 자동 테스트 → 리뷰 → main 반영, 에픽 다듬기/회고 | 스크럼 마스터, 자동 테스트, 코드 리뷰어 |
| 2F | 기획실 | 아이디어 → 브리프 → PRD → UX → 아키텍처 → 티켓 트리 → 개발 직전 점검 | 분석가, PM, UX 디자이너, 아키텍트, PO |
| 1F | 로비 · 대표실 | 사람(대표)의 자리. 승인·결정 대기 시 표시 | 대표(당신) |

## 빠른 시작

```bash
# 0) 준비: Node.js 20+, git, Claude Code CLI 로그인(구독 계정이면 API 키가 필요 없습니다)
npm i -g @anthropic-ai/claude-code && claude      # 최초 1회 로그인

# 1) 설치
tar -xzf mwa-0.1.0.tar.gz && bash mwa-0.1.0/install.sh

# 2) 실행
mkdir my-project && cd my-project
mwa init               # 폴더 골격 + Next.js/FastAPI 스타터 생성
bash scripts/setup.sh  # uv · npm 의존성 설치 (uv 가 없으면 설치 안내가 나옵니다)
mwa up                 # 자동 모드 (추천안대로 스스로 진행)
mwa up --mode manual   # 수동 모드 (단계마다 승인)
mwa up --engine mock   # Claude 없이 화면·흐름만 시연
```

Windows 는 WSL(Ubuntu) 안에서 실행하는 것을 권장합니다. `mwa doctor` 로 설치 상태를 점검할 수 있습니다.

## 화면

- **왼쪽 건물**: 지금 일하는 직원이 깜박이고 말풍선에 작업이 보입니다. 엘리베이터는 현재 작업 층으로 이동합니다. 층을 누르면 오른쪽 패널이 그 층으로 바뀝니다.
- **상세**: 층 정보 · 대화 · 메시지 입력 · **공백 장부**
- **진행**: 기획 단계, 에픽/티켓 상태, 결정 기록(자동 결정도 나중에 바꿀 수 있음)
- **로그**: 에이전트의 도구 사용까지 실시간 로그
- **검사기**: 기획 문서 열람, 상태 원본(JSON)

### 프로젝트 지도 (상단 칩)
상단의 **🗺 프로젝트 지도**를 누르면 지금 만드는 프로젝트를 한눈에 봅니다.
- 진행률: 기획 문서 7종, 티켓 완료 수, 에픽별 진행 막대
- 구역별 진행: 화면 · 권한 · 서버 · 데이터 · 배포 · 하네스 · 미상 — 티켓을 구역으로 나눠 보여 줍니다(PO 가 붙인 area, 없으면 키워드로 자동 분류)
- 화면 흐름(UX 단계), API 목록·데이터 모델(아키텍처 단계) — 관련 티켓 상태에 따라 완료/진행 중/대기로 표시
- 구역 칩(화면·서버 등)을 누르면 그 구역만 걸러 봅니다. 4F 개발실도 같은 구역 자리로 나뉘어 있고, 개발 고양이가 지금 티켓의 구역 자리로 이동합니다.

### 1F 설치 점검 카드
Node.js · git · Claude Code 설치/로그인 · uv · 의존성 · 규칙 파일 상태를 보여 주고, 빠진 항목에는 고치는 명령을 함께 표시합니다.
필수 항목이 빠져 있으면 **빌드를 시작하지 않고** 대표 차례로 올립니다. 고친 뒤 "다시 보기"를 누르면 이어서 진행합니다(터미널의 `mwa doctor` 와 같은 점검).

### 공백 장부(세 칸)
1. **꼭 채울 것** — 기획 문서 7종, AGENTS.md / CLAUDE.md, 테스트 명령
2. **확인 안 된 가정** — 에이전트가 근거 없이 세운 가정(맞음/틀림 표시 → 다음 지시에 반영)
3. **예정된 사람 차례** — 열린 질문, 승인 대기, 실패한 티켓(재시도/건너뛰기)

### 빌드 중 변경 요청
빌드 중에 3F/4F 로 메시지를 보내면 **변경 요청 티켓**이 되어, 진행 중인 티켓이 끝난 뒤 현재 에픽에 끼워 넣어집니다.

## 프로젝트 폴더 구조 (`mwa init`)

```
my-project/
├─ _bmad-output/
│  ├─ planning-artifacts/      기획 문서 01~07 (아이디어·브리프·PRD·UX·아키텍처·티켓·점검)
│  └─ implementation-artifacts/ 에픽 다듬기 메모, 회고
├─ .bmad-loop/loop.json        루프 설정: 티켓당 최대 시도, 테스트 제한 시간, 단계별 모델
├─ .claude/
│  ├─ settings.json            .env 읽기·.mwa 수정 금지 규칙
│  └─ skills/mwa-*/SKILL.md    역할별 스킬(분석가·PM·UX·아키텍트·PO·SM·개발·리뷰)
├─ .mwa/                       사무실 진행 상태·로그 (git 제외)
├─ api/                        FastAPI (app/main.py, routers/, tests/)
├─ web/                        Next.js 15 App Router + TypeScript
├─ infra/                      docker-compose 등 실행·배포 설정
├─ scripts/                    setup.sh · dev.sh · test.sh
├─ .env.example  .gitignore
├─ AGENTS.md  CLAUDE.md        에이전트 공통 규칙
├─ mwa-starter.json            스타터 정보(스택·명령·포트) — 진행기가 테스트 명령으로 사용
├─ pyproject.toml  uv.lock     Python 의존성(uv)
├─ skills-lock.json            설치된 스킬과 해시
└─ README.md
```

- `mwa init` 은 기본으로 Next.js + FastAPI 스타터를 만듭니다. 웹앱이 아니면 `mwa init --starter none` 으로 공통 골격만 만듭니다.
- 이미 있는 파일은 덮어쓰지 않고 건너뜁니다.
- 빌드 중 git: `main` + 티켓별 `mwa/T<n>` 브랜치 → 리뷰 승인 시 main 에 병합합니다.

## 개발

```bash
npm test          # 핵심 흐름 테스트 (mock 엔진)
npm run pack      # office/release/mwa-<버전>.tar.gz 생성
```

구조와 설계 판단은 `docs/` 의 설계서를 참고하세요.
