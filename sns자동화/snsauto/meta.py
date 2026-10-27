"""인스타그램(Instagram API with Instagram Login)·스레드(Threads API) 공식 API 호출.

둘 다 '컨테이너 만들기 → 처리 끝날 때까지 기다리기 → 발행' 순서로 올린다.
dry_run 이면 실제로 부르지 않고 가짜 번호를 돌려준다.
"""
import time

import requests

from .common import config, edit, env, iso, load, log, new_id, now, parse_iso


class MetaError(Exception):
    pass


TOKEN_ENV = {'instagram': 'INSTAGRAM_ACCESS_TOKEN', 'threads': 'THREADS_ACCESS_TOKEN'}


def token(platform):
    """갱신해 둔 토큰이 있으면 그것을, 없으면 .env 의 토큰을 쓴다."""
    saved = load('state').get('tokens', {}).get(platform, {})
    first = env(TOKEN_ENV[platform])
    # .env 에 새 토큰을 넣으면 그게 우선이다(갱신본은 같은 .env 토큰에서 나온 것만 쓴다)
    if saved.get('token') and saved.get('from_env') == first[-12:]:
        return saved['token']
    return first


class Client:
    platform = ''
    refresh_url = ''
    refresh_grant = ''

    def __init__(self):
        self.cfg = config()
        self.dry = bool(self.cfg.get('dry_run'))
        self.base = self.cfg[f'{self.platform}_api']
        self.tok = token(self.platform)

    def ready(self):
        return self.dry or bool(self.tok)

    def _call(self, method, path, **params):
        if not self.tok:
            raise MetaError(f'{self.platform} 토큰이 없어요. .env 에 {TOKEN_ENV[self.platform]} 를 넣어 주세요.')
        url = path if path.startswith('http') else f'{self.base}/{path.lstrip("/")}'
        params['access_token'] = self.tok
        try:
            if method == 'GET':
                r = requests.get(url, params=params, timeout=60)
            else:
                r = requests.post(url, data=params, timeout=120)
        except requests.RequestException as e:
            raise MetaError(f'연결 실패: {e}')
        try:
            body = r.json()
        except ValueError:
            body = {}
        if r.status_code >= 400 or 'error' in body:
            err = body.get('error', {})
            msg = err.get('error_user_msg') or err.get('message') or r.text[:300]
            raise MetaError(f'{self.platform} API 오류({r.status_code}): {msg}')
        return body

    def me(self):
        raise NotImplementedError

    def refresh(self):
        """장기 토큰(60일)을 새로 60일짜리로 바꾼다. 발급 후 하루가 지나야 된다."""
        if self.dry or not self.tok:
            return False
        body = self._call('GET', self.refresh_url, grant_type=self.refresh_grant)
        with edit('state') as st:
            st.setdefault('tokens', {})[self.platform] = {
                'token': body['access_token'], 'refreshed_at': iso(now()),
                'expires_in': body.get('expires_in'), 'from_env': env(TOKEN_ENV[self.platform])[-12:],
            }
        self.tok = body['access_token']
        return True

    def _fake(self, what, **kw):
        fid = 'dry-' + new_id()
        log('dry_run', platform=self.platform, what=what, id=fid, **kw)
        return fid


class Instagram(Client):
    platform = 'instagram'
    refresh_url = 'https://graph.instagram.com/refresh_access_token'
    refresh_grant = 'ig_refresh_token'

    def me(self):
        if self.dry and not self.tok:
            return {'id': 'dry', 'username': '(모의 실행)'}
        b = self._call('GET', 'me', fields='user_id,username')
        return {'id': b.get('user_id') or b['id'], 'username': b.get('username', '')}

    def _wait(self, container):
        for _ in range(30):
            st = self._call('GET', container, fields='status_code').get('status_code')
            if st == 'FINISHED':
                return
            if st in ('ERROR', 'EXPIRED'):
                raise MetaError(f'인스타그램이 이미지를 처리하지 못했어요({st}). 사진 형식·주소를 확인해 주세요.')
            time.sleep(3)
        raise MetaError('인스타그램 이미지 처리가 너무 오래 걸려요.')

    def publish(self, text, image_urls):
        if not image_urls:
            raise MetaError('인스타그램은 사진이 꼭 있어야 해요.')
        if self.dry:
            return {'id': self._fake('publish', text=text[:80], images=image_urls), 'permalink': ''}
        uid = self.me()['id']
        if len(image_urls) == 1:
            cid = self._call('POST', f'{uid}/media', image_url=image_urls[0], caption=text)['id']
        else:
            kids = []
            for u in image_urls[:10]:
                k = self._call('POST', f'{uid}/media', image_url=u, is_carousel_item='true')['id']
                self._wait(k)
                kids.append(k)
            cid = self._call('POST', f'{uid}/media', media_type='CAROUSEL',
                             children=','.join(kids), caption=text)['id']
        self._wait(cid)
        mid = self._call('POST', f'{uid}/media_publish', creation_id=cid)['id']
        link = self._call('GET', mid, fields='permalink').get('permalink', '')
        return {'id': mid, 'permalink': link}

    def recent_posts(self, limit):
        if self.dry:
            return []
        b = self._call('GET', 'me/media', fields='id,caption,timestamp,permalink', limit=limit)
        return [{'id': m['id'], 'text': m.get('caption', ''), 'permalink': m.get('permalink', '')}
                for m in b.get('data', [])]

    def comments(self, media_id, my_name):
        """내가 아직 답하지 않은 다른 사람의 댓글."""
        b = self._call('GET', f'{media_id}/comments',
                       fields='id,text,username,timestamp,replies{id,username}', limit=50)
        out = []
        for c in b.get('data', []):
            if c.get('username') == my_name:
                continue
            replied = any(r.get('username') == my_name for r in c.get('replies', {}).get('data', []))
            if not replied:
                out.append({'id': c['id'], 'text': c.get('text', ''), 'username': c.get('username', ''),
                            'timestamp': c.get('timestamp', '')})
        return out

    def reply(self, comment_id, text):
        if self.dry:
            return self._fake('reply', comment=comment_id, text=text)
        return self._call('POST', f'{comment_id}/replies', message=text)['id']


class Threads(Client):
    platform = 'threads'
    refresh_url = 'https://graph.threads.net/refresh_access_token'
    refresh_grant = 'th_refresh_token'

    def me(self):
        if self.dry and not self.tok:
            return {'id': 'dry', 'username': '(모의 실행)'}
        b = self._call('GET', 'me', fields='id,username')
        return {'id': b['id'], 'username': b.get('username', '')}

    def _wait(self, container):
        for _ in range(30):
            b = self._call('GET', container, fields='status,error_message')
            if b.get('status') == 'FINISHED':
                return
            if b.get('status') in ('ERROR', 'EXPIRED'):
                raise MetaError(f"스레드가 게시물을 처리하지 못했어요: {b.get('error_message', b.get('status'))}")
            time.sleep(3)
        raise MetaError('스레드 처리가 너무 오래 걸려요.')

    def _post(self, **params):
        cid = self._call('POST', 'me/threads', **params)['id']
        self._wait(cid)
        return self._call('POST', 'me/threads_publish', creation_id=cid)['id']

    def publish(self, text, image_urls):
        if self.dry:
            return {'id': self._fake('publish', text=text[:80], images=image_urls), 'permalink': ''}
        if not image_urls:
            mid = self._post(media_type='TEXT', text=text)
        elif len(image_urls) == 1:
            mid = self._post(media_type='IMAGE', image_url=image_urls[0], text=text)
        else:
            kids = []
            for u in image_urls[:20]:
                k = self._call('POST', 'me/threads', media_type='IMAGE', image_url=u, is_carousel_item='true')['id']
                self._wait(k)
                kids.append(k)
            mid = self._post(media_type='CAROUSEL', children=','.join(kids), text=text)
        link = self._call('GET', mid, fields='permalink').get('permalink', '')
        return {'id': mid, 'permalink': link}

    def recent_posts(self, limit):
        if self.dry:
            return []
        b = self._call('GET', 'me/threads', fields='id,text,timestamp,permalink', limit=limit)
        return [{'id': m['id'], 'text': m.get('text', ''), 'permalink': m.get('permalink', '')}
                for m in b.get('data', [])]

    def comments(self, media_id, my_name):
        b = self._call('GET', f'{media_id}/replies', fields='id,text,username,timestamp,has_replies', limit=50)
        out = []
        for c in b.get('data', []):
            if c.get('username') == my_name:
                continue
            if c.get('has_replies'):
                sub = self._call('GET', f"{c['id']}/replies", fields='id,username', limit=50)
                if any(r.get('username') == my_name for r in sub.get('data', [])):
                    continue
            out.append({'id': c['id'], 'text': c.get('text', ''), 'username': c.get('username', ''),
                        'timestamp': c.get('timestamp', '')})
        return out

    def reply(self, comment_id, text):
        if self.dry:
            return self._fake('reply', comment=comment_id, text=text)
        return self._post(media_type='TEXT', text=text, reply_to_id=comment_id)


def client(platform):
    return {'instagram': Instagram, 'threads': Threads}[platform]()


def comment_time(ts):
    """Meta 시간 표기(2026-10-27T03:12:00+0000)를 datetime 으로."""
    if not ts:
        return None
    if len(ts) > 5 and ts[-5] in '+-' and ts[-3] != ':':
        ts = ts[:-2] + ':' + ts[-2:]
    try:
        return parse_iso(ts)
    except ValueError:
        return None
