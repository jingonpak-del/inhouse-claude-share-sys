import { useState } from "react";
import type { Role } from "../api";

/**
 * 사용 안내 화면.
 * 담당자에게는 사용법만, 관리자에게는 운영·구조 설명까지 보여준다.
 */
export function Guide({ role, onBack }: { role: Role; onBack: () => void }) {
  const [tab, setTab] = useState<"user" | "admin">("user");
  const isMaster = role === "master";

  return (
    <div className="dashboard guide">
      <div className="guide-header">
        <button className="link-btn" onClick={onBack}>
          ← 돌아가기
        </button>
        <h1>사용 안내</h1>
      </div>

      {isMaster && (
        <div className="guide-tabs">
          <button className={tab === "user" ? "active" : ""} onClick={() => setTab("user")}>
            사용 방법
          </button>
          <button className={tab === "admin" ? "active" : ""} onClick={() => setTab("admin")}>
            관리자용 — 구동 방식과 점검
          </button>
        </div>
      )}

      {(!isMaster || tab === "user") && <UserGuide />}
      {isMaster && tab === "admin" && <AdminGuide />}
    </div>
  );
}

function UserGuide() {
  return (
    <div className="guide-body">
      <section className="panel">
        <h2>이 시스템은 무엇인가요</h2>
        <p>
          회사 서버 컴퓨터에서 돌아가는 <strong>Claude Code</strong>를 웹으로 함께 쓰는 도구입니다.
          내 PC에 아무것도 설치하지 않고 브라우저만으로, 서버에 있는 프로젝트 폴더를 대상으로
          작업을 지시할 수 있습니다.
        </p>
        <p className="muted">
          내가 보낸 메시지와 Claude의 작업 내용은 같은 세션에 배정된 사람 모두에게 실시간으로 보입니다.
        </p>
      </section>

      <section className="panel">
        <h2>1. 로그인</h2>
        <p>
          관리자에게 받은 아이디와 비밀번호로 로그인합니다. 한 번 로그인하면 <strong>12시간</strong> 유지되고,
          그 후에는 다시 로그인해야 합니다.
        </p>
      </section>

      <section className="panel">
        <h2>2. 세션 열기</h2>
        <p>
          로그인하면 <strong>나에게 배정된 세션</strong>만 카드로 보입니다. 카드를 누르면 대화 화면이 열립니다.
          세션 카드에는 세션 이름, 사용 모델, 작업 폴더 경로가 표시됩니다.
        </p>
        <p className="muted">
          보이는 세션이 없다면 아직 배정을 받지 않은 것입니다. 관리자에게 요청하세요.
        </p>
      </section>

      <section className="panel">
        <h2>3. 대화하기</h2>
        <ul className="guide-list">
          <li>
            아래 입력창에 지시할 내용을 적고 <strong>Enter</strong>를 누르면 전송됩니다.
          </li>
          <li>
            줄을 바꾸려면 <strong>Shift + Enter</strong>를 누르세요.
          </li>
          <li>
            무엇을·어디서·어떻게 해야 하는지 구체적으로 적을수록 결과가 정확합니다.
          </li>
        </ul>
      </section>

      <section className="panel highlight">
        <h2>4. 실행 승인 요청에 답하기 — 가장 중요</h2>
        <p>
          Claude가 파일을 고치거나 명령을 실행하려 할 때, 화면에 이런 카드가 뜹니다.
        </p>
        <div className="guide-mock">
          <div>🔒 <strong>Edit</strong> 실행 승인 요청</div>
          <pre>{`{ "file_path": "C:\\\\work\\\\project\\\\server.js" }`}</pre>
          <div className="guide-mock-actions">
            <span className="fake-btn allow">승인</span>
            <span className="fake-btn deny">거부</span>
          </div>
        </div>
        <ul className="guide-list">
          <li>
            <strong>내용을 먼저 확인하세요.</strong> 어떤 파일을 건드리는지, 어떤 명령을 실행하는지 표시됩니다.
          </li>
          <li>
            의도한 작업이 맞으면 <strong>승인</strong>, 아니면 <strong>거부</strong>를 누릅니다.
          </li>
          <li>
            <strong>10분 안에 답하지 않으면 자동으로 거부</strong>되고 작업이 멈춥니다. 자리를 비울 때 주의하세요.
          </li>
          <li>판단이 서지 않으면 승인하지 말고 관리자에게 확인하세요.</li>
        </ul>
      </section>

      <section className="panel">
        <h2>5. 화면 읽는 법</h2>
        <table className="table">
          <thead>
            <tr>
              <th>표시</th>
              <th>의미</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span className="badge ok">연결됨</span></td>
              <td>서버와 연결된 정상 상태입니다.</td>
            </tr>
            <tr>
              <td><span className="badge off">연결 끊김</span></td>
              <td>연결이 끊겼습니다. 페이지를 새로고침하세요.</td>
            </tr>
            <tr>
              <td>상태: starting / running</td>
              <td>Claude가 준비 중이거나 작업 중입니다.</td>
            </tr>
            <tr>
              <td>상태: idle</td>
              <td>작업이 끝나 다음 지시를 기다립니다.</td>
            </tr>
            <tr>
              <td>🔧 도구 이름</td>
              <td>Claude가 실행한 작업입니다. 여러 번 연속 실행되면 한 줄로 묶여 표시됩니다.</td>
            </tr>
            <tr>
              <td>응답 완료</td>
              <td>한 번의 지시에 대한 처리가 모두 끝났습니다.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>6. 대화 새로고침</h2>
        <p>
          서버 PC의 Claude 앱에서 이어서 작업한 내용은 대시보드에 자동으로 반영되지 않습니다.
          화면 위쪽 <strong>대화 새로고침</strong> 버튼을 누르면 최신 작업 내역을 가져옵니다.
        </p>
        <p className="muted">이 버튼은 서버의 기존 세션을 이어받은 세션에만 표시됩니다.</p>
      </section>

      <section className="panel warn">
        <h2>주의할 점</h2>
        <ul className="guide-list">
          <li>
            <strong>같은 세션을 서버 PC의 Claude 앱과 동시에 쓰지 마세요.</strong> 양쪽이 같은 기록에 쓰면서
            대화가 어긋납니다. 대시보드에서 쓸 세션은 앱에서 닫아두세요.
          </li>
          <li>
            승인은 <strong>서버 컴퓨터에서 실제로 파일을 고치고 명령을 실행</strong>합니다. 되돌리기 어려운 작업일 수
            있으니 내용을 확인하고 누르세요.
          </li>
          <li>비밀번호는 공유하지 마세요. 계정이 곧 서버 작업 권한입니다.</li>
        </ul>
      </section>

      <section className="panel">
        <h2>문제가 생기면</h2>
        <table className="table">
          <thead>
            <tr>
              <th>증상</th>
              <th>대처</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>화면이 안 열리거나 오류가 뜬다</td>
              <td>페이지 새로고침(Ctrl+F5) → 그래도 안 되면 관리자 문의</td>
            </tr>
            <tr>
              <td>"연결 끊김"이 계속된다</td>
              <td>새로고침. 반복되면 서버 점검이 필요합니다.</td>
            </tr>
            <tr>
              <td>메시지를 보내도 응답이 없다</td>
              <td>승인 요청 카드가 떠 있는지 확인하세요. 답하지 않으면 진행되지 않습니다.</td>
            </tr>
            <tr>
              <td>배정된 세션이 안 보인다</td>
              <td>관리자에게 세션 배정을 요청하세요.</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

function AdminGuide() {
  return (
    <div className="guide-body">
      <section className="panel">
        <h2>어떻게 구동되는가</h2>
        <div className="guide-flow">
          <div className="flow-step">
            <strong>브라우저</strong>
            <span className="muted">담당자 PC · https://dev.zumma.kr</span>
          </div>
          <div className="flow-arrow">↓ HTTPS</div>
          <div className="flow-step">
            <strong>Cloudflare 터널 (cloudflared)</strong>
            <span className="muted">HTTPS 종단 후 서버 내부로 전달 · 스케줄 태스크 'zumma터널'</span>
          </div>
          <div className="flow-arrow">↓ 127.0.0.1:4000</div>
          <div className="flow-step">
            <strong>Node 서버 (Express + WebSocket)</strong>
            <span className="muted">스케줄 태스크 '동시사용서버' · 로그온 시 자동 시작</span>
          </div>
          <div className="flow-arrow">↓ 세션마다</div>
          <div className="flow-step">
            <strong>Claude Code 프로세스 (Agent SDK)</strong>
            <span className="muted">서버 PC에서 실제로 파일 수정·명령 실행</span>
          </div>
        </div>
        <ul className="guide-list">
          <li>
            Node 서버는 <strong>127.0.0.1에서만</strong> 대기합니다. 외부에서 직접 접근할 수 없고 터널을 통해서만 들어옵니다.
          </li>
          <li>
            계정·세션·대화 기록은 서버의 <span className="mono">server/data/app.db</span> (SQLite)에 저장됩니다.
          </li>
          <li>
            대화는 WebSocket으로 오가며, 같은 세션에 접속한 사람 모두에게 동시에 전달됩니다.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2>인증 구조</h2>
        <table className="table">
          <thead>
            <tr>
              <th>구분</th>
              <th>방식</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>대시보드 로그인</td>
              <td>아이디/비밀번호(bcrypt 해시) → 쿠키 <span className="mono">sid</span>, 12시간 유효</td>
            </tr>
            <tr>
              <td>관리자 비밀번호 변경</td>
              <td><span className="mono">deploy\set-admin-password.ps1</span> 실행 (변경 시 기존 로그인 전부 만료)</td>
            </tr>
            <tr>
              <td>Claude 인증</td>
              <td>
                <span className="mono">C:\Users\admin\.claude\.credentials.json</span> — Claude Max 구독 OAuth
              </td>
            </tr>
          </tbody>
        </table>
        <p className="muted">
          Claude 앱(데스크톱)의 로그인과 서버가 쓰는 CLI 인증은 <strong>별개</strong>입니다. 앱은 패키지 앱이라
          저장 위치가 격리되어 있어, 앱에 로그인해도 서버는 그 인증을 쓰지 못합니다.
        </p>
      </section>

      <section className="panel">
        <h2>권한 모드 — 세션 생성 시 선택</h2>
        <table className="table">
          <thead>
            <tr>
              <th>모드</th>
              <th>동작</th>
              <th>권장</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>기본(default)</td>
              <td>도구 실행마다 담당자 승인 요청</td>
              <td>기본값으로 사용</td>
            </tr>
            <tr>
              <td>계획 모드(plan)</td>
              <td>읽기만 하고 실행하지 않음</td>
              <td>조사·검토용으로 안전</td>
            </tr>
            <tr>
              <td>파일 편집 자동 승인</td>
              <td>편집은 자동, 나머지는 승인 요청</td>
              <td>신뢰하는 담당자에게만</td>
            </tr>
            <tr>
              <td>모든 권한 우회</td>
              <td>승인 없이 전부 실행</td>
              <td className="danger-text">권장하지 않음</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>정기 점검 항목</h2>
        <table className="table">
          <thead>
            <tr>
              <th>확인할 것</th>
              <th>정상 기준</th>
              <th>이상 시</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>사이트 접속</td>
              <td>https://dev.zumma.kr 가 로그인 화면 표시</td>
              <td>아래 서버·터널 순서로 확인</td>
            </tr>
            <tr>
              <td>서버 태스크</td>
              <td>'동시사용서버' 가 Running</td>
              <td>태스크 재시작</td>
            </tr>
            <tr>
              <td>터널</td>
              <td>cloudflared 프로세스 존재</td>
              <td>'zumma터널' 태스크 재시작</td>
            </tr>
            <tr>
              <td>Claude 인증</td>
              <td>명령 전송 시 정상 응답</td>
              <td>재로그인 (아래 참고)</td>
            </tr>
            <tr>
              <td>사용량</td>
              <td>Claude Max 플랜 한도 내</td>
              <td>세션 배정을 줄이거나 모델을 낮춤</td>
            </tr>
          </tbody>
        </table>
        <p className="muted">
          5분마다 도는 '서버감시' 태스크가 포트 4000과 cloudflared를 자동 감시하고, 죽으면 되살립니다.
          기록은 <span className="mono">C:\Users\admin\클로드\server-watchdog.log</span> 에 남습니다.
        </p>
      </section>

      <section className="panel">
        <h2>자주 겪는 문제</h2>
        <table className="table">
          <thead>
            <tr>
              <th>증상</th>
              <th>원인과 해결</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>대화창에 "Not logged in"</td>
              <td>
                Claude 인증 만료. 서버 PC의 PowerShell에서 <span className="mono">claude.cmd login</span> 실행 후
                '동시사용서버' 태스크 재시작. (PowerShell 실행 정책 때문에 <span className="mono">.cmd</span> 확장자를
                반드시 붙일 것)
              </td>
            </tr>
            <tr>
              <td>사이트가 502 / 접속 불가</td>
              <td>Node 서버가 내려간 상태. '동시사용서버' 태스크 재시작.</td>
            </tr>
            <tr>
              <td>모든 zumma.kr 사이트가 동시에 안 됨</td>
              <td>터널 문제. 'zumma터널' 태스크 재시작.</td>
            </tr>
            <tr>
              <td>불러온 세션에 최근 내용이 없음</td>
              <td>'대화 새로고침'을 누르면 원본 세션 기록과 다시 맞춥니다.</td>
            </tr>
            <tr>
              <td>재부팅 후 사이트가 안 뜸</td>
              <td>
                태스크가 <strong>로그온 시</strong> 시작하도록 설정되어 있습니다. 서버 PC에 admin 계정으로 로그온되어
                있어야 합니다.
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="panel warn">
        <h2>보안상 반드시 알아둘 것</h2>
        <ul className="guide-list">
          <li>
            <strong>이 시스템의 계정은 곧 서버 컴퓨터의 작업 권한입니다.</strong> 로그인한 사람은 서버에서 파일을
            수정하고 명령을 실행할 수 있습니다. 계정 발급과 세션 배정을 신중히 하세요.
          </li>
          <li>
            현재 보호 장치는 <strong>대시보드 로그인 하나뿐</strong>입니다. 인터넷에 공개되어 있으므로 비밀번호를
            충분히 길게 유지하고 공유하지 마세요.
          </li>
          <li>담당자에게는 필요한 세션만 배정하세요. 배정되지 않은 세션은 목록에 보이지 않습니다.</li>
          <li>퇴사·담당 변경 시 해당 세션 배정을 해제하거나 세션을 보관 처리하세요.</li>
        </ul>
      </section>

      <section className="panel">
        <h2>비용</h2>
        <p>
          Claude Max 구독 계정으로 인증되어 있어 <strong>사용할 때마다 별도로 청구되지 않습니다.</strong> 대신 구독
          플랜의 사용량 한도를 소모하며, 이는 관리자가 직접 쓰는 Claude Code와 같은 한도를 공유합니다.
        </p>
        <p className="muted">
          대화 화면에 표시되는 비용 수치는 토큰 사용량을 API 요금으로 환산한 참고값이며 실제 청구액이 아닙니다.
          다만 <span className="mono">ANTHROPIC_API_KEY</span> 환경변수를 설정하면 종량 과금으로 전환되므로 설정하지
          마세요.
        </p>
      </section>
    </div>
  );
}
