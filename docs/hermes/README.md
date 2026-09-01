# 헤르메스(Hermes Agent) 사내 구축 가이드

빈 컴퓨터 한 대에 [Hermes Agent](https://hermes-agent.nousresearch.com/docs)를 설치하고,
엔진으로 Claude를 물린 뒤, 슬랙에서 **역할별 에이전트 여러 개 + 이들을 관리하는 총괄
에이전트**로 운영하기까지의 순서입니다.

문서 안의 명령과 설정 키는 Hermes 공식 문서(`NousResearch/hermes-agent`)에서 확인한
값입니다. 하드웨어 권장 사양처럼 문서에 없는 항목은 "권장"이라고 표시했습니다.

---

## 0. 전체 그림 먼저

```
        슬랙 워크스페이스
  #디자인      #마케팅      #퍼포먼스      #프로젝트-A
    │            │             │              │
  @디자인봇    @마케팅봇    @퍼포먼스봇     @헤르메스팀장
    │            │             │              │
    └────────────┴─────────────┴──────┬───────┘
                                      │  (칸반 보드로 업무 분배/회수)
        ┌─────────────────────────────┴──────────────────────────┐
        │  빈 컴퓨터 1대 (항상 켜둠)                              │
        │   Hermes 설치 + 프로필 4개(designer/marketer/perf/lead) │
        │   각 프로필 = 독립 config·메모리·스킬·슬랙 봇 토큰       │
        │   엔진: Anthropic Claude                                │
        └────────────────────────────────────────────────────────┘
```

핵심 개념 3가지만 잡으면 나머지는 조립입니다.

| 개념 | 뜻 | 이 회사에서의 쓰임 |
|---|---|---|
| **프로필(profile)** | 완전히 분리된 Hermes 홈 디렉터리(자체 `config.yaml`·`.env`·`SOUL.md`·메모리·스킬·세션) | 디자이너 / 마케터 / 퍼포먼스마케터 / 팀장 = 프로필 4개 |
| **게이트웨이(gateway)** | 슬랙 등 메신저에 붙는 상주 프로세스 | 프로필마다 하나씩(또는 멀티플렉싱으로 하나로) |
| **칸반(kanban)** | 모든 프로필이 공유하는 SQLite 업무 보드 | 팀장 에이전트가 카드를 만들어 각 역할에게 배정 |

> ⚠️ **프로필 하나에 프로세스 두 개를 붙이지 마세요.** 두 에이전트가 같은 Hermes 홈에
> 메모리를 동시에 쓰면 서로의 기억을 시스템 프롬프트로 되먹여 상태가 망가집니다.
> 에이전트 하나 = 프로필 하나가 원칙입니다.

---

## 1. 장비와 OS 준비

**하드웨어(권장)** — 모델 추론은 Anthropic 클라우드에서 도니 컴퓨터 사양은 크게 중요하지
않습니다. 메모리 16GB(최소 8GB), SSD 100GB 이상 여유, 유선 랜, 그리고 **절전·최대 절전
모드 해제**가 실제로 중요합니다. 상주 프로세스가 자면 슬랙 응답이 끊깁니다.

**OS 선택**

| 선택지 | 장점 | 주의 |
|---|---|---|
| **Ubuntu 22.04/24.04 LTS** (권장) | `hermes gateway install`이 systemd 서비스로 등록 → 부팅 시 자동 시작. `sudo loginctl enable-linger <user>`까지 하면 로그아웃해도 유지 | 사무실에서 익숙하지 않을 수 있음 |
| **Windows 10/11 네이티브** | 공식 Tier 1 지원, 설치 한 줄. 기존 사내 대시보드(이 저장소)와 같은 OS | 자동 시작이 `schtasks /SC ONLOGON` 기반이라 **자동 로그인 설정**이 사실상 필수. 대시보드의 임베디드 터미널 탭만 미지원 |
| Windows + WSL2 | POSIX 환경 그대로 | 관리 지점이 둘로 늘어남 |

이 저장소의 사내 Claude 대시보드가 이미 Windows에서 돌고 있다면 같은 컴퓨터에 얹어도
되지만, **가급적 별도 계정**(예: `hermesbot`)으로 설치해 파일 권한과 크리덴셜을 분리하세요.

---

## 2. Hermes 설치

**Linux / macOS / WSL2**

```bash
sudo apt install -y git curl xz-utils build-essential   # Ubuntu 기준 사전 준비
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
source ~/.bashrc
```

**Windows 네이티브 (PowerShell, 관리자 권한 불필요)**

```powershell
iex (irm https://hermes-agent.nousresearch.com/install.ps1)
```

설치 프로그램이 uv·Python 3.11·Node.js·PortableGit·ripgrep·ffmpeg까지 알아서 깔고
`hermes` 명령을 PATH에 등록합니다. 설치 후 새 터미널을 엽니다.

- 데이터 위치: Linux/macOS `~/.hermes/`, Windows `%LOCALAPPDATA%\hermes`
- 비밀값은 `~/.hermes/.env`, 일반 설정은 `~/.hermes/config.yaml`로 자동 분리 저장
- 점검 명령: `hermes doctor`

GUI 설치 파일(Hermes Desktop)도 있으니 비개발자에게 맡길 거면 그쪽이 편합니다.

---

## 3. 엔진으로 Claude 붙이기

```bash
hermes model        # 대화형 선택 → Anthropic
```

인증 방식은 두 가지입니다.

| 방식 | 조건 | 추천 상황 |
|---|---|---|
| **Anthropic API 키** (`ANTHROPIC_API_KEY`) | 종량제 과금, 조직 단위 한도·사용량 조회 가능 | **회사 상시 운영이면 이쪽** |
| **Claude OAuth** | **Claude Max 플랜 + 추가 사용량 크레딧 구매**가 있어야 동작. Pro 구독으로는 불가 | 개인이 잠깐 붙일 때 |

```bash
# API 키 방식
hermes config set ANTHROPIC_API_KEY sk-ant-...
```

`~/.hermes/config.yaml`:

```yaml
model:
  provider: "anthropic"
  default: "claude-opus-4.7"   # hermes model 목록에서 제공되는 최신 Opus/Sonnet 선택
```

- 모델 최소 컨텍스트 요구치는 **64K 토큰**입니다. Claude 계열은 모두 충족합니다.
- 목록이 최신 모델을 아직 안 보여주면 `hermes config set model.default anthropic/<모델ID>`로
  직접 지정할 수 있습니다. 업데이트는 `hermes update`.
- 비용 설계: **팀장(오케스트레이터)만 Opus, 실무 워커는 Sonnet급**으로 두는 게 정석입니다.
  토큰의 대부분은 워커가 씁니다. 어려운 카드만 카드별로 모델을 올려 쓰면 됩니다.

여기까지 하고 반드시 한 번 대화로 확인하세요. **CLI에서 정상 대화가 안 되면 슬랙을 붙여도
안 됩니다.**

```bash
hermes --tui
```

---

## 4. 역할별 에이전트(프로필) 만들기

```bash
hermes profile create lead    --description "업무를 쪼개 담당 에이전트에게 배정하는 총괄"
hermes profile create designer --description "브랜드/광고 소재 시안, 카피 레이아웃, 이미지 편집"
hermes profile create marketer --description "콘텐츠·SNS·뉴스레터 기획과 초안 작성"
hermes profile create perf     --description "광고 성과 데이터 분석, 리포트, 예산 제안"
```

프로필을 만들면 **같은 이름의 명령어가 자동 생성**됩니다.

```bash
designer setup          # 이 프로필의 모델·키·툴 설정
designer chat           # 이 프로필로 대화
designer gateway start  # 이 프로필의 슬랙 게이트웨이 기동
hermes -p designer doctor   # -p 플래그로도 동일
```

각 프로필에서 손볼 파일은 셋뿐입니다 (`~/.hermes/profiles/<이름>/`):

| 파일 | 역할 |
|---|---|
| `config.yaml` | 모델·툴셋·터미널 작업 폴더·슬랙 동작 |
| `.env` | 슬랙 봇 토큰, API 키 |
| `SOUL.md` | 정체성·말투·업무 원칙 (사람으로 치면 직무기술서) |

예시 파일을 [`examples/`](./examples)에 넣어 두었습니다. 그대로 복사해 쓰면 됩니다.

- 워커 프로필 설정: [`examples/worker-config.yaml`](./examples/worker-config.yaml)
- 총괄 프로필 설정: [`examples/lead-config.yaml`](./examples/lead-config.yaml)
- 역할 SOUL 예시: [`examples/SOUL.designer.md`](./examples/SOUL.designer.md),
  [`examples/SOUL.perf-marketer.md`](./examples/SOUL.perf-marketer.md)

> 프로필은 **격리 디렉터리이지 샌드박스가 아닙니다.** 기본 `local` 터미널 백엔드에서는
> 실행 계정 권한 전체에 접근할 수 있습니다. 작업 폴더를 고정하려면 `terminal.cwd`에
> 절대경로를 지정하세요(6장 보안 참고).

---

## 5. 슬랙 연결

### 5-1. 설계 선택 — 봇을 몇 개로 할 것인가

| | A안: 에이전트마다 슬랙 앱 1개 (권장) | B안: 슬랙 앱 1개 + 채널 라우팅 |
|---|---|---|
| 슬랙에서 보이는 모습 | `@디자인봇` `@마케팅봇` `@퍼포먼스봇` `@헤르메스팀장` | 봇 하나(`@헤르메스`)가 채널마다 다른 인격으로 응답 |
| 직원 경험 | 필요한 담당자를 지목하듯 멘션 → 직관적 | 방을 옮겨야 담당이 바뀜 |
| 운영 | 게이트웨이 프로세스 N개 | 프로세스 1개 (`gateway.multiplex_profiles: true`) |
| 추천 | **직원이 여러 명 쓰는 지금 상황** | 프로필이 아주 많거나 컨테이너 배포일 때 |

B안 설정은 [`examples/one-app-routing.yaml`](./examples/one-app-routing.yaml)에 있습니다.
아래는 A안 기준으로 설명합니다. 앱 하나를 먼저 만들어 성공시키고, 나머지는 같은 절차를 반복하세요.

### 5-2. 슬랙 앱 만들기 (에이전트당 1회)

1. **매니페스트 생성** — 필요한 권한·이벤트·슬래시 명령·소켓 모드를 한 번에 선언해 줍니다.
   ```bash
   hermes -p designer slack manifest --agent-view --write
   # → ~/.hermes/profiles/designer/slack-manifest.json
   ```
2. <https://api.slack.com/apps> → **Create New App → From an app manifest** → 워크스페이스
   선택 → 위 JSON 붙여넣기 → Create
3. **Socket Mode** 활성화 → App-Level Token 생성(`connections:write`) → `xapp-...` 복사
4. **App Home → Messages Tab 켜기** + "Allow users to send Slash commands and messages" 체크
   (이걸 빼면 DM이 아예 막힙니다)
5. **Install App → Install to Workspace** → Bot User OAuth Token `xoxb-...` 복사
6. 봇 이름/아이콘을 역할에 맞게 바꿔 두면 직원들이 헷갈리지 않습니다.

수동으로 만든다면 필요한 스코프는 `chat:write`, `app_mentions:read`, `channels:history`,
`channels:read`, `groups:history`, `im:history`, `im:read`, `im:write`, `mpim:history`,
`mpim:read`, `users:read`, `files:read`, `files:write`이고, 이벤트 구독은 `message.im`,
`message.mpim`, `message.channels`, `message.groups`, `app_mention`입니다.
**스코프나 이벤트를 바꾸면 반드시 앱을 재설치**해야 반영됩니다.

### 5-3. 토큰과 허용 사용자 넣기

`~/.hermes/profiles/designer/.env`:

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_ALLOWED_USERS=U01ABC2DEF3,U02XYZ...   # 슬랙 멤버 ID, 쉼표 구분
SLACK_HOME_CHANNEL=C0123456789              # 정기 리포트/알림 기본 채널
```

> **`SLACK_ALLOWED_USERS`는 필수입니다.** 비워 두면 게이트웨이가 안전장치로 모든 메시지를
> 거부합니다. 멤버 ID는 프로필 → ⋮ → "Copy member ID"로 얻습니다. 직원이 늘 때마다 추가하거나,
> 미등록 사용자가 DM하면 페어링 코드를 발급해 `hermes pairing approve slack <코드>`로 승인하는
> 방식도 됩니다.

`hermes -p designer gateway setup`으로 대화형 입력도 가능합니다.

### 5-4. 기동하고 초대하기

```bash
designer gateway run       # 우선 포그라운드로 연결 확인
designer gateway install   # 확인되면 서비스로 등록 (systemd / launchd / schtasks)
designer gateway start
```

슬랙 각 방에서 **직접 초대**해야 합니다. 봇은 자동으로 방에 들어가지 않습니다.

```
/invite @디자인봇
```

동작 규칙:
- **DM**: 멘션 없이 모든 메시지에 응답
- **채널**: `@멘션`했을 때만 응답하고, 그 메시지에 스레드로 답변
- **스레드**: 한 번 대화가 붙은 스레드에서는 멘션 없이도 이어서 응답

### 5-5. 방 단위로 성격 바꾸기 (직원과 같이 쓰는 방 세팅)

프로필의 `config.yaml`에서 채널별로 프롬프트와 스킬을 붙일 수 있습니다.

```yaml
slack:
  # 지정한 방 외에는 멘션당해도 조용히 무시 (봇을 여기저기 초대해 두고도 소음 방지)
  allowed_channels:
    - "C0123456789"   # #디자인
    - "C0987654321"   # #프로젝트-A

  channel_prompts:
    "C0123456789": |
      이 방은 디자인 리뷰방이다. 시안 피드백은 항상
      (1) 목적 적합성 (2) 가독성 (3) 브랜드 일관성 순으로 짚어라.

  channel_skill_bindings:
    - id: "C0987654321"
      skills:
        - creative-design-md

  # 사람끼리 대화 중 "@길동님 이거 봐주세요" 같은 메시지에 끼어들지 않게
  ignore_other_user_mentions: true
```

그 밖에 자주 쓰는 스위치:

| 설정 | 기본값 | 언제 쓰나 |
|---|---|---|
| `group_sessions_per_user` | `true` | 같은 방이라도 사람마다 대화 맥락 분리. 팀이 하나의 맥락을 공유하게 하려면 `false` |
| `slack.strict_mention` | `false` | 바쁜 방에서 매 턴 명시적 멘션을 강제 |
| `slack.free_response_channels` | 없음 | 특정 방에서는 멘션 없이도 응답 |
| `slack.allow_bots` | `none` | **에이전트끼리 대화시키려면 `mentions`** (아래 참고) |

---

## 6. 총괄 에이전트와 하위 에이전트 구조

관리 계층은 성격이 다른 두 가지를 겹쳐 씁니다. 둘 다 씁니다 — 용도가 다릅니다.

### 6-1. 즉석 위임 — `delegate_task` (같은 에이전트 안의 일회성 하위 작업)

한 에이전트가 조사를 병렬로 돌리거나 리뷰를 시킬 때 씁니다. 자식은 익명이고, 새 대화창에서
시작하며, **최종 요약만** 부모 맥락으로 돌아옵니다.

```yaml
delegation:
  max_concurrent_children: 3   # 동시 자식 수
  max_spawn_depth: 1           # 1=평면, 2 이상은 오케스트레이터형 중첩 (비용 곱연산 주의)
  model: "claude-sonnet-4-6"   # 자식만 저렴한 모델로
  provider: "anthropic"
```

`max_spawn_depth: 3`, `max_concurrent_children: 3`이면 말단 에이전트가 최대 27개까지 붙습니다.
비용이 곱으로 늘어나니 깊이는 의도적으로만 올리세요. 실무에선 2면 충분합니다.

### 6-2. 조직 운영 — 칸반 보드 (역할 에이전트에게 실제 업무 배정)

"디자이너/마케터/퍼포먼스 에이전트를 두고 팀장이 관리한다"는 요구는 이쪽입니다.
`delegate_task`와 달리 **업무가 DB 행으로 남고, 재시작에도 살아남고, 사람이 중간에
코멘트로 개입할 수 있고, 담당을 바꿔 다시 돌릴 수 있습니다.**

```bash
hermes kanban init        # 보드 생성 (~/.hermes/kanban.db)
hermes gateway start      # 디스패처는 게이트웨이 안에서 60초마다 도는 게 기본
hermes kanban create "가을 프로모션 키비주얼 3안" --assignee designer
hermes kanban list        # 보드 확인
hermes kanban watch       # 실시간 진행 보기
```

팀장 에이전트에게 목표를 던지면, 팀장은 스스로 카드를 쪼개 배정합니다(도구 호출로 동작).

```
사용자(슬랙): @헤르메스팀장 다음 주 신제품 런칭 준비 좀 굴려줘

팀장의 한 턴:
  kanban_create(title="런칭 키비주얼 3안", assignee="designer", body="...")     → t_1
  kanban_create(title="런칭 SNS 카피 10종", assignee="marketer", body="...")    → t_2
  kanban_create(title="런칭 광고 예산·타깃 초안", assignee="perf", body="...")  → t_3
  kanban_create(title="런칭 패키지 통합 정리", assignee="marketer",
                parents=["t_1","t_2","t_3"])                                    → t_4
  kanban_complete(summary="3개 병렬 + 통합 1개로 분해 완료")
```

부모 카드가 모두 `done`이 되면 자식 카드가 자동으로 `ready`로 승격되고, 디스패처가 해당
프로필을 워커 프로세스로 띄웁니다. 진행 상황은 슬랙으로 알림이 오고, 사람이 카드에 코멘트를
달면 워커가 다음 실행에서 그 스레드를 통째로 읽습니다.

**팀장 프로필을 제대로 만드는 법 두 가지**

1. 툴셋을 보드 조작 위주로 줄여서 **팀장이 직접 실무를 못 하게** 만듭니다. 그래야 분배를 합니다.
   ```yaml
   agent:
     disabled_toolsets: [terminal, code_execution, browser]
   ```
2. 프로필 생성 시 `--description`을 꼭 채웁니다. 팀장은 존재하는 프로필 목록을 근거로 배정하는데,
   **없는 이름으로 배정하면 디스패처가 조용히 실패**합니다.

병렬 카드 두 개가 같은 결정을 각자 내려야 하는 상황이면(파일 포맷, 네이밍, 톤앤매너 등)
팀장이 먼저 정해서 **양쪽 카드 본문에 박아 넣어야** 합니다. 워커는 형제 카드를 볼 수 없습니다.

카드별 세부 제어:

```bash
hermes kanban create "어려운 리브랜딩 컨셉" --assignee designer \
    --model claude-opus-4.7 --provider anthropic          # 이 카드만 상위 모델로
hermes kanban create "문서 전량 영문화" --assignee marketer \
    --goal --goal-max-turns 15                            # 완료 판정될 때까지 반복
```

### 6-3. 에이전트끼리 슬랙에서 대화시키기 (선택)

기본값은 다른 봇의 메시지를 전부 무시합니다. 팀장 봇이 슬랙 채널에서 담당 봇을 직접 부르게
하려면 각 프로필에:

```yaml
platforms:
  slack:
    extra:
      allow_bots: mentions    # 그 메시지가 나를 @멘션했을 때만 수락
slack:
  require_mention: true
  strict_mention: true
```

`all`은 쓰지 마세요 — 둘 다 아무 메시지에나 답하는 봇이면 무한 루프가 됩니다.
`mentions` 모드는 매 턴 명시적 호출을 요구해서 ack/상태 루프를 끊습니다.
다만 **업무 배정은 슬랙 대화보다 칸반이 안전하고 추적 가능**합니다. 슬랙 봇 간 호출은
"팀장이 담당자를 불러 상황을 묻는" 정도로만 쓰길 권합니다.

---

## 7. 역할 에이전트를 실제로 쓸모 있게 만들기

설치만으로는 "말 잘하는 봇"입니다. 아래 넷을 채워야 직원처럼 일합니다.

1. **SOUL.md — 정체성과 원칙**
   프로필별 `SOUL.md`에 역할, 판단 기준, 말투, 하지 말아야 할 것을 적습니다. 예시는
   [`examples/`](./examples) 참고. 새 세션부터 적용됩니다.
2. **스킬(skills)** — 특정 업무 절차를 담은 지침 묶음. `hermes skills list`,
   `hermes -p perf skills opt-in --sync`로 역할에 맞는 것만 켜세요. 사내 고유 업무는
   직접 작성할 수 있습니다(스킬 작성 가이드가 문서에 별도로 있습니다).
3. **MCP 서버 연결** — 노션·피그마·구글 워크스페이스·광고 플랫폼 등 실제 데이터에 붙이는 통로입니다.
   `hermes mcp` 관련 명령과 `~/.hermes/config.yaml`의 MCP 섹션으로 프로필별로 다르게 물릴 수 있습니다.
   퍼포먼스마케터에게만 광고 계정, 디자이너에게만 피그마 — 이런 식으로 최소 권한을 유지하세요.
4. **크론(cron)** — 정기 업무. 예: 매주 월요일 09시 퍼포먼스 에이전트가 지난주 성과 리포트를
   `#퍼포먼스` 방에 올리기. `hermes -p perf cron` 계열 명령으로 등록하고, 결과는
   `SLACK_HOME_CHANNEL`로 배달됩니다.

---

## 8. 보안과 운영 (사내 도입 전 필수)

기본값이 이미 꽤 방어적입니다: 위험 명령은 승인 요구(`approvals.mode: smart`), 승인
무응답 시 **거부로 종료**, `rm -rf /` 같은 건 승인 여부와 무관하게 항상 차단,
`~/.ssh`·`.env` 등 크리덴셜 경로 쓰기 차단, 출력의 비밀값 마스킹.

직원이 함께 쓰는 회사 머신이면 여기에 얹으세요.

```yaml
approvals:
  mode: manual              # 위험 명령은 항상 사람이 승인
  deny:                     # 이건 무조건 금지 (--yolo도 못 뚫음)
    - "git push --force*"
    - "*curl*|*sh*"

terminal:
  backend: docker           # 가장 강한 격리: 명령을 컨테이너 안에서만 실행
  docker_forward_env: []    # 컨테이너로 넘길 환경변수는 명시적 허용만
```

- `HERMES_WRITE_SAFE_ROOT`로 쓰기 가능한 디렉터리를 제한할 수 있습니다.
  단, **Hermes 홈도 함께 포함**해야 크론·스킬 저장이 깨지지 않습니다.
- 슬랙 쪽 방어선: `SLACK_ALLOWED_USERS`(필수), `slack.allowed_channels`,
  `unauthorized_dm_behavior: pair`. `GATEWAY_ALLOW_ALL_USERS=true`는 절대 쓰지 마세요.
- 토큰은 `~/.hermes/.env`에 두고 파일 권한 `600`, 주기적으로 회전.
- 되돌리기: `hermes chat --checkpoints`로 파괴적 작업 전 스냅샷 → `/rollback`.

**상시 운영**

```bash
hermes doctor                    # 상태 점검
<프로필> gateway install|start|restart|stop
hermes update                    # 업데이트
hermes backup                    # 전체 백업 (프로필 export는 크리덴셜 미포함)
```

- Linux: 로그아웃 후에도 살리려면 `sudo loginctl enable-linger <계정>`
- Windows: `schtasks /SC ONLOGON` 기반이므로 **자동 로그인 + 절전 해제**를 설정해야
  재부팅 후에도 봇이 살아 있습니다.
- 프로필이 늘면 서비스도 프로필 수만큼 생깁니다(`hermes-gateway-<이름>`). 하나로 묶고
  싶으면 멀티플렉싱(B안)으로 전환하세요.

---

## 9. 순서 요약 체크리스트

```
[ ] 1. 컴퓨터 준비 (절전 해제, 전용 계정, OS 결정)
[ ] 2. install.sh / install.ps1 실행 → hermes doctor 통과
[ ] 3. hermes model → Anthropic + API 키 → hermes --tui 로 대화 성공 확인   ★여기 막히면 진행 금지
[ ] 4. hermes profile create lead / designer / marketer / perf (+ --description)
[ ] 5. 프로필별 config.yaml·SOUL.md 작성 (examples/ 복사)
[ ] 6. 슬랙 앱 1개로 designer 먼저 성공 → 나머지 3개 반복
[ ] 7. SLACK_ALLOWED_USERS·allowed_channels 채우고 각 방에 /invite
[ ] 8. hermes kanban init → 팀장에게 목표 던져 카드 분배 확인
[ ] 9. gateway install 로 서비스 등록 + 재부팅 테스트
[ ] 10. approvals·deny·백업 설정 후 직원에게 사용법 공지
```

---

## 10. 자주 막히는 곳

| 증상 | 원인 |
|---|---|
| DM은 되는데 **채널에서 무응답** | `message.channels`/`message.groups` 이벤트 미구독 (가장 흔함). 추가 후 **앱 재설치**, 그리고 `/invite` |
| "Sending messages to this app has been turned off" | App Home의 **Messages Tab** 미활성화 |
| 스코프를 고쳤는데 그대로 | 앱 **재설치**를 안 함 |
| 아무도 응답을 못 받음 | `SLACK_ALLOWED_USERS` 미설정 → 전면 거부가 기본 안전값 |
| 팀장이 카드를 만들었는데 아무 일도 안 일어남 | 게이트웨이가 꺼져 있음(디스패처가 그 안에 있음), 또는 **존재하지 않는 프로필 이름**으로 배정 |
| 에이전트 두 개가 서로 무한 응답 | `allow_bots: all` → `mentions`로 변경 |
| 봇이 사람들 대화에 끼어듦 | `strict_mention: true` 또는 `ignore_other_user_mentions: true` |
| 첨부 이미지/파일을 못 읽음 | `files:read` 스코프 누락 후 재설치 안 함 |

---

## 참고 문서

- 설치 / 빠른 시작: <https://hermes-agent.nousresearch.com/docs/getting-started/installation>
- 프로필(멀티 에이전트): <https://hermes-agent.nousresearch.com/docs/user-guide/profiles>
- 여러 게이트웨이 운영: <https://hermes-agent.nousresearch.com/docs/user-guide/multi-profile-gateways>
- 슬랙 연동: <https://hermes-agent.nousresearch.com/docs/user-guide/messaging/slack>
- 위임(delegate_task): <https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation>
- 칸반(멀티 에이전트 보드): <https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban>
- 보안: <https://hermes-agent.nousresearch.com/docs/user-guide/security>
- Windows 네이티브: <https://hermes-agent.nousresearch.com/docs/user-guide/windows-native>
