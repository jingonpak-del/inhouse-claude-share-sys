"""확인 화면: 소재 등록, 게시글 확인·승인, 답글 확인·등록, 설정.

이 컴퓨터에서는 http://localhost:3088 로 로그인 없이 열린다.
밖에서는 https://sns.zumma.kr — zumma.kr 대시보드의 📱 SNS자동화 버튼이 붙여 주는 서명 토큰(/sso?t=)으로만 들어온다.
"""
import base64, hashlib, hmac, json, threading, time
from datetime import datetime, timedelta

from flask import (Flask, abort, flash, redirect, render_template_string, request, send_from_directory, session,
                   url_for)

from . import images, jobs
from .common import (KST, PLATFORM_KO, PLATFORMS, ROOT, check_text, config, edit, find, iso, job_lock, load,
                     log, new_id, now, parse_iso, resolve)

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 60 * 1024 * 1024


# ---------------- 로그인 (zumma.kr SSO) ----------------
# 업무관리 서버(server.js)와 같은 방식: base64url("이름|만료ms") + "." + HMAC-SHA256(internalSecret) 16진수

def _zumma_secret():
    f = resolve(config()['zumma_server_dir']) / 'config.json'
    try:
        return json.loads(f.read_text(encoding='utf-8')).get('internalSecret', '')
    except (OSError, ValueError):
        return ''


def _employees():
    f = resolve(config()['zumma_server_dir']) / 'employees.txt'
    try:
        lines = f.read_text(encoding='utf-8-sig').splitlines()
    except OSError:
        return set()
    return {ln.replace('*', '').strip() for ln in lines if ln.strip() and not ln.lstrip().startswith('#')}


def sso_name(token):
    """서명이 맞고, 만료 전이고, 지금 직원 목록에 있으면 이름. 아니면 빈 문자열."""
    secret = _zumma_secret()
    try:
        part, sig = token.split('.')
        payload = base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)).decode('utf-8')
    except (ValueError, UnicodeDecodeError):
        return ''
    good = hmac.new(secret.encode(), payload.encode('utf-8'), hashlib.sha256).hexdigest()
    if not secret or not hmac.compare_digest(good, sig):
        return ''
    name, _, exp = payload.partition('|')
    if not exp.isdigit() or int(exp) < time.time() * 1000:
        return ''
    return name if name in _employees() else ''


# 세션 쿠키 서명 키는 사내 공유 시크릿에서 따로 뽑아 쓴다(시크릿을 바꾸면 모두 다시 로그인)
app.secret_key = hmac.new(_zumma_secret().encode() or b'local-only', b'sns-session', hashlib.sha256).hexdigest()
# 세션 쿠키는 sns.zumma.kr(https)로 들어올 때만 쓴다. 이 컴퓨터(localhost)는 쿠키 없이 열린다.
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax', SESSION_COOKIE_SECURE=True,
                  PERMANENT_SESSION_LIFETIME=timedelta(hours=12))


def is_local():
    """이 컴퓨터 브라우저에서 바로 연 경우. Cloudflare 터널을 거친 요청에는 CF 헤더가 붙는다."""
    host = request.host.split(':')[0]
    return host in ('localhost', '127.0.0.1') and not request.headers.get('Cf-Ray') \
        and not request.headers.get('Cf-Connecting-Ip')


@app.before_request
def need_login():
    if request.endpoint == 'sso' or is_local() or session.get('name'):
        return None
    return render_template_string(LOGIN_PAGE, zumma=config()['zumma_url']), 401


@app.route('/sso')
def sso():
    name = sso_name(request.args.get('t', ''))
    if not name:
        return render_template_string(LOGIN_PAGE, zumma=config()['zumma_url'], bad=True), 401
    session.clear()
    session.permanent = True
    session['name'] = name
    log('login', who=name)
    return redirect(url_for('posts'))


def who():
    return session.get('name') or '이 컴퓨터'


def background(fn, *a):
    def run():
        with job_lock() as got:
            if got:
                fn(*a)
    threading.Thread(target=run, daemon=True).start()


def to_local_input(s):
    return parse_iso(s).strftime('%Y-%m-%dT%H:%M') if s else ''


def from_local_input(s):
    return iso(datetime.strptime(s, '%Y-%m-%dT%H:%M').replace(tzinfo=KST)) if s else ''


def fmt(s):
    if not s:
        return ''
    d = parse_iso(s)
    return f"{d:%m/%d} ({'월화수목금토일'[d.weekday()]}) {d:%H:%M}"


app.jinja_env.filters['fmt'] = fmt
app.jinja_env.filters['local_input'] = to_local_input


@app.route('/file/<path:rel>')
def file(rel):
    if not rel.startswith('data/uploads/'):
        abort(404)
    return send_from_directory(ROOT, rel)


# ---------------- 게시글 ----------------

POST_TABS = {'draft': ('확인 대기', ['draft']), 'approved': ('예약됨', ['approved', 'publishing']),
             'failed': ('실패', ['failed']), 'published': ('발행 완료', ['published']),
             'rejected': ('반려', ['rejected'])}


@app.route('/')
def home():
    return redirect(url_for('posts'))


@app.route('/posts')
def posts():
    tab = request.args.get('f', 'draft')
    if tab not in POST_TABS:
        tab = 'draft'
    allp = load('posts')
    mats = {m['id']: m for m in load('materials')}
    rows = [p for p in allp if p['status'] in POST_TABS[tab][1]]
    rows.sort(key=lambda p: p.get('scheduled_at') or p['created'], reverse=(tab in ('published', 'rejected')))
    counts = {k: sum(p['status'] in v[1] for p in allp) for k, v in POST_TABS.items()}
    pending = [m for m in mats.values() if m['status'] in ('new', 'processing')]
    errors = [m for m in mats.values() if m['status'] == 'error']
    for p in rows:
        p['problems'] = check_text(p['platform'], p['text'])
    return page('posts', POST_PAGE, tab=tab, tabs=POST_TABS, rows=rows, mats=mats, counts=counts,
                pending=pending, errors=errors)


@app.post('/post/<pid>/<action>')
def post_action(pid, action):
    f = request.form
    if action in ('save', 'approve'):
        with edit('posts') as ps:
            p = find(ps, pid)
            if 'text' in f:
                p['text'] = f['text'].replace('\r\n', '\n').strip()
            if p['status'] == 'approved' and f.get('scheduled_at'):
                p['scheduled_at'] = from_local_input(f['scheduled_at'])
        if action == 'approve':
            probs = jobs.approve_post(pid, from_local_input(f.get('scheduled_at', '')))
            if probs:
                flash('승인하지 못했어요: ' + ' '.join(probs), 'err')
            else:
                with edit('posts') as ps:
                    find(ps, pid)['approved_by'] = who()
                log('approved', post=pid, who=who())
                p = find(load('posts'), pid)
                flash(f"승인했어요. {fmt(p['scheduled_at'])}에 {PLATFORM_KO[p['platform']]}에 올라갑니다.", 'ok')
        else:
            flash('저장했어요.', 'ok')
    elif action == 'unapprove':
        with edit('posts') as ps:
            p = find(ps, pid)
            if p['status'] == 'approved':
                p['status'], p['scheduled_at'] = 'draft', ''
        flash('승인을 취소하고 확인 대기로 돌렸어요.', 'ok')
    elif action == 'publish_now':
        probs = jobs.approve_post(pid, iso(now()))
        if probs:
            flash('올리지 못했어요: ' + ' '.join(probs), 'err')
        else:
            log('publish_now', post=pid, who=who())
            jobs.publish_due(force_id=pid)
            p = find(load('posts'), pid)
            if p['status'] == 'published':
                flash('발행했어요.' + (' (모의 실행이라 실제로는 올라가지 않았어요)' if p.get('dry_run') else ''), 'ok')
            else:
                flash('발행 실패: ' + p.get('error', ''), 'err')
    elif action == 'retry':
        with edit('posts') as ps:
            p = find(ps, pid)
            p['status'], p['scheduled_at'], p['error'] = 'draft', '', ''
        flash('확인 대기로 돌렸어요. 고친 뒤 다시 승인해 주세요.', 'ok')
    elif action == 'reject':
        with edit('posts') as ps:
            find(ps, pid)['status'] = 'rejected'
        flash('반려했어요.', 'ok')
    elif action == 'rewrite':
        try:
            jobs.rewrite_post(pid, f.get('extra', ''))
            flash('다시 썼어요.', 'ok')
        except Exception as e:
            flash(f'다시 쓰지 못했어요: {e}', 'err')
    elif action == 'remove_image':
        with edit('posts') as ps:
            p = find(ps, pid)
            p['images'] = [x for x in p['images'] if x != f.get('image')]
    elif action == 'add_image':
        added = [images.save_upload(fo, fo.filename) for fo in request.files.getlist('images') if fo.filename]
        with edit('posts') as ps:
            find(ps, pid)['images'] += added
    return redirect(request.referrer or url_for('posts'))


# ---------------- 소재 등록 ----------------

@app.route('/new', methods=['GET', 'POST'])
def new_material():
    if request.method == 'POST':
        f = request.form
        chans = [p for p in PLATFORMS if f.get(p)]
        if not f.get('body', '').strip() or not chans:
            flash('내용과 채널을 하나 이상 넣어 주세요.', 'err')
            return redirect(url_for('new_material'))
        pics = [images.save_upload(fo, fo.filename) for fo in request.files.getlist('images') if fo.filename]
        m = {'id': new_id(), 'created': iso(now()), 'status': 'new', 'error': '',
             'title': f.get('title', '').strip(), 'body': f['body'].strip(), 'link': f.get('link', '').strip(),
             'deadline': f.get('deadline', '').strip(), 'channels': chans, 'images': pics,
             'ai_image': bool(f.get('ai_image')) and not pics, 'image_hint': f.get('image_hint', '').strip()}
        with edit('materials') as ms:
            ms.append(m)
        log('material', material=m['id'], title=m['title'])
        background(jobs.process_materials)
        flash('소재를 등록했어요. 초안을 만드는 중이에요(1~2분, AI 이미지는 5~10분). 잠시 뒤 새로고침해 주세요.', 'ok')
        return redirect(url_for('posts'))
    return page('new', NEW_PAGE)


@app.post('/material/<mid>/retry')
def material_retry(mid):
    with edit('materials') as ms:
        find(ms, mid)['status'] = 'new'
    background(jobs.process_materials)
    flash('다시 만드는 중이에요.', 'ok')
    return redirect(url_for('posts'))


# ---------------- 답글 ----------------

REPLY_TABS = {'pending': ('확인 대기', ['pending', 'failed']), 'sent': ('등록 완료', ['sent', 'sending']),
              'skipped': ('건너뜀', ['skipped'])}
KIND_KO = {'simple': '단순', 'inquiry': '문의', 'complaint': '불만', 'sensitive': '민감', 'spam': '스팸', '': '?'}


@app.route('/replies')
def replies():
    tab = request.args.get('f', 'pending')
    if tab not in REPLY_TABS:
        tab = 'pending'
    allr = load('replies')
    rows = sorted([r for r in allr if r['status'] in REPLY_TABS[tab][1]], key=lambda r: r['created'],
                  reverse=True)
    counts = {k: sum(r['status'] in v[1] for r in allr) for k, v in REPLY_TABS.items()}
    return page('replies', REPLY_PAGE, tab=tab, tabs=REPLY_TABS, rows=rows, counts=counts, kind_ko=KIND_KO)


@app.post('/reply/<rid>/<action>')
def reply_action(rid, action):
    f = request.form
    if 'draft' in f:
        with edit('replies') as rs:
            find(rs, rid)['draft'] = f['draft'].replace('\r\n', '\n').strip()
    if action == 'send':
        log('reply_approved', reply=rid, who=who())
        st = jobs.send_reply(rid)
        r = find(load('replies'), rid)
        if st == 'sent':
            flash('답글을 등록했어요.' + (' (모의 실행)' if str(r.get('remote_id', '')).startswith('dry-') else ''), 'ok')
        else:
            flash('등록하지 못했어요: ' + r.get('error', ''), 'err')
    elif action == 'skip':
        with edit('replies') as rs:
            find(rs, rid)['status'] = 'skipped'
        flash('건너뛰었어요.', 'ok')
    elif action == 'restore':
        with edit('replies') as rs:
            find(rs, rid)['status'] = 'pending'
    elif action == 'rewrite':
        try:
            jobs.rewrite_reply(rid, f.get('extra', ''))
            flash('다시 썼어요.', 'ok')
        except Exception as e:
            flash(f'다시 쓰지 못했어요: {e}', 'err')
    else:
        flash('저장했어요.', 'ok')
    return redirect(request.referrer or url_for('replies'))


@app.post('/check-comments')
def check_now():
    background(jobs.check_comments, True)
    flash('댓글을 확인하는 중이에요. 잠시 뒤 새로고침해 주세요.', 'ok')
    return redirect(url_for('replies'))


# ---------------- 설정 ----------------

@app.route('/settings', methods=['GET', 'POST'])
def settings():
    if request.method == 'POST':
        with edit('settings') as s:
            s['reply_mode'] = 'auto' if request.form.get('reply_mode') == 'auto' else 'approve'
            s['hold_sensitive'] = bool(request.form.get('hold_sensitive'))
        log('settings', who=who(), reply_mode=request.form.get('reply_mode'))
        flash('설정을 저장했어요.', 'ok')
        return redirect(url_for('settings'))
    return page('settings', SETTINGS_PAGE, s=load('settings'), status=jobs.status(), cfg=config())


def page(active, body, **kw):
    return render_template_string(LAYOUT.replace('{BODY}', body), active=active, ko=PLATFORM_KO,
                                  dry=config().get('dry_run'), me=session.get('name', ''),
                                  zumma=config()['zumma_url'],
                                  n_reply=sum(r['status'] in ('pending', 'failed') for r in load('replies')),
                                  n_draft=sum(p['status'] == 'draft' for p in load('posts')), **kw)


LAYOUT = r'''<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>더줌 SNS 자동화</title>
<style>
:root{--bg:#f6f5f2;--card:#fff;--ink:#222;--sub:#6b6b6b;--line:#e3e1dc;--acc:#e0457b;--ok:#2f8f5b;--warn:#b7791f;--err:#c53030;--ig:#c13584;--th:#111}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,"Malgun Gothic",sans-serif}
header{background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
.wrap{max-width:980px;margin:0 auto;padding:0 16px}
.top{display:flex;align-items:center;gap:18px;height:56px}.brand{font-weight:700}
nav a{color:var(--sub);text-decoration:none;padding:6px 10px;border-radius:8px}nav a.on{background:#fbe6ee;color:var(--acc);font-weight:600}
.dry{margin-left:auto;font-size:13px;background:#fff4e0;color:var(--warn);padding:3px 10px;border-radius:99px}
.badge{display:inline-block;min-width:18px;padding:0 6px;border-radius:99px;background:var(--acc);color:#fff;font-size:12px;text-align:center}
main{padding:20px 0 60px}.tabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
.tabs a{padding:6px 12px;border-radius:99px;background:#fff;border:1px solid var(--line);color:var(--sub);text-decoration:none;font-size:14px}
.tabs a.on{border-color:var(--acc);color:var(--acc);font-weight:600}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:14px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.meta{color:var(--sub);font-size:13px}
.plat{font-weight:700;font-size:13px;padding:2px 8px;border-radius:6px;color:#fff}.plat.instagram{background:var(--ig)}.plat.threads{background:var(--th)}
textarea{width:100%;min-height:180px;border:1px solid var(--line);border-radius:8px;padding:10px;font:inherit;resize:vertical}
input[type=text],input[type=url],input[type=datetime-local],input:not([type]){border:1px solid var(--line);border-radius:8px;padding:7px 10px;font:inherit}
.full{width:100%}
button{font:inherit;border:1px solid var(--line);background:#fff;border-radius:8px;padding:7px 14px;cursor:pointer}
button.pri{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}button.ghost{color:var(--sub)}
.thumbs{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.thumbs figure{margin:0;position:relative}
.thumbs img{width:110px;height:110px;object-fit:cover;border-radius:8px;border:1px solid var(--line)}
.thumbs button{position:absolute;top:4px;right:4px;padding:0 6px;font-size:12px}
.note{background:#fff8e6;border-radius:8px;padding:8px 10px;font-size:14px;margin:8px 0}
.prob{background:#fdecec;color:var(--err);border-radius:8px;padding:8px 10px;font-size:14px;margin:8px 0}
.flash{padding:10px 14px;border-radius:8px;margin-bottom:12px}.flash.ok{background:#e8f5ee;color:var(--ok)}.flash.err{background:#fdecec;color:var(--err)}
.count{font-size:12px;color:var(--sub);text-align:right}label.chk{display:inline-flex;gap:6px;align-items:center;margin-right:14px}
.field{margin-bottom:14px}.field>b{display:block;margin-bottom:4px}.help{color:var(--sub);font-size:13px}
.comment{background:#f3f2ef;border-radius:8px;padding:10px;margin:8px 0}details summary{cursor:pointer;color:var(--sub);font-size:13px}
.empty{color:var(--sub);text-align:center;padding:40px 0}a{color:var(--acc)}
button.armed{background:var(--err);border-color:var(--err);color:#fff;font-weight:600}
</style></head><body>
<header><div class="wrap top"><span class="brand">더줌 SNS</span>
<nav><a href="/posts" class="{{'on' if active=='posts'}}">게시글 {% if n_draft %}<span class="badge">{{n_draft}}</span>{% endif %}</a>
<a href="/new" class="{{'on' if active=='new'}}">소재 등록</a>
<a href="/replies" class="{{'on' if active=='replies'}}">답댓글 {% if n_reply %}<span class="badge">{{n_reply}}</span>{% endif %}</a>
<a href="/settings" class="{{'on' if active=='settings'}}">설정</a></nav>
{% if dry %}<span class="dry">모의 실행 중</span>{% endif %}
{% if me %}<span class="meta" style="{{'' if dry else 'margin-left:auto'}}">{{me}} · <a href="{{zumma}}">대시보드</a></span>{% endif %}</div></header>
<main class="wrap">
{% for cat,msg in get_flashed_messages(with_categories=true) %}<div class="flash {{cat}}">{{msg}}</div>{% endfor %}
{BODY}
</main>
<script>
// '지금 발행'은 확인 창(confirm) 대신 두 번 누르기로 받는다.
// 휴대폰 앱 안 브라우저(카카오톡·네이버 등)는 확인 창을 막아 버려서 눌러도 아무 일이 없었다.
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('button.twice');
  if (!b) return;
  if (b.dataset.sent) { e.preventDefault(); return; }
  if (!b.dataset.armed) {
    e.preventDefault();
    b.dataset.armed = '1'; b.dataset.label = b.textContent;
    b.textContent = '한 번 더 누르면 바로 올라가요'; b.classList.add('armed');
    setTimeout(function () {
      if (b.dataset.sent) return;
      delete b.dataset.armed; b.textContent = b.dataset.label; b.classList.remove('armed');
    }, 8000);
    return;
  }
  b.dataset.sent = '1';
  setTimeout(function () { b.textContent = '올리는 중… (최대 1분)'; }, 0);
});
</script></body></html>'''

POST_PAGE = r'''
<div class="tabs">{% for k,v in tabs.items() %}<a href="?f={{k}}" class="{{'on' if tab==k}}">{{v[0]}} {{counts[k]}}</a>{% endfor %}</div>
{% for m in pending %}<div class="note">⏳ '{{m.title or m.body[:20]}}' 초안을 만드는 중이에요… (새로고침해서 확인)</div>{% endfor %}
{% for m in errors %}<div class="prob">'{{m.title or m.body[:20]}}' 초안 만들기 실패: {{m.error}}
<form method="post" action="/material/{{m.id}}/retry" style="display:inline"><button>다시 시도</button></form></div>{% endfor %}
{% for p in rows %}{% set m = mats.get(p.material_id, {}) %}
<div class="card">
 <div class="row"><span class="plat {{p.platform}}">{{ko[p.platform]}}</span><b>{{m.title or '(제목 없음)'}}</b>
  <span class="meta">{% if p.scheduled_at %}· 예약 {{p.scheduled_at|fmt}}{% endif %}{% if p.published_at %}· 발행 {{p.published_at|fmt}}{% endif %}{% if p.dry_run %} (모의){% endif %}</span>
  {% if p.permalink %}<a href="{{p.permalink}}" target="_blank" class="meta">게시물 보기 ↗</a>{% endif %}</div>
 <div class="thumbs">{% for im in p.images %}<figure><img src="/file/{{im}}">
  {% if p.status=='draft' %}<form method="post" action="/post/{{p.id}}/remove_image"><input type="hidden" name="image" value="{{im}}"><button title="빼기">✕</button></form>{% endif %}</figure>{% endfor %}
  {% if not p.images %}<span class="meta">{{'사진 없음 — 인스타그램은 사진이 필요해요' if p.platform=='instagram' else '사진 없이 글만 올라가요'}}</span>{% endif %}</div>
 {% if p.status=='draft' %}<form method="post" action="/post/{{p.id}}/add_image" enctype="multipart/form-data" class="row" style="margin-bottom:8px">
  <input type="file" name="images" multiple accept="image/*"><button>사진 추가</button></form>{% endif %}
 {% if p.notes %}<div class="note">📝 확인할 점: {{p.notes}}</div>{% endif %}
 {% if p.error %}<div class="prob">오류: {{p.error}}</div>{% endif %}
 {% if p.status in ('draft','approved') %}{% for x in p.problems %}<div class="prob">{{x}}</div>{% endfor %}{% endif %}
 <form method="post" action="/post/{{p.id}}/save">
  <textarea name="text" oninput="this.nextElementSibling.textContent=this.value.length+'자'" {{'readonly' if p.status not in ('draft','approved','failed')}}>{{p.text}}</textarea>
  <div class="count">{{p.text|length}}자</div>
  <div class="row">
  {% if p.status=='draft' %}
   <span class="meta">예약 시각(비우면 자동)</span><input type="datetime-local" name="scheduled_at">
   <button class="pri" formaction="/post/{{p.id}}/approve">승인</button>
   <button formaction="/post/{{p.id}}/save">저장</button>
   <button class="twice" formaction="/post/{{p.id}}/publish_now">지금 발행</button>
   <button class="ghost" formaction="/post/{{p.id}}/reject">반려</button>
  {% elif p.status=='approved' %}
   <span class="meta">예약 시각</span><input type="datetime-local" name="scheduled_at" value="{{p.scheduled_at|local_input}}">
   <button class="pri" formaction="/post/{{p.id}}/save">저장</button>
   <button class="twice" formaction="/post/{{p.id}}/publish_now">지금 발행</button>
   <button class="ghost" formaction="/post/{{p.id}}/unapprove">승인 취소</button>
  {% elif p.status=='failed' %}
   <button class="pri" formaction="/post/{{p.id}}/retry">고쳐서 다시 승인하기</button>
  {% endif %}</div>
 </form>
 {% if p.status=='draft' %}<details><summary>Claude에게 다시 쓰게 하기</summary>
  <form method="post" action="/post/{{p.id}}/rewrite" class="row" style="margin-top:8px">
  <input name="extra" class="full" placeholder="예) 더 짧게, 마감 임박 강조, 이모지 줄이기"><button>다시 쓰기</button></form></details>{% endif %}
</div>
{% else %}<div class="empty">{{'확인할 게시글이 없어요. 소재 등록에서 이벤트·체험단 내용을 넣어 주세요.' if tab=='draft' else '없어요.'}}</div>{% endfor %}
'''

NEW_PAGE = r'''
<div class="card"><form method="post" enctype="multipart/form-data">
 <div class="field"><b>제목</b><input name="title" class="full" placeholder="예) 김해 키즈카페 체험단 10가족 모집"></div>
 <div class="field"><b>내용 *</b><textarea name="body" required placeholder="카페 공지 내용을 그대로 붙여 넣어도 돼요. 일정·장소·대상·혜택·신청 방법을 넣어 주세요."></textarea>
  <div class="help">여기 적힌 사실만 글에 들어가요. 없는 정보는 지어내지 않고 '확인할 점'으로 알려 드려요.</div></div>
 <div class="field"><b>카페 글 주소</b><input name="link" type="url" class="full" placeholder="https://cafe.naver.com/..."></div>
 <div class="field"><b>신청 마감</b><input name="deadline" placeholder="예) 11월 5일(수) 자정"></div>
 <div class="field"><b>올릴 채널 *</b><label class="chk"><input type="checkbox" name="instagram" checked>인스타그램</label>
  <label class="chk"><input type="checkbox" name="threads" checked>스레드</label></div>
 <div class="field"><b>사진</b><input type="file" name="images" multiple accept="image/*">
  <div class="help">여러 장이면 넘겨 보는 게시물(캐러셀)로 올라가요. 인스타그램 10장, 스레드 20장까지.</div></div>
 <div class="field"><label class="chk"><input type="checkbox" name="ai_image">사진이 없으면 AI로 카드 이미지 만들기</label>
  <input name="image_hint" class="full" placeholder="(선택) 이미지 요청 — 예) 가을 단풍 느낌, 분홍·베이지 톤" style="margin-top:6px"></div>
 <button class="pri">등록하고 초안 만들기</button>
</form></div>'''

REPLY_PAGE = r'''
<div class="row" style="justify-content:space-between"><div class="tabs">{% for k,v in tabs.items() %}<a href="?f={{k}}" class="{{'on' if tab==k}}">{{v[0]}} {{counts[k]}}</a>{% endfor %}</div>
<form method="post" action="/check-comments"><button>지금 댓글 확인</button></form></div>
{% for r in rows %}<div class="card">
 <div class="row"><span class="plat {{r.platform}}">{{ko[r.platform]}}</span><span class="meta">{{r.created|fmt}} · 분류: {{kind_ko.get(r.kind, r.kind)}}{% if r.needs_human %} · ⚠️ 직접 확인 필요{% endif %}</span>
 {% if r.permalink %}<a href="{{r.permalink}}" target="_blank" class="meta">게시물 ↗</a>{% endif %}</div>
 <details><summary>게시글 내용</summary><div class="meta" style="white-space:pre-wrap">{{r.post_text}}</div></details>
 <div class="comment"><b>@{{r.username}}</b> {{r.comment_text}}</div>
 {% if r.reason %}<div class="meta">판단: {{r.reason}}</div>{% endif %}
 {% if r.error %}<div class="prob">{{r.error}}</div>{% endif %}
 <form method="post" action="/reply/{{r.id}}/save">
  <textarea name="draft" style="min-height:80px" {{'readonly' if r.status not in ('pending','failed')}}>{{r.draft}}</textarea>
  <div class="row" style="margin-top:8px">
  {% if r.status in ('pending','failed') %}
   <button class="pri" formaction="/reply/{{r.id}}/send">승인하고 등록</button>
   <button formaction="/reply/{{r.id}}/save">저장</button>
   <button class="ghost" formaction="/reply/{{r.id}}/skip">건너뛰기</button>
  {% elif r.status=='skipped' %}<button formaction="/reply/{{r.id}}/restore">다시 확인 대기로</button>{% endif %}</div>
 </form>
 {% if r.status in ('pending','failed') %}<details><summary>Claude에게 다시 쓰게 하기</summary>
  <form method="post" action="/reply/{{r.id}}/rewrite" class="row" style="margin-top:8px">
  <input name="extra" class="full" placeholder="예) 카페 공지 확인을 안내해 줘"><button>다시 쓰기</button></form></details>{% endif %}
</div>{% else %}<div class="empty">없어요.</div>{% endfor %}'''

LOGIN_PAGE = r'''<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>더줌 SNS 자동화</title>
<style>body{margin:0;background:#f6f5f2;font:15px/1.6 -apple-system,"Malgun Gothic",sans-serif;color:#222;display:grid;place-items:center;min-height:100vh}
.box{background:#fff;border:1px solid #e3e1dc;border-radius:12px;padding:28px 24px;max-width:360px;margin:16px;text-align:center}
a{display:inline-block;margin-top:14px;background:#e0457b;color:#fff;text-decoration:none;padding:9px 18px;border-radius:8px;font-weight:600}</style></head>
<body><div class="box"><b>📱 더줌 SNS 자동화</b>
<p>{{'로그인 정보가 만료됐거나 맞지 않아요.' if bad else '로그인이 필요해요.'}}<br>업무관리 대시보드의 <b>📱 SNS자동화</b> 버튼으로 들어와 주세요.</p>
<a href="{{zumma}}">업무관리 대시보드로</a></div></body></html>'''

SETTINGS_PAGE = r'''
<div class="card"><b>연결 상태</b><ul>{% for s in status %}<li>{{s}}</li>{% endfor %}</ul>
<div class="help">모의 실행 끄기·발행 시각 바꾸기는 <code>config.json</code>, 토큰은 <code>.env</code> 에서 고칩니다.</div></div>
<div class="card"><form method="post">
 <div class="field"><b>답댓글 방식</b>
  <label class="chk"><input type="radio" name="reply_mode" value="approve" {{'checked' if s.reply_mode!='auto'}}>승인 후 등록</label>
  <label class="chk"><input type="radio" name="reply_mode" value="auto" {{'checked' if s.reply_mode=='auto'}}>완전 자동</label></div>
 <div class="field"><label class="chk"><input type="checkbox" name="hold_sensitive" {{'checked' if s.hold_sensitive}}>완전 자동이어도 불만·민감·답하기 어려운 문의는 확인 대기로 남기기 (추천)</label></div>
 <button class="pri">저장</button></form></div>
<div class="card"><b>발행 시각</b>
{% for p, times in cfg.slots.items() %}<div>{{ko[p]}}: {{times|join(', ')}} (하루 최대 {{times|length}}개)</div>{% endfor %}</div>'''
