"""Claude 로 채널별 게시글과 답댓글 초안을 쓴다. 말투는 brand.md 를 따른다.

config.json 의 claude_backend:
  "subscription" — Claude 월구독(Pro·Max)으로 로그인한 Claude Code 를 불러 쓴다(API 요금 없음).
  "api"          — Claude API 키(.env 의 ANTHROPIC_API_KEY)로 부른다(사용량만큼 과금).
"""
import base64, io, json, os, shutil, subprocess
from pathlib import Path

import anthropic
from PIL import Image

from .common import ROOT, PLATFORM_KO, config, env, fix_names, now, resolve

POST_SCHEMA = {
    'type': 'object',
    'properties': {
        'instagram': {
            'type': 'object',
            'properties': {'text': {'type': 'string'}, 'notes': {'type': 'string'}},
            'required': ['text', 'notes'], 'additionalProperties': False,
        },
        'threads': {
            'type': 'object',
            'properties': {'text': {'type': 'string'}, 'notes': {'type': 'string'}},
            'required': ['text', 'notes'], 'additionalProperties': False,
        },
        'image_prompt': {'type': 'string'},
    },
    'required': ['instagram', 'threads', 'image_prompt'], 'additionalProperties': False,
}

REPLY_SCHEMA = {
    'type': 'object',
    'properties': {
        'kind': {'type': 'string', 'enum': ['simple', 'inquiry', 'complaint', 'sensitive', 'spam']},
        'needs_human': {'type': 'boolean'},
        'reply': {'type': 'string'},
        'reason': {'type': 'string'},
    },
    'required': ['kind', 'needs_human', 'reply', 'reason'], 'additionalProperties': False,
}


class WriterError(Exception):
    pass


def _client():
    key = env('ANTHROPIC_API_KEY')
    try:
        return anthropic.Anthropic(api_key=key) if key else anthropic.Anthropic()
    except anthropic.AnthropicError:
        raise WriterError('Claude API 키가 없어요. .env 의 ANTHROPIC_API_KEY 에 넣어 주세요.')


def _system():
    brand = (ROOT / 'brand.md').read_text(encoding='utf-8')
    return ('당신은 주식회사 더줌의 SNS 담당자입니다. 아래 말투 가이드를 그대로 따라 글을 씁니다.\n'
            '출력은 지정된 JSON 형식으로만 합니다.\n\n' + brand)


def _claude_exe():
    # claude.cmd 를 거치면 한글·따옴표가 든 인자가 깨지므로 실제 실행 파일을 바로 부른다
    exe = Path(os.environ.get('APPDATA', '')) / 'npm' / 'node_modules' / '@anthropic-ai' / 'claude-code' / 'bin' / 'claude.exe'
    if exe.exists():
        return str(exe)
    found = shutil.which('claude')
    if not found:
        raise WriterError('Claude Code 를 찾지 못했어요. 설치돼 있는지 확인해 주세요.')
    return found


def _ask_subscription(content, schema, effort):
    """Claude Code 를 비대화형(-p)으로 한 번 불러 JSON 결과를 받는다. 도구는 모두 끈다."""
    cfg = config()
    cmd = [_claude_exe(), '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
           '--json-schema', json.dumps(schema), '--tools', '', '--no-session-persistence',
           '--strict-mcp-config', '--model', cfg['claude_model'], '--effort', effort,
           '--system-prompt', _system()]
    if isinstance(content, str):
        content = [{'type': 'text', 'text': content}]
    msg = json.dumps({'type': 'user', 'message': {'role': 'user', 'content': content}}, ensure_ascii=False)
    run_env = dict(os.environ)
    tok = env('CLAUDE_CODE_OAUTH_TOKEN')  # `claude setup-token` 으로 받은 1년짜리 구독 토큰
    if tok:
        run_env['CLAUDE_CODE_OAUTH_TOKEN'] = tok
    try:
        r = subprocess.run(cmd, input=msg + '\n', capture_output=True, text=True, encoding='utf-8',
                           errors='replace', timeout=600, env=run_env, cwd=str(ROOT),
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except subprocess.TimeoutExpired:
        raise WriterError('Claude 응답이 10분 넘게 오지 않았어요. 다시 시도해 주세요.')
    result = None
    for line in r.stdout.splitlines():
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if ev.get('type') == 'result':
            result = ev
    if not result:
        raise WriterError('Claude Code 가 응답하지 않았어요: ' + (r.stderr or r.stdout)[-300:])
    if result.get('is_error'):
        text = str(result.get('result', ''))
        if 'login' in text.lower() or 'authenticat' in text.lower():
            raise WriterError('Claude 로그인이 필요해요. 터미널에서 `claude setup-token` 으로 받은 토큰을 '
                              '.env 의 CLAUDE_CODE_OAUTH_TOKEN 에 넣어 주세요.')
        if 'limit' in text.lower():
            raise WriterError('Claude 구독 사용 한도에 걸렸어요. 한도가 풀리면 다음 차례에 다시 시도합니다.')
        raise WriterError('Claude 오류: ' + text[:300])
    if isinstance(result.get('structured_output'), dict):
        return result['structured_output']
    try:
        return json.loads(result.get('result', ''))
    except json.JSONDecodeError:
        raise WriterError('Claude 응답을 읽지 못했어요. 다시 시도해 주세요.')


def _ask(content, schema, effort, max_tokens=16000):
    cfg = config()
    if cfg.get('claude_backend', 'subscription') != 'api':
        return _ask_subscription(content, schema, effort)
    try:
        r = _client().beta.messages.create(
            model=cfg['claude_model'],
            max_tokens=max_tokens,
            system=_system(),
            messages=[{'role': 'user', 'content': content}],
            output_config={'effort': effort, 'format': {'type': 'json_schema', 'schema': schema}},
            # 안전 분류기가 드물게 거절하면 서버가 다른 모델로 다시 써 준다
            betas=['server-side-fallback-2026-07-01'],
            fallbacks='default',
        )
    except anthropic.AuthenticationError:
        raise WriterError('Claude API 키가 맞지 않아요. .env 의 ANTHROPIC_API_KEY 를 확인해 주세요.')
    except anthropic.RateLimitError:
        raise WriterError('Claude API 요청이 잠시 많아요. 몇 분 뒤 다시 시도합니다.')
    except anthropic.APIStatusError as e:
        raise WriterError(f'Claude API 오류({e.status_code}): {e.message}')
    except anthropic.APIConnectionError:
        raise WriterError('Claude API 에 연결하지 못했어요(인터넷 연결 확인).')
    if r.stop_reason == 'refusal':
        raise WriterError('Claude가 이 내용으로는 글을 쓰지 않았어요. 소재 내용을 확인해 주세요.')
    if r.stop_reason == 'max_tokens':
        raise WriterError('글이 너무 길어져 중간에 끊겼어요. 다시 시도해 주세요.')
    text = ''.join(b.text for b in r.content if b.type == 'text')
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise WriterError('Claude 응답을 읽지 못했어요. 다시 시도해 주세요.')


def _image_block(path):
    im = Image.open(path)
    im = im.convert('RGB')
    im.thumbnail((1024, 1024))
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=85)
    return {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/jpeg',
                                        'data': base64.b64encode(buf.getvalue()).decode()}}


def write_posts(material, extra=''):
    """소재 하나로 인스타·스레드 글과 AI 이미지 설명을 만든다."""
    cfg = config()
    lines = [
        f"오늘은 {now():%Y년 %m월 %d일} ({'월화수목금토일'[now().weekday()]})입니다.",
        '아래 소재로 인스타그램 글과 스레드 글을 각각 써 주세요. 같은 내용이라도 채널 말투에 맞게 따로 씁니다.',
        f"- 인스타그램: 해시태그 {cfg['instagram_max_hashtags']}개 이하, {cfg['instagram_max_chars']}자 이하",
        f"- 스레드: {cfg['threads_max_chars']}자 이하",
        '- notes: 확인이 필요한 점(소재에 없는 정보, 애매한 날짜 등)을 짧게. 없으면 빈 문자열.',
        '- image_prompt: 인스타그램용 정사각형 카드 이미지를 AI로 만들 때 쓸 설명(한국어). '
        '이미지 안에 넣을 큰 제목 한 줄과 분위기·색감을 적습니다. 실제 사람 얼굴이나 상표는 넣지 않습니다.',
        '',
        f"[소재 제목] {material.get('title', '')}",
        f"[소재 내용]\n{material.get('body', '')}",
    ]
    if material.get('link'):
        lines.append(f"[카페 글 주소] {material['link']}")
    if material.get('deadline'):
        lines.append(f"[신청 마감] {material['deadline']}")
    if material.get('image_hint'):
        lines.append(f"[이미지 요청] {material['image_hint']}")
    if material.get('images'):
        lines.append('[첨부 사진] 아래 사진을 게시물에 함께 올립니다. 사진 내용과 어긋나지 않게 써 주세요.')
    if extra:
        lines.append(f"\n[다시 쓰기 요청] {extra}")
    content = [_image_block(resolve(p)) for p in material.get('images', [])[:3]]
    content.append({'type': 'text', 'text': '\n'.join(lines)})
    out = _ask(content, POST_SCHEMA, effort='medium')
    for p in ('instagram', 'threads'):
        out[p]['text'] = fix_names(out[p]['text'].strip())
    return out


def write_reply(platform, post_text, comment_text, username, extra=''):
    lines = [
        f"{PLATFORM_KO[platform]} 게시글에 달린 댓글에 답글 초안을 써 주세요.",
        '- kind: simple(칭찬·감사·태그 등 단순), inquiry(문의), complaint(불만), sensitive(환불·개인정보·당첨 확인 등), spam(광고·무의미)',
        '- needs_human: 사람이 직접 확인해야 하면 true(불만·민감·게시글에 답이 없는 문의)',
        '- reply: 답글 문장. spam 이면 빈 문자열.',
        '- reason: 그렇게 판단한 이유 한 줄.',
        '',
        f"[게시글]\n{post_text or '(내용 없음)'}",
        f"[댓글] @{username}: {comment_text}",
    ]
    if extra:
        lines.append(f"\n[다시 쓰기 요청] {extra}")
    out = _ask('\n'.join(lines), REPLY_SCHEMA, effort='low', max_tokens=4000)
    out['reply'] = fix_names(out['reply'].strip())
    return out
