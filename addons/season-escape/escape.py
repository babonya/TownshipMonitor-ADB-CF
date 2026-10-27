# [사용자 결정 2026-10-24] 시즌 탐험(할로윈 등) 화면에서 봇이 '모르는 화면'으로 멈추면 감시(watchdog.ps1)가 이 스크립트를 부른다.
# 봇에는 뒤로가기 동작이 없어(입력은 탭·스와이프만) 감시 쪽에서 처리한다. 정지사례 #39.
#   - 스토리 화면 SKIP 버튼 → SKIP을 누른다(실제로 눌러 넘어감 확인 10-23).
#   - 시즌 안내 창(LET'S GO만, X 없음) → 뒤로가기(실제로 닫힘 확인).
#   - 시즌 패스 창('Activate the ... Pass', 유료 버튼) → 뒤로가기(결제 버튼은 절대 안 누름).
#   - 탐험 화면(위쪽 번개 에너지 + 오른쪽 위 톱니) → 뒤로가기로 마을(실제로 나옴 확인).
#   - 그 밖의 화면은 아무것도 안 한다(마을에서 뒤로가기는 종료 확인창이 뜸).
# 기준 그림은 1600x720 실기기 캡처(setup-local/stuck-1023)에서 잘랐다. 다른 해상도는 그 해상도 캡처에서 같은 부분을 잘라
# 같은 이름으로 바꾸고, 아래 찾는 영역(화면 비율)을 확인한다(docs/다른해상도_적용.md).
# 사용: python -I escape.py <시리얼>   종료 코드: 0 = 동작함, 1 = 해당 화면 아님, 2 = 오류
import os, subprocess, sys, time
from pathlib import Path
import cv2, numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
ADB = Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk/platform-tools/adb.exe'
ENV = {**os.environ, 'ANDROID_ADB_SERVER_PORT': '15037'}
LOG = ROOT / 'runtime/season-escape.log'
SHOTS = ROOT / 'runtime/screenshots'
# (그림, 찾는 영역 x,y,w,h 화면 비율, 점수 기준)
SPECS = {
    'skip': ('skip.png', (0.78, 0.0, 0.22, 0.15), 0.9),
    'letsgo': ('letsgo.png', (0.37, 0.66, 0.26, 0.31), 0.9),
    'pass': ('pass_activate.png', (0.59, 0.0, 0.35, 0.2), 0.85),
    'bolt': ('bolt.png', (0.35, 0.0, 0.13, 0.15), 0.9),
    'gear': ('gear.png', (0.9, 0.0, 0.1, 0.15), 0.9),
}

def log(text):
    try:
        with open(LOG, 'a', encoding='utf-8') as f: f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + text + '\n')
    except OSError: pass

def adb(serial, *args, binary=False):
    r = subprocess.run([str(ADB), '-s', serial, *args], capture_output=True, timeout=30, env=ENV)
    if r.returncode: raise RuntimeError('ADB_FAILED ' + args[0])
    return r.stdout if binary else r.stdout.decode(errors='ignore')

def capture(serial):
    data = adb(serial, 'exec-out', 'screencap', binary=True)
    w, h = int.from_bytes(data[0:4], 'little'), int.from_bytes(data[4:8], 'little'); off = len(data) - w * h * 4
    if w <= 0 or h <= 0 or off not in (12, 16): raise RuntimeError('CAPTURE_DECODE_FAILED')
    return np.ascontiguousarray(np.frombuffer(data, np.uint8, offset=off).reshape(h, w, 4)[:, :, 2::-1])

def find(im, name):
    file, (fx, fy, fw, fh), threshold = SPECS[name]
    t = cv2.imread(str(HERE / file)); H, W = im.shape[:2]
    x, y, w, h = round(fx * W), round(fy * H), round(fw * W), round(fh * H)
    crop = im[y:y + h, x:x + w]
    if t is None or crop.shape[0] < t.shape[0] or crop.shape[1] < t.shape[1]: return None
    _, score, _, (px, py) = cv2.minMaxLoc(cv2.matchTemplate(crop, t, cv2.TM_CCOEFF_NORMED))
    return (x + px + t.shape[1] // 2, y + py + t.shape[0] // 2, score) if score >= threshold else None

def main(serial):
    if 'township' not in adb(serial, 'shell', 'dumpsys window | grep -m1 mCurrentFocus'): return 1
    im = capture(serial); H, W = im.shape[:2]
    if (W, H) != (1600, 720): return 1   # 기준 그림이 1600x720뿐(위 주석)
    skip = find(im, 'skip')
    if skip: action, detail = 'skip', skip
    elif find(im, 'letsgo'): action, detail = 'back', 'season-intro'
    elif find(im, 'pass'): action, detail = 'back', 'season-pass'
    elif find(im, 'bolt') and find(im, 'gear'): action, detail = 'back', 'exploration'
    else: return 1
    try:
        SHOTS.mkdir(parents=True, exist_ok=True); cv2.imwrite(str(SHOTS / time.strftime('escape-%Y%m%d-%H%M%S.png')), im)
    except Exception: pass
    if action == 'skip': adb(serial, 'shell', 'input', 'tap', str(skip[0]), str(skip[1]))
    else: adb(serial, 'shell', 'input', 'keyevent', '4')
    log(f'{action} ({detail})'); print(f'{action} {detail}'); return 0

if __name__ == '__main__':
    try: sys.exit(main(sys.argv[1]))
    except Exception as e: log('오류: ' + str(e)); sys.exit(2)
