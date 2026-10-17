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
        im = cv2.imdecode(np.frombuffer(self.adb('exec-out', 'screencap', '-p', binary=True), np.uint8), cv2.IMREAD_COLOR)
        if im is None: raise RuntimeError('CAPTURE_DECODE_FAILED')
        return im
    def ensure_pinch(self):
        if DEX_REMOTE not in self.adb('shell', f'ls {DEX_REMOTE} 2>/dev/null'):
            self.adb('push', str(DEX_LOCAL), DEX_REMOTE)
    def pinch(self, cx, cy, g0, g1):
        self.adb('shell', f'CLASSPATH={DEX_REMOTE} app_process / Pinch {cx:.0f} {cy:.0f} {g0:.0f} {g1:.0f} 10 16')
    def swipe(self, x0, y0, x1, y1):
        # 느린 드래그는 관성이 없어 이동량이 손가락 이동량과 같다(실측 오차 6px).
        self.adb('shell', f'input swipe {x0:.0f} {y0:.0f} {x1:.0f} {y1:.0f} 1000')

def drag_points(dx, dy, W, H):
    # 화면 가장자리 HUD를 피한 안쪽 영역에서 시작·끝이 모두 들어가는 드래그를 고른다.
    lo_x, hi_x, lo_y, hi_y = 0.15 * W, 0.80 * W, 0.20 * H, 0.78 * H
    dx = max(-(hi_x - lo_x), min(hi_x - lo_x, dx)); dy = max(-(hi_y - lo_y), min(hi_y - lo_y, dy))
    x0 = lo_x if dx >= 0 else hi_x; y0 = lo_y if dy >= 0 else hi_y
    return x0, y0, x0 + dx, y0 + dy

def restore(phone, check_only=False, max_steps=10):
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
        if score < MIN_SCORE:
            if not zoomed_out:
                for _ in range(3): phone.pinch(W / 2, H / 2, 900, 150); time.sleep(0.5)
                zoomed_out = True
            else:
                # 최소 배율에서도 창고가 없으면 상하좌우로 한 번씩 훑는다.
                if searched >= 4: log('기준 건물을 찾지 못함'); camera_ref.save_low(im, score, 'restore', every=0); return 1
                dx, dy = [(500, 0), (0, 300), (-1000, 0), (0, -600)][searched]; searched += 1
                phone.swipe(*drag_points(dx, dy, W, H))
        elif abs(scale - 1) > SCALE_TOLERANCE and not (0.25 * W < cx < 0.75 * W and 0.25 * H < cy < 0.7 * H):
            # 가장자리에서 확대하면 창고가 화면 밖으로 밀려난다(2026-10-15 실측). 먼저 화면 가운데로 옮긴다.
            phone.swipe(*drag_points(W / 2 - cx, H * 0.45 - cy, W, H))
        elif abs(scale - 1) > SCALE_TOLERANCE:
            ratio = min(2.2, max(0.45, (1 / scale) ** (1 / PINCH_EXPONENT)))
            g0, g1 = (300, 300 * ratio) if ratio > 1 else (300 / ratio, 300)
            phone.pinch(cx, cy, g0, g1)
        else:
            phone.swipe(*drag_points(rx - cx, ry - cy, W, H))
        time.sleep(1.5)
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
