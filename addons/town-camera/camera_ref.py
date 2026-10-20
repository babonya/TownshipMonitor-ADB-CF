# [사용자 변경 2026-10-17] 마을 카메라 기준 후보 여러 장.
# 원작자 지시로 창고·시장·헬기장·비행장 네 건물의 배치가 고정이다(창고 위, 시장 왼쪽, 헬기장 오른쪽, 비행장 그 아래).
# 그래서 후보마다 '기준 카메라에서의 중심'을 따로 갖고, 하나라도 기준 배율·위치에 맞으면 카메라 정상으로 본다.
# 느낌표·말풍선·타이머처럼 바뀌는 부분은 후보 json의 ignore(이미지 안 비율 사각형)로 비교에서 뺀다.
# 후보 위치: 자기 마을 등록(setup-local/town-camera, register_town.py가 만듦)이 있으면 그것만, 없으면 개발용 refs/.
import json, time
from pathlib import Path
import cv2, numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
USER_DIR = ROOT / 'setup-local/town-camera'
LOW_DIR = ROOT / 'setup-local/camera-low'
MIN_SCORE = 0.8            # 일치 점수 하한
LOW_SCORE = 0.85           # 이보다 낮으면 화면을 저장해 후보 등록 자료로 쓴다
SCALE_TOLERANCE = 0.03     # 배율 허용 오차
POSITION_TOLERANCE = 0.01  # 위치 허용 오차(화면 폭 비율)

def ref_dirs():
    return [USER_DIR, HERE / 'refs']

def load_refs(W, H, dirs=None):
    for d in dirs or ref_dirs():
        refs = []
        for f in sorted(d.glob('*.json')) if d.is_dir() else []:
            meta = json.loads(f.read_text(encoding='utf-8'))
            if 'referenceCenter' not in meta or (meta['dimensions']['width'], meta['dimensions']['height']) != (W, H): continue
            tpl = cv2.imread(str(f.with_suffix('.png')))
            if tpl is None: continue
            th, tw = tpl.shape[:2]; mask = None
            if meta.get('ignore'):
                mask = np.full((th, tw), 255, np.uint8)
                for r in meta['ignore']:
                    mask[round(r['y'] * th):round((r['y'] + r['height']) * th), round(r['x'] * tw):round((r['x'] + r['width']) * tw)] = 0
            refs.append(dict(name=f.stem, tpl=tpl, mask=mask, meta=meta,
                             center=(meta['referenceCenter']['x'] * W, meta['referenceCenter']['y'] * H)))
        # 큰 건물(창고)부터 본다: check()는 충분히 맞는 첫 후보에서 멈추고 그 건물로 탭 위치를 보정한다.
        order = ['barn', 'market', 'helipad', 'airport']
        refs.sort(key=lambda r: order.index(r['meta'].get('productId')) if r['meta'].get('productId') in order else len(order))
        if refs: return refs
    return []

def _scaled(ref, s):
    t = cv2.resize(ref['tpl'], None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    m = None if ref['mask'] is None else cv2.resize(ref['mask'], (t.shape[1], t.shape[0]), interpolation=cv2.INTER_NEAREST)
    return t, m

def _best(img, t, m):
    if t.shape[0] > img.shape[0] or t.shape[1] > img.shape[1]: return None
    r = cv2.matchTemplate(img, t, cv2.TM_CCOEFF_NORMED, mask=m)
    r = np.nan_to_num(r, nan=-1, posinf=-1, neginf=-1)  # 마스크 비교는 평평한 곳에서 inf가 나올 수 있다
    _, v, _, l = cv2.minMaxLoc(r)
    return v, l

def match_one(im, ref, scales, area=None):
    # area=(x0,y0,x1,y1) 안에서만 찾는다. 돌려주는 중심은 전체 화면 좌표.
    x0, y0 = (area[0], area[1]) if area else (0, 0)
    img = im[area[1]:area[3], area[0]:area[2]] if area else im
    best = None
    for s in scales:
        t, m = _scaled(ref, s); r = _best(img, t, m)
        if r and (not best or r[0] > best[0]): best = (r[0], s, x0 + r[1][0] + t.shape[1] / 2, y0 + r[1][1] + t.shape[0] / 2)
    return best

def measure(im, refs):
    # 화면 전체에서 후보마다 배율·위치를 찾는다(절반 해상도로 대략 → 원본 해상도로 다듬기).
    # 돌려줌: (점수, 배율, cx, cy, 기준x, 기준y, 후보이름).
    H, W = im.shape[:2]; half = cv2.resize(im, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA); found = []
    for ref in refs:
        # [2026-10-20 속도] 대략 찾기 배율 간격 0.04→0.08(다듬기가 ±0.04를 다시 보므로 결과 같음). 한 번 7.6초 → 아래 조기 종료와 함께 단축.
        coarse = match_one(half, ref, [s * 0.5 for s in np.arange(0.5, 1.61, 0.08)])
        if not coarse: continue
        s0 = coarse[1] * 2; cx, cy = coarse[2] * 2, coarse[3] * 2
        th, tw = ref['tpl'].shape[:2]; pw, ph = tw * (s0 + 0.06) / 2 + 12, th * (s0 + 0.06) / 2 + 12
        area = (max(0, int(cx - pw)), max(0, int(cy - ph)), min(W, int(cx + pw)), min(H, int(cy + ph)))
        fine = match_one(im, ref, [s for s in np.arange(s0 - 0.04, s0 + 0.041, 0.02) if 0.45 <= s <= 1.65], area) or (coarse[0], s0, cx, cy)
        found.append((*fine, *ref['center'], ref['name']))
        if fine[0] >= LOW_SCORE: return found[-1]   # [2026-10-20] 우선순위(창고→시장→헬기장→비행장)대로 충분히 맞으면 나머지 후보는 안 본다
    # [2026-10-17] 작은 후보(비행장 날개)는 화면 전체에서 엉뚱한 곳에 높게 잡힐 수 있다(실측 23:57 (1362,291)).
    # check()와 같이 우선순위(창고→시장→헬기장→비행장)대로 충분히 맞는(0.85 이상) 첫 후보를 쓰고, 없으면 최고 점수.
    for r in found:
        if r[0] >= LOW_SCORE: return r
    return max(found, key=lambda r: r[0]) if found else None

def check(im, refs):
    # 봇이 마을 화면마다 부르는 빠른 확인: 후보마다 기준 중심 근처·배율 1±0.02만 본다.
    # 돌려줌: (맞은 결과 또는 None, 본 후보 중 최고 점수). 결과 = (배율, cx, cy, 기준x, 기준y, 후보이름, 점수).
    H, W = im.shape[:2]; ok = None; top = -1
    for ref in refs:
        rx, ry = ref['center']; th, tw = ref['tpl'].shape[:2]; pad = 60
        area = (max(0, int(rx - tw * .52 - pad)), max(0, int(ry - th * .52 - pad)), min(W, int(rx + tw * .52 + pad)), min(H, int(ry + th * .52 + pad)))
        r = match_one(im, ref, (0.98, 1.0, 1.02), area)
        if not r: continue
        v, s, cx, cy = r; top = max(top, v)
        if v >= MIN_SCORE and np.hypot(cx - rx, cy - ry) <= POSITION_TOLERANCE * W and (not ok or v > ok[6]):
            ok = (s, cx, cy, rx, ry, ref['name'], v)
            if v >= LOW_SCORE: break  # 충분히 맞으면 나머지 후보는 안 본다(마을 화면마다 불리므로 속도)
    return ok, top

_last_low = 0.0
def save_low(im, score, tag='check', every=600, keep=40):
    # 점수가 낮은 마을 화면을 저장한다(새 후보 등록용). 10분에 한 장, 최대 40장.
    global _last_low
    if time.time() - _last_low < every: return None
    _last_low = time.time()
    try:
        LOW_DIR.mkdir(parents=True, exist_ok=True)
        old = sorted(LOW_DIR.glob('*.png'))
        for f in old[:max(0, len(old) - keep + 1)]: f.unlink()
        out = LOW_DIR / f"{time.strftime('%Y%m%d-%H%M%S')}-{tag}-{score:.3f}.png"
        cv2.imwrite(str(out), im); return out
    except OSError: return None
