"""이미지: 받은 사진을 인스타 규격 JPEG 로 맞추고, 공개 주소 폴더에 올리고, AI 이미지를 만든다."""
import subprocess, sys
from pathlib import Path

from PIL import Image, ImageOps

from .common import UPLOADS, config, new_id, resolve

# 인스타그램 피드 사진은 세로 4:5 ~ 가로 1.91:1 사이여야 한다. 벗어나면 흰 여백을 붙여 맞춘다.
MIN_RATIO, MAX_RATIO = 0.8, 1.91
MAX_SIDE = 1440


def to_jpeg(src, dst):
    im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
    w, h = im.size
    r = w / h
    if r < MIN_RATIO:
        canvas = Image.new('RGB', (round(h * MIN_RATIO), h), 'white')
        canvas.paste(im, ((canvas.width - w) // 2, 0))
        im = canvas
    elif r > MAX_RATIO:
        canvas = Image.new('RGB', (w, round(w / MAX_RATIO)), 'white')
        canvas.paste(im, (0, (canvas.height - h) // 2))
        im = canvas
    im.thumbnail((MAX_SIDE, MAX_SIDE))
    im.save(dst, 'JPEG', quality=90)


def save_upload(fileobj, filename):
    """확인 화면에서 올린 사진을 data/uploads 에 저장하고 상대 경로를 돌려준다."""
    UPLOADS.mkdir(parents=True, exist_ok=True)
    ext = Path(filename).suffix.lower() or '.jpg'
    dst = UPLOADS / f'{new_id()}{ext}'
    fileobj.save(dst)
    return str(dst.relative_to(UPLOADS.parent.parent)).replace('\\', '/')


def publish_urls(post):
    """게시글 사진을 mom.zumma.kr 그림 폴더로 복사하고 인터넷 주소 목록을 돌려준다."""
    cfg = config()
    out_dir = resolve(cfg['public_image_dir'])
    out_dir.mkdir(parents=True, exist_ok=True)
    urls = []
    for i, rel in enumerate(post.get('images', [])):
        # 서버가 영문·숫자 파일 이름만 내보내므로 이 형식을 지킨다
        name = f"sns-{post['id']}-{i + 1}.jpg"
        to_jpeg(resolve(rel), out_dir / name)
        urls.append(cfg['public_image_base_url'] + name)
    return urls


def ai_image(prompt):
    """Codex(ChatGPT 구독)로 카드 이미지를 만든다. 몇 분 걸린다. 상대 경로를 돌려준다."""
    cfg = config()
    script = resolve(cfg['codex_image_script'])
    if not script.exists():
        raise RuntimeError(f'AI 이미지 도구를 찾지 못했어요: {script}')
    UPLOADS.mkdir(parents=True, exist_ok=True)
    out = UPLOADS / f'ai-{new_id()}.png'
    full = ('인스타그램 게시물용 정사각형(1:1) 카드 이미지. 한글 글자는 크고 또렷하게, 맞춤법 정확하게. '
            + prompt)
    r = subprocess.run([sys.executable, str(script), '--out', str(out), '--prompt', full],
                       capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=1000)
    if r.returncode != 0 or not out.exists():
        raise RuntimeError('AI 이미지를 만들지 못했어요: ' + (r.stderr or r.stdout)[-300:])
    return str(out.relative_to(UPLOADS.parent.parent)).replace('\\', '/')
