"""할 일: 소재로 초안 만들기, 예약 시각 잡기, 발행, 댓글 확인, 답글 등록, 토큰 갱신.

tick() 이 10분마다 불려서 이 일들을 차례로 한다(작업 스케줄러).
게시글·답글·소재에는 account(계정 키)가 붙어 있고, 계정마다 토큰·말투·발행 시각이 따로다.
"""
from datetime import datetime, timedelta

from . import images, meta, writer
from .common import (PLATFORM_KO, account_of, accounts, check_text, config, default_key, edit, find,
                     iso, is_dry, job_lock, load, log, new_id, now, parse_iso)


# ---------------- 소재 → 초안 ----------------

def process_materials():
    """새로 등록한 소재마다 인스타·스레드 초안을 만든다."""
    todo = [m for m in load('materials') if m['status'] == 'new']
    for m in todo:
        with edit('materials') as ms:
            find(ms, m['id'])['status'] = 'processing'
        try:
            make_drafts(m)
            status, err = 'done', ''
        except Exception as e:  # 한 소재가 실패해도 다음 소재는 계속한다
            status, err = 'error', str(e)
            log('material_error', material=m['id'], error=err)
        with edit('materials') as ms:
            x = find(ms, m['id'])
            x['status'], x['error'] = status, err


def make_drafts(m, only=None, extra=''):
    """소재 m 으로 초안을 만든다. only 를 주면 그 채널 게시글 하나만 다시 쓴다."""
    acc = account_of(m)
    out = writer.write_posts(m, acc, extra)
    pics = list(m.get('images', []))
    if not pics and m.get('ai_image') and 'instagram' in m['channels'] and only in (None, 'instagram'):
        pics = [images.ai_image(out['image_prompt'])]
        with edit('materials') as ms:
            find(ms, m['id'])['images'] = pics
    created = []
    for p in m['channels']:
        if only and p != only:
            continue
        created.append({
            'id': new_id(), 'account': acc['key'], 'material_id': m['id'], 'platform': p, 'status': 'draft',
            'text': out[p]['text'], 'notes': out[p]['notes'],
            # 스레드는 글만 올려도 되지만 사진이 있으면 같이 올린다
            'images': pics, 'image_prompt': out['image_prompt'],
            'scheduled_at': '', 'created': iso(now()),
        })
    with edit('posts') as ps:
        ps.extend(created)
    log('drafts', material=m['id'], posts=[c['id'] for c in created])
    return created


def rewrite_post(post_id, extra=''):
    p = find(load('posts'), post_id)
    m = find(load('materials'), p['material_id'])
    out = writer.write_posts(m, account_of(m), extra)
    with edit('posts') as ps:
        x = find(ps, post_id)
        x['text'], x['notes'] = out[x['platform']]['text'], out[x['platform']]['notes']
        x['status'] = 'draft'


# ---------------- 예약 ----------------

def next_slot(platform, acc, posts=None, after=None):
    """그 계정·채널의 비어 있는 가장 가까운 발행 시각. 하루 최대 개수 = 시각 개수."""
    slots = acc['slots'][platform]
    dkey = default_key()
    posts = posts if posts is not None else load('posts')
    taken = {p['scheduled_at'] for p in posts
             if p['platform'] == platform and (p.get('account') or dkey) == acc['key']
             and p['status'] in ('approved', 'publishing', 'published')}
    start = after or now() + timedelta(minutes=5)
    for d in range(60):
        day = (start + timedelta(days=d)).date()
        for hm in sorted(slots):
            h, mi = map(int, hm.split(':'))
            t = datetime(day.year, day.month, day.day, h, mi, tzinfo=start.tzinfo)
            if t >= start and iso(t) not in taken:
                return iso(t)
    raise RuntimeError('60일 안에 빈 발행 시각이 없어요.')


def approve_post(post_id, when=''):
    """승인. when 이 비어 있으면 빈 시각에 자동 예약. 문제가 있으면 문장 목록을 돌려준다."""
    with edit('posts') as ps:
        p = find(ps, post_id)
        acc = account_of(p)
        probs = check_text(p['platform'], p['text'], acc)
        if p['platform'] == 'instagram' and not p.get('images'):
            probs.append('인스타그램은 사진이 꼭 있어야 해요.')
        if probs:
            return probs
        p['scheduled_at'] = when or next_slot(p['platform'], acc, ps)
        p['status'] = 'approved'
        p['approved_at'] = iso(now())
    return []


# ---------------- 발행 ----------------

def publish_due(force_id=None):
    """예약 시각이 지난 승인 게시글을 올린다. force_id 는 지금 바로 올릴 게시글."""
    t = now()
    with edit('posts') as ps:
        due = [p for p in ps if p['status'] == 'approved'
               and (p['id'] == force_id or (not force_id and parse_iso(p['scheduled_at']) <= t))]
        for p in due:
            p['status'] = 'publishing'  # 다른 쪽에서 또 올리지 않게 먼저 표시
    for p in due:
        try:
            urls = images.publish_urls(p)
            r = meta.client(p['platform'], account_of(p)).publish(p['text'], urls)
            upd = {'status': 'published', 'published_at': iso(now()), 'remote_id': r['id'],
                   'permalink': r.get('permalink', ''), 'error': '', 'dry_run': r['id'].startswith('dry-')}
            log('published', post=p['id'], account=p.get('account'), platform=p['platform'], remote=r['id'])
        except Exception as e:
            upd = {'status': 'failed', 'error': str(e)}
            log('publish_error', post=p['id'], platform=p['platform'], error=str(e))
        with edit('posts') as ps:
            find(ps, p['id']).update(upd)
    return len(due)


# ---------------- 댓글 → 답글 ----------------

def check_comments(force=False):
    """최근 게시물의 새 댓글을 모아 답글 초안을 만든다. 설정이 '자동'이면 바로 등록한다."""
    cfg = config()
    st = load('state')
    last = parse_iso(st.get('last_comment_check', ''))
    if not force and last and now() - last < timedelta(minutes=cfg['comment_check_minutes']):
        return 0
    with edit('state') as s:
        s['last_comment_check'] = iso(now())
        # 처음 켠 시각 이전 댓글에는 답하지 않는다(예전 댓글에 한꺼번에 답글이 달리는 것 방지).
        # 나중에 추가한 계정도 그 계정을 처음 확인한 시각부터 센다. 예전 기록(started_at)은 기본 계정 것이다.
        s.setdefault('started_at', iso(now()))
        started_by = s.setdefault('started_by_account', {})
        started_by.setdefault(default_key(), s['started_at'])
        for key in accounts():
            started_by.setdefault(key, iso(now()))
        started = {k: parse_iso(v) for k, v in started_by.items()}
    known = {r['comment_id'] for r in load('replies')}
    found = 0
    for acc in accounts().values():
        for plat in acc['channels']:
            c = meta.client(plat, acc)
            if c.dry or not c.tok:
                continue
            try:
                me = c.me()
                for post in c.recent_posts(cfg['comment_lookback_posts']):
                    for cm in c.comments(post['id'], me['username']):
                        ts = meta.comment_time(cm['timestamp'])
                        if cm['id'] in known or (ts and ts < started[acc['key']]):
                            continue
                        known.add(cm['id'])
                        found += 1
                        _new_reply(acc, plat, post, cm)
            except Exception as e:
                log('comment_error', account=acc['key'], platform=plat, error=str(e))
    return found


def _new_reply(acc, plat, post, cm):
    rid = new_id()
    rec = {'id': rid, 'account': acc['key'], 'platform': plat, 'post_id': post['id'], 'post_text': post['text'][:1000],
           'permalink': post.get('permalink', ''), 'comment_id': cm['id'], 'comment_text': cm['text'],
           'username': cm['username'], 'created': iso(now()), 'status': 'pending',
           'draft': '', 'kind': '', 'needs_human': True, 'reason': '', 'error': ''}
    try:
        d = writer.write_reply(plat, post['text'], cm['text'], cm['username'], acc)
        rec.update(draft=d['reply'], kind=d['kind'], needs_human=d['needs_human'], reason=d['reason'])
    except Exception as e:
        rec['error'] = str(e)
    with edit('replies') as rs:
        rs.append(rec)
    settings = load('settings')
    if rec['error']:
        return
    if rec['kind'] == 'spam':
        with edit('replies') as rs:
            find(rs, rid)['status'] = 'skipped'
        return
    hold = settings.get('hold_sensitive', True) and rec['needs_human']
    if settings.get('reply_mode') == 'auto' and not hold:
        send_reply(rid)


def rewrite_reply(reply_id, extra=''):
    r = find(load('replies'), reply_id)
    d = writer.write_reply(r['platform'], r['post_text'], r['comment_text'], r['username'], account_of(r), extra)
    with edit('replies') as rs:
        x = find(rs, reply_id)
        x.update(draft=d['reply'], kind=d['kind'], needs_human=d['needs_human'], reason=d['reason'], error='')


def send_reply(reply_id):
    with edit('replies') as rs:
        r = find(rs, reply_id)
        if r['status'] not in ('pending', 'failed'):
            return r['status']
        acc = account_of(r)
        probs = check_text(r['platform'], r['draft'], acc)
        if probs:
            r['error'] = ' '.join(probs)
            return 'blocked'
        r['status'] = 'sending'
    try:
        remote = meta.client(r['platform'], acc).reply(r['comment_id'], r['draft'])
        upd = {'status': 'sent', 'sent_at': iso(now()), 'remote_id': remote, 'error': ''}
        log('reply_sent', reply=reply_id, platform=r['platform'])
    except Exception as e:
        upd = {'status': 'failed', 'error': str(e)}
        log('reply_error', reply=reply_id, error=str(e))
    with edit('replies') as rs:
        find(rs, reply_id).update(upd)
    return upd['status']


# ---------------- 토큰 ----------------

def refresh_tokens():
    """일주일에 한 번 장기 토큰을 새로 받는다(60일이 지나면 만료되므로). 계정·채널마다 따로 센다."""
    st = load('state')
    for acc in accounts().values():
        for plat in acc['channels']:
            info = meta.saved_token(st, plat, acc)
            last = parse_iso(info.get('refreshed_at', '')) \
                or parse_iso(st.get('started_by_account', {}).get(acc['key'], '')) \
                or parse_iso(st.get('started_at', ''))
            if last and now() - last < timedelta(days=7):
                continue
            try:
                if meta.client(plat, acc).refresh():
                    log('token_refreshed', account=acc['key'], platform=plat)
            except Exception as e:
                log('token_error', account=acc['key'], platform=plat, error=str(e))


# ---------------- 10분마다 ----------------

def tick():
    with job_lock() as got:
        if not got:
            return '다른 작업이 돌고 있어 이번 차례는 건너뜀'
        n_pub = publish_due()
        process_materials()
        n_cm = check_comments()
        refresh_tokens()
        return f'발행 {n_pub}건, 새 댓글 {n_cm}건'


def status():
    """계정마다 연결 상태를 사람이 읽을 문장으로."""
    cfg = config()
    out = ['모의 실행 중(실제로 올리지 않음)' if cfg.get('dry_run') else '실제 발행 중']
    for key, acc in accounts(cfg, everything=True).items():
        if not acc.get('enabled', True):
            out.append(f"[{acc['name']}] 꺼 둠 (config.json 의 enabled)")
            continue
        head = f"[{acc['name']}{' · 모의 실행' if is_dry(acc, cfg) and not cfg.get('dry_run') else ''}]"
        for plat in acc['channels']:
            c = meta.client(plat, acc)
            if not c.tok:
                out.append(f'{head} {PLATFORM_KO[plat]}: 토큰 없음 (.env 의 {meta.token_env(plat, acc)})')
                continue
            try:
                me = c.me()
                out.append(f"{head} {PLATFORM_KO[plat]}: @{me['username']} 연결됨")
            except Exception as e:
                out.append(f'{head} {PLATFORM_KO[plat]}: 연결 실패 — {e}')
    return out
