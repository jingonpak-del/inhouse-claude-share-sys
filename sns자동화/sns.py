"""더줌 SNS 자동화 실행 명령.

  python sns.py web      확인 화면 열기 (http://localhost:3088)
  python sns.py tick     10분마다 할 일 한 번 (발행·초안 만들기·댓글 확인·토큰 갱신) — 작업 스케줄러용
  python sns.py status   인스타·스레드 연결 확인
"""
import sys

from snsauto import jobs
from snsauto.common import DATA, config, log


def main():
    if sys.stdout is None:
        # 작업 스케줄러가 창 없는 파이썬(pythonw)으로 띄우면 화면 출력이 없다 → 파일로 남긴다
        DATA.mkdir(exist_ok=True)
        sys.stdout = sys.stderr = open(DATA / 'sns-run.log', 'a', encoding='utf-8', buffering=1)
    else:
        sys.stdout.reconfigure(encoding='utf-8')
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'web'
    if cmd == 'web':
        from snsauto.web import app
        port = config()['web_port']
        print(f'확인 화면: http://localhost:{port}')
        app.run(host='127.0.0.1', port=port, threaded=True)
    elif cmd == 'tick':
        try:
            print(jobs.tick())
        except Exception as e:
            log('tick_error', error=str(e))
            raise
    elif cmd == 'status':
        print('\n'.join(jobs.status()))
    else:
        print(__doc__)


if __name__ == '__main__':
    main()
