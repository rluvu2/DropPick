# Gemini로 만든 원본 이미지 → 게임용 에셋
#   python test/build-assets.py
# 입력: assets/originals/{side,stage1..stage6,icon}.png  (있는 것만 처리)
# 출력: assets/side.webp, assets/stage1~6.webp, assets/icon-32/64/192.png(투명 모서리), assets/icon-180.png(홈 화면용)
#
# 1. 워터마크: Gemini는 오른쪽 아래(중심이 가장자리에서 112.5px)에 흰 별을 최대 50% 불투명도로 섞는다.
#    별의 알파 지도(test/fixtures/gemini-watermark.png, 값×2)를 알고 있으니 섞기를 거꾸로 풀어 원래 색을 되살린다:
#    원래 = (보이는 색 - a×255) / (1 - a). 경계 1~2px만 살짝 메운다.
# 2. 1구간 바닥(stage1)은 구간이 그림보다 길어서 세로로 반복된다 → 위아래가 이어지게, 겹치는 띠를
#    '두 그림이 가장 비슷한 경로'로 잘라 붙인다(흐리게 섞지 않아서 무늬가 겹쳐 보이지 않음).
#    2~6구간은 구간 하나에 그림 한 장이 들어가서(렌더러가 폭에 맞춰 늘림) 손대지 않는다.
# 3. 아이콘: 바깥 흰 모서리를 투명하게. 홈 화면용은 안쪽 어두운 판만 꽉 차게(iOS가 모서리를 알아서 깎음).
import os
import sys
import numpy as np
import cv2
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'assets', 'originals')
OUT = os.path.join(ROOT, 'assets')
ALPHA = np.asarray(Image.open(os.path.join(ROOT, 'test', 'fixtures', 'gemini-watermark.png'))).astype(np.float32) / 510


def unwatermark(im):
    H, W = im.shape[:2]
    N = ALPHA.shape[0]
    x0, y0 = W - 168, H - 168            # 별 중심 (W-112.5, H-112.5), 알파 지도 중심 55.5
    a = ALPHA[..., None]
    out = im.copy()
    out[y0:y0 + N, x0:x0 + N] = np.clip((im[y0:y0 + N, x0:x0 + N] - a * 255) / (1 - a), 0, 255)
    band = ((ALPHA > 0.02) & (ALPHA < 0.47)).astype(np.uint8)
    band = cv2.dilate(band, np.ones((2, 2), np.uint8))
    m = np.zeros((H, W), np.uint8)
    m[y0:y0 + N, x0:x0 + N] = band * 255
    o8 = out.round().astype(np.uint8)
    sub = cv2.inpaint(np.ascontiguousarray(o8[H - 200:, W - 200:]), np.ascontiguousarray(m[H - 200:, W - 200:]), 3, cv2.INPAINT_TELEA)
    o8[H - 200:, W - 200:] = sub
    return o8.astype(np.float32)


def seam_rows(img, b=192, fe=8):
    # 맨 위 b줄을 '아래쪽 연장'과 오차가 가장 작은 경로로 잘라 붙여서 위아래가 이어지게 한다 (세로 크기 H-b)
    t = img.transpose(1, 0, 2)
    H, W, _ = t.shape
    Wp = W - b
    R, L = t[:, Wp:], t[:, :b]
    err = ((R - L) ** 2).sum(axis=2)
    lo, hi = fe + 1, b - fe - 1
    E = np.full_like(err, np.inf)
    E[0, lo:hi] = err[0, lo:hi]
    back = np.zeros(err.shape, np.int32)
    idx = np.arange(b)
    for y in range(1, H):
        prev = E[y - 1]
        cand = np.stack([np.roll(prev, 1), prev, np.roll(prev, -1)])
        cand[0, 0] = np.inf
        cand[2, -1] = np.inf
        k = cand.argmin(axis=0)
        E[y] = cand[k, idx] + err[y]
        E[y, :lo] = np.inf
        E[y, hi:] = np.inf
        back[y] = idx + (k - 1)
    c = np.zeros(H, np.int32)
    c[-1] = int(E[-1].argmin())
    for y in range(H - 1, 0, -1):
        c[y - 1] = back[y, c[y]]
    M = np.clip((c[:, None] - np.arange(b)[None, :]) / fe + 0.5, 0, 1)[..., None]
    out = np.concatenate([M * R + (1 - M) * L, t[:, b:Wp]], axis=1)
    return out.transpose(1, 0, 2)


def save_webp(arr, path, width):
    im = Image.fromarray(np.clip(arr, 0, 255).round().astype(np.uint8))
    im = im.resize((width, round(width * im.size[1] / im.size[0])), Image.LANCZOS)
    im.save(path, 'WEBP', quality=84, method=6)
    print(os.path.relpath(path, ROOT), im.size, os.path.getsize(path) // 1024, 'KB')


def icons(arr):
    H, W = arr.shape[:2]
    bg = arr[:8, :8].reshape(-1, 3).mean(axis=0)
    cand = (np.sqrt(((arr - bg) ** 2).sum(axis=2)) < 14).astype(np.uint8)
    fill = cand.copy()
    ff = np.zeros((H + 2, W + 2), np.uint8)
    for (x, y) in ((0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)):
        if cand[y, x]:
            cv2.floodFill(fill, ff, (x, y), 2)
    bgmask = fill == 2
    diag = []
    for (sx, sy, dx, dy) in ((0, 0, 1, 1), (W - 1, 0, -1, 1), (0, H - 1, 1, -1), (W - 1, H - 1, -1, -1)):
        d = 0
        while d < min(W, H) // 2 and bgmask[sy + dy * d, sx + dx * d]:
            d += 1
        diag.append(d)
    r = max(1.0, float(np.mean(diag)) / (1 - 1 / np.sqrt(2)))
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    qx = np.maximum(np.maximum(r - xx, xx - (W - 1 - r)), 0)
    qy = np.maximum(np.maximum(r - yy, yy - (H - 1 - r)), 0)
    corner = (qx > 0) & (qy > 0)
    dd = np.where(corner, r - np.sqrt(qx ** 2 + qy ** 2), 1e9)
    alpha = np.minimum(np.clip((dd - 3.0) / 2.5, 0, 1), (~bgmask).astype(np.float32))
    sq = Image.fromarray(np.dstack([arr, alpha * 255]).round().astype(np.uint8), 'RGBA')
    for n in (32, 64, 192):
        p = os.path.join(OUT, 'icon-%d.png' % n)
        sq.resize((n, n), Image.LANCZOS).save(p, optimize=True)
        print(os.path.relpath(p, ROOT), n)
    lum = arr.mean(axis=2)
    dark = np.where(lum[H // 2] < 60)[0]
    a, b = int(dark.min()) + 110, int(dark.max()) - 110
    p = os.path.join(OUT, 'icon-180.png')
    Image.fromarray(arr.round().astype(np.uint8)).crop((a, a, b, b)).resize((180, 180), Image.LANCZOS).save(p, optimize=True)
    print(os.path.relpath(p, ROOT), 180, '(홈 화면용, 꽉 찬 사각형)')


def main():
    if not os.path.isdir(SRC):
        sys.exit('assets/originals/ 폴더가 없어요')
    for key in ['side', 'stage1', 'stage2', 'stage3', 'stage4', 'stage5', 'stage6', 'icon']:
        f = os.path.join(SRC, key + '.png')
        if not os.path.exists(f):
            continue
        arr = unwatermark(np.asarray(Image.open(f).convert('RGB')).astype(np.float32))
        if key == 'icon':
            icons(arr)
        elif key == 'side':
            save_webp(arr, os.path.join(OUT, 'side.webp'), 512)
        else:
            if key == 'stage1':
                arr = seam_rows(arr)
            save_webp(arr, os.path.join(OUT, key + '.webp'), 1536)


if __name__ == '__main__':
    main()
