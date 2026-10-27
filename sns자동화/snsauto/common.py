"""공통: 경로, 설정, 비밀 값, 시간, JSON 저장소(잠금), 기록."""
import contextlib, json, os, re, secrets, time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
UPLOADS = DATA / 'uploads'
LOG = DATA / 'log.jsonl'
KST = timezone(timedelta(hours=9))  # 한국은 서머타임이 없어서 고정 +9 로 충분하다

PLATFORMS = ('instagram', 'threads')
PLATFORM_KO = {'instagram': '인스타그램', 'threads': '스레드'}


def now():
    return datetime.now(KST)


def iso(dt):
    return dt.astimezone(KST).isoformat(timespec='seconds')


def parse_iso(s):
    return datetime.fromisoformat(s) if s else None


def new_id():
    return secrets.token_hex(6)


def config():
    with open(ROOT / 'config.json', encoding='utf-8') as f:
        return json.load(f)


def resolve(rel):
    """config 에 적힌 상대 경로는 이 폴더 기준으로 푼다."""
    p = Path(rel)
    return p if p.is_absolute() else (ROOT / p).resolve()


def env(name):
    """.env 값을 먼저 보고, 없으면 환경 변수를 본다."""
    f = ROOT / '.env'
    if f.exists():
        for line in f.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                if k.strip() == name and v.strip():
                    return v.strip()
    return os.environ.get(name, '')


def log(kind, **kw):
    DATA.mkdir(exist_ok=True)
    rec = {'at': iso(now()), 'kind': kind, **kw}
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(json.dumps(rec, ensure_ascii=False) + '\n')


# ---------------- 저장소 ----------------
# materials.json(소재) / posts.json(게시글) / replies.json(답글) / state.json(토큰·확인 시각) / settings.json(화면에서 바꾸는 설정)
# 확인 화면과 10분마다 도는 작업이 같은 파일을 만지므로, 읽고-고치고-쓰는 동안 잠금 파일로 막는다.
# API 호출처럼 오래 걸리는 일은 잠금 밖에서 한다.

DEFAULTS = {
    'materials': [], 'posts': [], 'replies': [],
    'state': {}, 'settings': {'reply_mode': 'approve', 'hold_sensitive': True},
}


@contextlib.contextmanager
def _locked(name, stale=30):
    DATA.mkdir(exist_ok=True)
    lock = DATA / f'.{name}.lock'
    start = time.time()
    while True:
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
            break
        except FileExistsError:
            try:
                if time.time() - lock.stat().st_mtime > stale:
                    lock.unlink()  # 프로그램이 죽으며 남긴 잠금
                    continue
            except FileNotFoundError:
                continue
            if time.time() - start > stale + 5:
                raise TimeoutError(f'{name} 잠금을 얻지 못했습니다')
            time.sleep(0.1)
    try:
        yield
    finally:
        with contextlib.suppress(FileNotFoundError):
            lock.unlink()


def load(name):
    f = DATA / f'{name}.json'
    if not f.exists():
        return json.loads(json.dumps(DEFAULTS[name]))
    with open(f, encoding='utf-8') as fp:
        return json.load(fp)


def _save(name, data):
    f = DATA / f'{name}.json'
    tmp = f.with_suffix('.tmp')
    with open(tmp, 'w', encoding='utf-8') as fp:
        json.dump(data, fp, ensure_ascii=False, indent=1)
    os.replace(tmp, f)


@contextlib.contextmanager
def edit(name):
    """with edit('posts') as posts: ... 로 고치면 끝날 때 저장된다."""
    with _locked('store'):
        data = load(name)
        yield data
        _save(name, data)


@contextlib.contextmanager
def job_lock():
    """발행·소재 처리·댓글 확인이 두 곳에서 동시에 돌지 않게 막는다. 이미 돌고 있으면 None."""
    DATA.mkdir(exist_ok=True)
    lock = DATA / '.job.lock'
    try:
        if lock.exists() and time.time() - lock.stat().st_mtime > 3600:
            lock.unlink()  # 한 시간 넘은 잠금은 죽은 것으로 본다(AI 이미지 생성이 길어도 15분)
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.close(fd)
    except FileExistsError:
        yield None
        return
    try:
        yield True
    finally:
        with contextlib.suppress(FileNotFoundError):
            lock.unlink()


def find(items, item_id):
    return next((x for x in items if x['id'] == item_id), None)


# ---------------- 글 점검 ----------------
# 옛 카페 이름은 쓰지 않는다. '김해줌마렐라' 안에 '김해줌마'가 들어 있으므로 뒤에 '렐라'가 오면 괜찮다.
BANNED = [(re.compile(r'마산맘'), '창원줌마렐라'), (re.compile(r'김해줌마(?!렐라)'), '김해줌마렐라')]


def fix_names(text):
    for pat, repl in BANNED:
        text = pat.sub(repl, text)
    return text


def check_text(platform, text, cfg=None):
    """발행 전에 걸리는 문제를 사람이 읽을 문장으로 돌려준다. 빈 목록이면 통과."""
    cfg = cfg or config()
    out = []
    if not text.strip():
        out.append('글이 비어 있어요.')
    for pat, repl in BANNED:
        if pat.search(text):
            out.append(f"옛 카페 이름이 들어 있어요 → '{repl}'로 바꿔 주세요.")
    if platform == 'threads' and len(text) > cfg['threads_max_chars']:
        out.append(f"스레드는 {cfg['threads_max_chars']}자까지예요(지금 {len(text)}자).")
    if platform == 'instagram':
        if len(text) > cfg['instagram_max_chars']:
            out.append(f"인스타그램 캡션은 {cfg['instagram_max_chars']}자까지예요(지금 {len(text)}자).")
        tags = re.findall(r'#\S+', text)
        if len(tags) > cfg['instagram_max_hashtags']:
            out.append(f"해시태그가 {len(tags)}개예요. {cfg['instagram_max_hashtags']}개 이하로 줄여 주세요.")
    return out
