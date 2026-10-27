# 다른 PC 설치 방법과 작업 기록 (2026-10-27 기준)

더줌 인스타그램(@the_zum_) · 스레드 자동화를 다른 컴퓨터에서 쓰거나 이어서 고칠 때 읽는 문서입니다.
매일 쓰는 법과 토큰 발급 방법은 [README.md](../README.md) 에 있습니다.

---

## 1. ⚠️ 먼저 정할 것: 자동 실행은 한 대에서만

- 예약 발행과 댓글 답글은 `python sns.py tick` (10분마다)이 처리합니다.
- **두 컴퓨터에서 동시에 tick 이 돌면** 같은 글이 두 번 올라가거나 같은 댓글에 답글이 두 개 달릴 수 있습니다.
  - 게시글·답글 기록(`data/`)이 컴퓨터마다 따로 있기 때문입니다.
- 정리하면 이렇습니다.
  - **서버 컴퓨터를 옮길 때**: 기존 컴퓨터의 작업 스케줄러 두 개(`SNS자동화_10분`, `SNS자동화_확인화면`)를 끄고, `data/` 폴더를 통째로 복사해 옵니다.
  - **코드만 보거나 고칠 때**: 작업 스케줄러를 등록하지 말고, `config.json` 의 `"dry_run": true` 로 시험합니다.

## 2. 새 PC 설치 순서

### 1) 준비물

| 항목 | 내용 |
|---|---|
| Python | 3.11 이상 (서버 PC는 3.13) |
| Node.js + Claude Code | `npm install -g @anthropic-ai/claude-code` — **2.1.311 이상**이어야 `claude-opus-5-5` 사용 가능 |
| Git | 저장소 내려받기용 |

### 2) 내려받기와 패키지 설치

```bash
git clone https://github.com/jingonpak-del/insta-thread-auto.git sns자동화
```

```bash
pip install -r requirements.txt
```

### 3) `.env` 만들기

1. `.env.example` 을 `.env` 로 복사합니다.
2. 아래 값을 채웁니다.
   - 서버 PC의 `.env` 를 USB 등으로 직접 옮겨도 되고, 새로 발급해도 됩니다.
   - **메신저나 GitHub 에는 올리지 마세요.**

| 키 | 받는 곳 |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | 새 PC 터미널에서 `claude setup-token` |
| `INSTAGRAM_ACCESS_TOKEN` | Meta 개발자 앱 → Instagram → API 설정 → 토큰 생성 |
| `THREADS_ACCESS_TOKEN` | Meta 개발자 앱 → Threads → 사용자 토큰 생성기 |

- 서버 PC는 토큰을 일주일마다 자동으로 새로 받습니다.
  - 새로 받은 토큰은 `data/state.json` 에 저장되고 `.env` 에는 반영되지 않습니다.
  - 그래서 `.env` 의 옛 토큰을 옮겨 왔다가 만료되었다면, 새로 발급하거나 서버 PC의 `data/state.json` 을 함께 옮겨야 합니다.

### 4) 폴더 위치에 따라 고칠 설정 (`config.json`)

서버 PC에서는 이 폴더가 `C:\Users\admin\클로드\외부광고기록_정다혜\sns자동화` 에 있어서, 아래 상대 경로가 맞게 잡혀 있습니다.
다른 PC에서는 이 경로들이 없을 수 있습니다.

| 설정 | 서버 PC 값 | 하는 일 | 다른 PC에서 |
|---|---|---|---|
| `public_image_dir` | `../public/mom-img` | 발행할 사진을 여기에 복사 → `https://mom.zumma.kr/mom/img/` 로 공개 | 업무관리 서버가 없으면 **실제 발행 불가**. 다른 공개 이미지 주소가 필요함 |
| `public_image_base_url` | `https://mom.zumma.kr/mom/img/` | 인스타·스레드가 사진을 가져가는 주소 | 위와 함께 바꿈 |
| `codex_image_script` | `../../codex이미지/codex_image.py` | 'AI로 카드 이미지 만들기' | 없으면 AI 이미지만 안 됨 (직접 올린 사진은 됨) |
| `zumma_server_dir` | `../../업무관리/office-work-manage/server` | zumma.kr 로그인 확인 (`config.json` 의 `internalSecret`, `employees.txt`) | 없으면 `localhost:3088` 으로만 열림 (외부 접속 불가) |

### 5) 연결 확인과 실행

```bash
python sns.py status
```

- `@the_zum_ 연결됨` 같은 줄이 인스타·스레드 각각 나오면 정상입니다.

```bash
python sns.py web
```

- 위 명령을 실행한 뒤 http://localhost:3088 을 엽니다.
- 이 PC를 서버로 쓸 때만 작업 스케줄러를 등록합니다.

```bash
powershell -ExecutionPolicy Bypass -File 작업스케줄러_등록.ps1
```

---

## 3. 구조 한눈에 보기

```
sns.py web    → snsauto/web.py   확인 화면 (Flask, 포트 3088)
sns.py tick   → snsauto/jobs.py  10분마다: 예약 발행 → 소재로 초안 만들기 → 댓글 확인(30분 간격) → 토큰 갱신(주 1회)
sns.py status → 연결 상태 출력

snsauto/writer.py  Claude 로 글·답글 쓰기 (구독: claude.exe -p 헤드리스, 또는 API)
snsauto/meta.py    인스타그램 Graph API / Threads API (발행, 댓글, 답글, 토큰 갱신)
snsauto/images.py  사진 비율 맞추기(4:5~1.91:1, 흰 여백), 공개 폴더 복사, Codex AI 이미지
snsauto/common.py  설정·.env 읽기, JSON 저장(잠금 파일), 옛 카페 이름 자동 교정·검사
brand.md           말투 가이드 (Claude 가 그대로 읽음)
```

### 기술 메모

- **Claude 구독 방식**
  - `claude.exe -p --input-format stream-json --output-format stream-json --json-schema … --tools "" --no-session-persistence --strict-mcp-config --model claude-opus-5-5`
  - `CLAUDE_CODE_OAUTH_TOKEN` 을 환경변수로 넘깁니다.
  - 결과는 `structured_output` 에서 읽습니다.
  - claude.exe 경로는 `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe` 입니다.
- **인스타그램 발행 (graph.instagram.com v23.0)**
  - 컨테이너 생성 → `status_code` 가 FINISHED 가 될 때까지 대기 → `media_publish`.
  - 사진이 2장 이상이면 캐러셀로 올립니다.
- **스레드 발행 (graph.threads.net v1.0)**
  - `me/threads` → 상태 확인 → `threads_publish`.
  - 답글은 `reply_to_id` 로 답니다.
- **사진**
  - 인스타·스레드 모두 사진을 공개 인터넷 주소로만 받습니다.
  - 그래서 `sns-<글id>-<번호>.jpg` 이름으로 복사해 mom.zumma.kr 경로로 내보냅니다.
  - 파일 이름은 영문·숫자·`._-` 만 쓰고 60자 이하여야 합니다.
- **zumma.kr 로그인(SSO)**
  - 업무관리 서버 `extadSsoToken` 과 같은 형식입니다: `base64url("이름|만료ms") + "." + HMAC-SHA256(internalSecret)`.
  - 쿠키 유지 시간은 12시간입니다.
  - 요청이 localhost 이고 Cloudflare 헤더가 없으면 로그인 없이 열립니다.
- **'지금 발행' 버튼**
  - 앱 안 브라우저에서 확인 창(confirm)이 막히는 문제가 있어서 **두 번 누르기** 방식으로 바꿨습니다.
  - 첫 번째 누름은 빨간 버튼으로 바뀌고, 8초 안에 한 번 더 누르면 발행됩니다.

---

## 4. 이 폴더 밖에서 바꾼 것 (서버 PC 전용, 저장소에는 없음)

| 파일 | 바꾼 내용 |
|---|---|
| `업무관리/office-work-manage/server/server.js` (`authInject`) | 📱 SNS자동화 버튼 추가. 백업: `*.bak-sns-20261027-141811` |
| `업무관리/office-work-manage/server/config.json` | `"snsUrl": "https://sns.zumma.kr"`, `"snsUsers": []` (비어 있으면 전 직원) |
| `C:\Users\admin\.cloudflared\config.yml` | `sns.zumma.kr → http://127.0.0.1:3088` |
| `C:\Users\admin\클로드\server-watchdog.ps1` | 감시 목록에 `@{ Port = 3088; Task = 'SNS자동화_확인화면'; Site = 'sns.zumma.kr'; Host = '127.0.0.1' }` (UTF-8 BOM 으로 저장해야 함) |

server.js 에 넣은 코드:

```js
// SNS자동화(sns.zumma.kr) 바로가기 — snsUsers 가 비어 있으면 전 직원.
let snsUrl = '';
if (CONFIG.snsUrl && (!(CONFIG.snsUsers || []).length || CONFIG.snsUsers.indexOf(meName) >= 0)) {
  const t = extadSsoToken(meName);
  snsUrl = String(CONFIG.snsUrl).replace(/\/$/, '') + (t ? '/sso?t=' + encodeURIComponent(t) : '');
}
// window.__SNS__ = snsUrl 로 넘기고, 버튼:
// if(window.__SNS__){ var snb=mkBtn("📱 SNS자동화", function(){ location.href=window.__SNS__; }); ... }
```

---

## 5. 정해 둔 운영 원칙

- **이름**
  - 카페 이름은 **창원줌마렐라**, **김해줌마렐라**로만 씁니다. '마산맘', '김해줌마'는 쓰지 않습니다.
  - Claude 가 옛 이름을 쓰면 코드가 자동으로 고치고, 사람이 손으로 넣으면 승인이 막힙니다.
- **게시글**
  - **확인 후 발행** 합니다. 확인 화면에서 승인해야 예약되거나 발행됩니다.
- **발행 시각**
  - 인스타: 11:30 · 19:30
  - 스레드: 08:30 · 12:30 · 21:00
- **말투** (자세한 건 `brand.md`)
  - 인스타그램: 존댓말 안내문형. 📅🎁✍️ 정보 3~4줄. 해시태그 최대 5개. **해시태그 포함 200~280자**.
  - 스레드: **반말**. 일상 장면으로 시작하는 감성 글. 항목 이모지 없음. **80~120자**.
  - 길이는 처음 초안의 약 3분의 1로 줄였고, 앞으로도 이 길이를 유지합니다.
  - 답댓글: 댓글이 반말이면 반말, 존댓말이면 존댓말로 답합니다. 애매하면 존댓말.
- **답댓글 방식**
  - 지금은 **승인 후 등록**입니다. 나중에 설정 화면에서 '완전 자동'으로 바꿀 수 있습니다.
  - 완전 자동이어도 불만·민감한 댓글은 확인 대기로 남습니다.
- **좋아요 자동화는 하지 않습니다.** 공식 API가 없고 Meta 약관 위반이라 계정 정지 위험이 있습니다.

---

## 6. 작업 기록 (2026-10-27)

1. 인스타·스레드 자동화 가능 범위를 검토했습니다.
   - 게시글 자동 발행과 답댓글은 공식 API로 구현했습니다.
   - 좋아요 자동화는 제외했습니다.
2. 프로그램을 만들었습니다: 소재 등록 → Claude 초안 → 확인 화면 승인 → 예약 발행 → 댓글 확인과 답글.
3. zumma.kr 대시보드에 📱 SNS자동화 버튼을 추가하고, `sns.zumma.kr` 터널과 서버 감시를 연결했습니다.
4. 작업 스케줄러를 등록했습니다(10분 실행, 로그인 시 확인 화면 켜기).
   - pythonw 로 실행하면 출력이 없어 멈추던 문제를 고쳤습니다. 지금은 `data/sns-run.log` 에 기록합니다.
5. Claude 는 API 대신 **월구독**으로 쓰도록 바꿨습니다(`claude setup-token`).
   - Claude Code 를 2.1.311 로 올렸습니다.
6. 말투를 다듬었습니다.
   - 스레드는 반말 감성 글로 바꿨습니다(예시 글은 `brand.md` 맨 아래에 있습니다).
   - 두 채널 모두 길이를 약 3분의 1로 줄였습니다.
7. `dry_run` 을 끄고 실제 발행으로 바꿨습니다.
8. 첫 글을 발행했습니다: 창원줌마렐라 체험단 '숨펴내 통배숙청 한술배숙'.
   - 사진 2장 캐러셀로 인스타·스레드에 올렸고, API로 게시를 확인했습니다.
9. '지금 발행' 버튼을 두 번 누르기 방식으로 바꿨습니다.
10. '함께 키우는 아이, 함께 만드는 미래' 저출생 대응 경남지역연대 캠페인 글의 초안을 만들었습니다.
    - 확인 대기 상태이며 아직 발행 전입니다.

### 아직 확인하지 못한 것

- 실제 댓글이 달렸을 때 댓글 감지와 답글 등록 (30분마다 자동 확인)
- zumma.kr 대시보드 버튼 모양 (화면으로 직접 보지 못함)
