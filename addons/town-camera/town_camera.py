# [사용자 변경 2026-10-15] 마을 카메라 복원 도구.
# 봇은 마을에서 시장·창고를 고정 비율 좌표로 누른다(profile town.marketTap/barnTap). 사람이 줌·이동을 하면 그 좌표가
# 엉뚱한 건물을 가리키므로, 실제 캡처에서 등록한 건물 이미지(camera_ref.py: 창고·시장·헬기장·비행장 후보)로 현재 배율·위치를 재고
# 핀치(addons/pinch, app_process)와 느린 드래그로 기준 카메라에 맞춘다. 매 단계 새 캡처로 다시 확인한다.
# 사용: .venv-perception/Scripts/python.exe -I addons/town-camera/town_camera.py [--serial <시리얼>] [--check]
# 종료 코드: 0 = 기준 카메라 확인, 1 = 복원 실패(입력 중단), 2 = Township이 전면이 아님.
import argparse, json, os, subprocess, sys, time
from pathlib import Path
import cv2, numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
import camera_ref
from camera_ref import SCALE_TOLERANCE, POSITION_TOLERANCE, MIN_SCORE

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
ADB = Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk/platform-tools/adb.exe'
DEX_LOCAL = ROOT / 'addons/pinch/build/classes.dex'
DEX_REMOTE = '/data/local/tmp/pinch.dex'
PACKAGE = 'com.playrix.township'
PINCH_EXPONENT = 0.45       # 실측: 손가락 간격 비율 r → 줌 비율 r^0.45 (2026-10-15)

sys.stderr.reconfigure(encoding='utf-8')
LOG_FILE = ROOT / 'runtime/town-camera.log'
def log(*a):
    line = ' '.join(str(x) for x in a); print('[town-camera]', line, file=sys.stderr, flush=True)
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f: f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + line + '\n')
    except OSError: pass

class Phone:
    def __init__(self, serial):
        self.serial = serial
        self.env = {**os.environ, 'ANDROID_ADB_SERVER_PORT': '15037', 'MSYS_NO_PATHCONV': '1'}
    def adb(self, *args, timeout=30, binary=False):
        r = subprocess.run([str(ADB), '-s', self.serial, *args], capture_output=True, timeout=timeout, env=self.env)
        if r.returncode: raise RuntimeError(f'ADB_FAILED {args[0]}: {r.stderr.decode(errors="ignore")[:200]}')
        return r.stdout if binary else r.stdout.decode(errors='ignore')
    def foreground(self):
        return PACKAGE in self.adb('shell', 'dumpsys window | grep -m1 mCurrentFocus')
    def capture(self):
        # [2026-10-20] PNG(-p)는 폰에서 압축하느라 느리다 → raw(RGBA, 헤더 12~16바이트)로 받아 BGR로 바꾼다.
        data = self.adb('exec-out', 'screencap', binary=True)
        w, h = int.from_bytes(data[0:4], 'little'), int.from_bytes(data[4:8], 'little')
        off = len(data) - w * h * 4
        if w <= 0 or h <= 0 or off not in (12, 16): raise RuntimeError('CAPTURE_DECODE_FAILED')
        return np.ascontiguousarray(np.frombuffer(data, np.uint8, offset=off).reshape(h, w, 4)[:, :, 2::-1])
    def ensure_pinch(self):
        if DEX_REMOTE not in self.adb('shell', f'ls {DEX_REMOTE} 2>/dev/null'):
            self.adb('push', str(DEX_LOCAL), DEX_REMOTE)
    def pinch(self, cx, cy, g0, g1):
        self.adb('shell', f'CLASSPATH={DEX_REMOTE} app_process / Pinch {cx:.0f} {cy:.0f} {g0:.0f} {g1:.0f} 10 16')
    def swipe(self, x0, y0, x1, y1, ms=1000):
        # 느린 드래그(1000ms)는 관성이 없어 이동량이 손가락 이동량과 같다(실측 오차 6px). 미세 조정에만 쓰고, 훑기는 빠르게.
        self.adb('shell', f'input swipe {x0:.0f} {y0:.0f} {x1:.0f} {y1:.0f} {ms}')

# [2026-10-18 사용자 안내] 게임 첫 화면은 매번 다른 곳(공사 중인 지도)일 수 있다. 최소 배율에서 지도 왼쪽 아래 끝까지 간 뒤
# (손가락 오른쪽 위로 여러 번) 거기를 기준으로 카메라 오른쪽 1~2번(손가락 왼쪽)·위로 2~3번(손가락 아래)이면 마을 가운데(창고·시장·헬기장·비행장).
# 10-18 08:5x 실기기: 왼쪽 아래 끝 → 손가락 왼쪽 1번 → 아래 2번에 네 건물 모두 보임. 각 드래그 뒤 다시 재서 찾으면 바로 미세 조정으로 넘어간다.
# 손가락 드래그 (x0,y0,x1,y1) 화면 비율. HUD(왼쪽 위 이벤트·왼쪽 아래 버튼)를 피한 자리에서 시작한다.
CORNER = (0.30, 0.70, 0.75, 0.25)   # 손가락 오른쪽 위 → 카메라 왼쪽 아래
LEFT = (0.75, 0.54, 0.25, 0.54)     # 손가락 왼쪽 → 카메라 오른쪽
DOWN = (0.50, 0.24, 0.50, 0.81)     # 손가락 아래 → 카메라 위
UP = (0.50, 0.81, 0.50, 0.24)       # 손가락 위 → 카메라 아래
# [10-18 사용자 결정] 기준점 뒤 카메라 오른쪽·위·위(우리 마을은 여기서 찾음) → 오른쪽·아래·아래 → 오른쪽·위·위로 지도를 ㄹ자로 훑는다.
# 드래그마다 다시 재서 찾으면 바로 미세 조정(다른 사람 마을은 중간에 창고가 있을 수 있음).
SEARCH = [CORNER] * 5 + [LEFT, DOWN, DOWN, LEFT, UP, UP, LEFT, DOWN, DOWN]
# [2026-10-20 사용자 지시] 처음부터 창고를 찾지 않는다: 빠른 줌아웃(2번 + 화면 비교로 더 안 줄어들 때까지) → 측정 없이 왼쪽 아래 끝까지
# 빠르게(전후 화면이 같으면 끝) → ㄹ자(오른쪽·위·위 → 오른쪽·아래·아래 → 오른쪽·위·위)로 건물을 찾는다.
SNAKE = [LEFT, DOWN, DOWN, LEFT, UP, UP, LEFT, DOWN, DOWN]
SAME_VIEW = 4.0   # 축소(160x72, 해상도와 무관) 회색조 평균 차이: 이보다 작으면 화면이 안 움직인 것(사람·구름 애니메이션은 1~3, 이동하면 20 이상)
NEAR_SCORE = 0.7  # ㄹ자 훑기에서 이 이상이면 그쪽으로 다가가며 다듬는다(최종 확인은 MIN_SCORE 그대로)

def view_diff(a, b):
    sa = cv2.resize(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), (160, 72), interpolation=cv2.INTER_AREA).astype(np.int16)
    sb = cv2.resize(cv2.cvtColor(b, cv2.COLOR_BGR2GRAY), (160, 72), interpolation=cv2.INTER_AREA).astype(np.int16)
    return float(np.abs(sa - sb).mean())

def fast_search(phone, W, H, refs):
    # 반환: 건물을 찾은 화면(측정값 포함) 또는 None
    first = phone.capture(); moved = False
    for _ in range(2): phone.pinch(W / 2, H / 2, 900, 150); time.sleep(0.2)
    prev = phone.capture(); moved = view_diff(first, prev) >= SAME_VIEW
    for k in range(4):
        phone.pinch(W / 2, H / 2, 900, 150); time.sleep(0.3); cur = phone.capture(); d = view_diff(prev, cur)
        log(f'zoom-out {k + 3}: diff {d:.1f}')
        if d < SAME_VIEW: break
        moved = True
        prev = cur
    prev = cur
    for k in range(10):
        x0, y0, x1, y1 = CORNER; phone.swipe(x0 * W, y0 * H, x1 * W, y1 * H, 250); time.sleep(0.35)
        cur = phone.capture(); d = view_diff(prev, cur); log(f'corner {k + 1}: diff {d:.1f}')
        if d < SAME_VIEW: break
        prev = cur; moved = True
    # 줌도 이동도 화면을 전혀 못 바꾸면 마을이 아니다(창고 창 등이 열림) → ㄹ자 훑기로 시간 쓰지 않고 실패로 돌려준다.
    if not moved: log('줌·이동에 화면이 안 바뀜 - 마을 화면이 아닌 듯(창이 열림?)'); return None
    for k, (x0, y0, x1, y1) in enumerate(SNAKE):
        im = phone.capture(); m = camera_ref.measure(im, refs)
        log(f'snake {k}: score {m[0]:.3f} {m[6]}')
        if m[0] >= NEAR_SCORE: return im
        phone.swipe(x0 * W, y0 * H, x1 * W, y1 * H); time.sleep(0.4)   # 느린 드래그(관성 없음) — 칸 간격이 사용자 안내와 맞아야 한다
    im = phone.capture(); m = camera_ref.measure(im, refs); log(f'snake end: score {m[0]:.3f} {m[6]}')
    return im if m[0] >= NEAR_SCORE else None

def drag_points(dx, dy, W, H):
    # 화면 가장자리 HUD를 피한 안쪽 영역에서 시작·끝이 모두 들어가는 드래그를 고른다.
    lo_x, hi_x, lo_y, hi_y = 0.15 * W, 0.80 * W, 0.20 * H, 0.78 * H
    dx = max(-(hi_x - lo_x), min(hi_x - lo_x, dx)); dy = max(-(hi_y - lo_y), min(hi_y - lo_y, dy))
    x0 = lo_x if dx >= 0 else hi_x; y0 = lo_y if dy >= 0 else hi_y
    # [2026-10-18] 세로만·가로만 끌 때 모서리(0.15W,0.2H)에서 시작하면 왼쪽 위 이벤트 아이콘을 잡아 화면이 안 움직였다 → 가운데 줄에서 시작.
    if dx == 0: x0 = W / 2
    if dy == 0: y0 = H / 2
    return x0, y0, x0 + dx, y0 + dy

def restore(phone, check_only=False, max_steps=26):
    if not phone.foreground(): log('Township이 전면이 아님'); return 2
    phone.ensure_pinch(); zoomed_out = False; searched = 0; refs = None
    for step in range(max_steps):
        # [2026-10-16] 도중에 게임이 꺼지면 홈 화면에 핀치·드래그가 들어가 최근 앱 메뉴 등이 열렸다 → 매 단계 확인.
        if step and not phone.foreground(): log('도중에 Township이 전면이 아님 - 중단'); return 2
        im = phone.capture(); H, W = im.shape[:2]
        if refs is None:
            refs = camera_ref.load_refs(W, H)
            if not refs: log(f'이 화면 크기({W}x{H})의 카메라 기준 후보가 없음 - register_town.py로 등록 필요'); return 1
        # [2026-10-17] 후보(건물)마다 기준 중심이 따로 있다. 가장 잘 맞는 건물 하나로 배율·위치를 잰다(네 건물 배치 고정).
        score, scale, cx, cy, rx, ry, name = camera_ref.measure(im, refs)
        log(f'step {step}: score {score:.3f} scale {scale:.2f} {name} ({cx:.0f},{cy:.0f}) target ({rx:.0f},{ry:.0f})')
        if score >= MIN_SCORE and abs(scale - 1) <= SCALE_TOLERANCE and np.hypot(cx - rx, cy - ry) <= POSITION_TOLERANCE * W:
            log('기준 카메라 확인'); return 0
        if check_only: return 1
        if score < (NEAR_SCORE if zoomed_out else MIN_SCORE):
            if not zoomed_out:
                zoomed_out = True
                if fast_search(phone, W, H, refs) is None: log('기준 건물을 찾지 못함'); camera_ref.save_low(im, score, 'restore', every=0); return 1
                continue
            else:
                # 최소 배율에서도 창고가 없으면 훑는다. [2026-10-18] 옛 순서(오른쪽500·아래300·왼쪽1000·위600)는 끝나면 시작점보다
                # 왼쪽·위(화면은 아래쪽 바다)로 밀려, 실패할 때마다 카메라가 바다로 흘러가 아무 건물도 안 보이게 됐다(정지사례 #26).
                # 그래서 지도 왼쪽 아래 끝을 기준으로 삼아 마을 가운데로 간다(SEARCH, 사용자 안내).
                if searched >= len(SEARCH): log('기준 건물을 찾지 못함'); camera_ref.save_low(im, score, 'restore', every=0); return 1
                x0, y0, x1, y1 = SEARCH[searched]; searched += 1
                phone.swipe(x0 * W, y0 * H, x1 * W, y1 * H)
        elif abs(scale - 1) > SCALE_TOLERANCE and not (0.25 * W < cx < 0.75 * W and 0.25 * H < cy < 0.7 * H):
            # 가장자리에서 확대하면 창고가 화면 밖으로 밀려난다(2026-10-15 실측). 먼저 화면 가운데로 옮긴다.
            phone.swipe(*drag_points(W / 2 - cx, H * 0.45 - cy, W, H))
        elif abs(scale - 1) > SCALE_TOLERANCE:
            ratio = min(2.2, max(0.45, (1 / scale) ** (1 / PINCH_EXPONENT)))
            g0, g1 = (300, 300 * ratio) if ratio > 1 else (300 / ratio, 300)
            phone.pinch(cx, cy, g0, g1)
        else:
            phone.swipe(*drag_points(rx - cx, ry - cy, W, H))
        time.sleep(0.5)  # [2026-10-20] raw 캡처 + 미세 조정만 남아 0.7→0.5
    log('단계 한도 초과'); camera_ref.save_low(im, score, 'restore', every=0); return 1

def default_serial():
    # 시리얼 우선순위: --serial > 환경변수 TOWNSHIP_SERIAL > setup-local/device.json(처음설정이 만듦)
    s = os.environ.get('TOWNSHIP_SERIAL', '').strip()
    if not s:
        try: s = str(json.loads((ROOT / 'setup-local/device.json').read_text(encoding='utf-8-sig')).get('serial') or '').strip()
        except (OSError, ValueError): s = ''
    if not s: sys.exit('폰 시리얼을 모른다: --serial, 환경변수 TOWNSHIP_SERIAL, 또는 setup-local/device.json(처음설정) 필요')
    return s

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--serial', default=None); p.add_argument('--check', action='store_true')
    a = p.parse_args()
    a.serial = a.serial or default_serial()
    if a.serial.startswith('emulator-'): sys.exit('MuMu 에뮬레이터는 다루지 않는다')
    sys.exit(restore(Phone(a.serial), a.check))
