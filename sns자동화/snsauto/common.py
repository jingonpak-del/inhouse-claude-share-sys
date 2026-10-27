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


# ---------------- 계정 ----------------
# config.json 의 accounts 에 계정(브랜드·제품·사이트)마다 말투 파일, 채널, 발행 시각, 토큰 이름을 적는다.
# 맨 위 계정이 기본 계정이다. account 표시가 없는 예전 게시글·답글·소재는 기본 계정 것으로 본다.

def accounts(cfg=None, everything=False):
    """{키: 계정 설정} — 꺼 둔 계정(enabled: false)은 everything=True 일 때만 들어간다."""
    cfg = cfg or config()
    return {k: {**a, 'key': k} for k, a in cfg['accounts'].items() if everything or a.get('enabled', True)}


def default_key(cfg=None):
    return next(iter((cfg or config())['accounts']))


def account(key=None, cfg=None):
    cfg = cfg or config()
    key = key or default_key(cfg)
    if key not in cfg['accounts']:
        raise ValueError(f"config.json 의 accounts 에 '{key}' 계정이 없어요.")
    return {**cfg['accounts'][key], 'key': key}


def account_of(item, cfg=None):
    """게시글·답글·소재가 속한 계정."""
    return account(item.get('account'), cfg)


def account_name(key, cfg=None):
    cfg = cfg or config()
    key = key or default_key(cfg)
    return cfg['accounts'].get(key, {}).get('name', key)


def is_dry(acc, cfg=None):
    """전체 dry_run 이 켜져 있거나 그 계정만 dry_run 이면 모의 실행."""
    cfg = cfg or config()
    return bool(cfg.get('dry_run') or acc.get('dry_run'))


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
# 계정마다 쓰지 않는 말을 config 의 replace_words 에 [정규식, 바꿀 말] 로 적는다.
# 예) 더줌: '마산맘' → '창원줌마렐라'. '김해줌마렐라' 안에 '김해줌마'가 들어 있어서 '김해줌마(?!렐라)' 로 적는다.

def _banned(acc):
    return [(re.compile(pat), repl) for pat, repl in acc.get('replace_words', [])]


def fix_names(text, acc):
    """Claude 가 쓴 글의 금지어는 자동으로 바꾼다."""
    for pat, repl in _banned(acc):
        text = pat.sub(repl, text)
    return text


def check_text(platform, text, acc, cfg=None):
    """발행 전에 걸리는 문제를 사람이 읽을 문장으로 돌려준다. 빈 목록이면 통과."""
    cfg = cfg or config()
    out = []
    if not text.strip():
        out.append('글이 비어 있어요.')
    if platform not in acc.get('channels', PLATFORMS):
        out.append(f"{acc['name']} 계정은 {PLATFORM_KO[platform]}에 연결돼 있지 않아요.")
    for pat, repl in _banned(acc):
        m = pat.search(text)
        if m:
            out.append(f"'{m.group(0)}'은(는) 쓰지 않는 말이에요 → '{repl}'로 바꿔 주세요.")
    if platform == 'threads' and len(text) > cfg['threads_max_chars']:
        out.append(f"스레드는 {cfg['threads_max_chars']}자까지예요(지금 {len(text)}자).")
    if platform == 'instagram':
        if len(text) > cfg['instagram_max_chars']:
            out.append(f"인스타그램 캡션은 {cfg['instagram_max_chars']}자까지예요(지금 {len(text)}자).")
        tags = re.findall(r'#\S+', text)
        if len(tags) > cfg['instagram_max_hashtags']:
            out.append(f"해시태그가 {len(tags)}개예요. {cfg['instagram_max_hashtags']}개 이하로 줄여 주세요.")
    return out
