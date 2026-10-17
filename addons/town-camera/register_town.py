# [사용자 변경 2026-10-17] 자기 마을 카메라 등록 도구.
# 사용자가 폰에서 마을 카메라(배율·위치)를 봇을 돌릴 상태로 맞춘 뒤 실행한다. 지금 화면을 캡처하고 PC 창에서
# 창고·시장·헬기장·비행장을 차례로 드래그로 감싸면(Enter=확정, c=건너뜀), 그 건물 이미지가 카메라 기준 후보가 되고
# 시장·창고 상자의 가운데가 봇의 마을 탭(marketTap/barnTap)이 된다. 결과는 setup-local/town-camera/ 에 저장되고
# 봇(android_vision.py)과 카메라 복원(town_camera.py)이 다음 실행부터 자동으로 쓴다(개발용 refs/ 보다 우선).
# 네 건물 배치는 원작자 지시로 고정이라 후보 하나만 맞아도 카메라 정상으로 본다 → 최소 시장·창고 두 개는 필수.
# 사용: .venv-perception/Scripts/python.exe -I addons/town-camera/register_town.py [--serial S] [--image 캡처.png]
#   GUI 없이: --box barn=x,y,w,h --box market=... (화면 비율 0~1), --ignore helipad=x,y,w,h (상자 안 비율, 비교 제외)
#   개발용 후보 만들기: --out addons/town-camera/refs --no-taps
import argparse, hashlib, json, shutil, sys, time
from pathlib import Path
import cv2, numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
import camera_ref
from town_camera import Phone, default_serial, PACKAGE

NAMES = [('barn', '창고'), ('market', '시장'), ('helipad', '헬기장'), ('airport', '비행장')]
sys.stdout.reconfigure(encoding='utf-8'); sys.stderr.reconfigure(encoding='utf-8')

def frac_box(s):
    v = [float(x) for x in s.split(',')]
    if len(v) != 4 or not all(0 <= x <= 1 for x in v) or v[2] <= 0 or v[3] <= 0: raise ValueError(f'비율 상자는 x,y,w,h (0~1): {s}')
    return dict(x=v[0], y=v[1], width=v[2], height=v[3])

def pick_gui(im):
    H, W = im.shape[:2]; out = {}
    for name, ko in NAMES:
        print(f'[{ko}] 건물을 드래그로 감싸고 Enter (건너뛰려면 c). 느낌표·사람·타이머는 되도록 빼고 건물 몸체만.', flush=True)
        x, y, w, h = cv2.selectROI(f'{ko} ({name}) - Enter 확정 / c 건너뜀', im, showCrosshair=True)
        cv2.destroyAllWindows()
        if w >= 20 and h >= 20: out[name] = dict(x=x / W, y=y / H, width=w / W, height=h / H)
    return out

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--serial'); p.add_argument('--image'); p.add_argument('--out', default=str(camera_ref.USER_DIR))
    p.add_argument('--box', action='append', default=[]); p.add_argument('--ignore', action='append', default=[])
    p.add_argument('--no-taps', action='store_true')
    a = p.parse_args()
    if a.image:
        im = cv2.imread(a.image); src_note = f'파일 {Path(a.image).name}'
        if im is None: sys.exit(f'이미지를 못 읽음: {a.image}')
    else:
        serial = a.serial or default_serial()
        if serial.startswith('emulator-'): sys.exit('MuMu 에뮬레이터는 다루지 않는다')
        phone = Phone(serial)
        if not phone.foreground(): sys.exit('Township이 전면이 아니다. 게임 마을 화면을 띄우고 카메라를 맞춘 뒤 다시 실행.')
        im = phone.capture(); src_note = 'adb 캡처(사용자가 카메라를 맞춘 마을 화면)'
    H, W = im.shape[:2]
    boxes = {k: frac_box(v) for k, v in (b.split('=', 1) for b in a.box)} if a.box else pick_gui(im)
    ignores = {}
    for b in a.ignore:
        k, v = b.split('=', 1); ignores.setdefault(k, []).append(frac_box(v))
    if not boxes: sys.exit('등록할 건물이 없다')
    if not a.no_taps and not {'market', 'barn'} <= boxes.keys(): sys.exit('시장과 창고는 꼭 감싸야 한다(봇이 누르는 곳)')

    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    # 같은 화면 크기의 옛 후보는 지운다(다른 카메라 기준과 섞이지 않게).
    for f in out.glob(f'*-{W}.json'):
        f.unlink(); f.with_suffix('.png').unlink(missing_ok=True)
    stamp = time.strftime('%Y%m%d-%H%M%S'); src = out / f'source-town-{W}.png'
    cv2.imwrite(str(src), im); sha = hashlib.sha256(src.read_bytes()).hexdigest()
    for name, b in boxes.items():
        x, y, w, h = round(b['x'] * W), round(b['y'] * H), round(b['width'] * W), round(b['height'] * H)
        cv2.imwrite(str(out / f'{name}-{W}.png'), im[y:y + h, x:x + w])
        meta = dict(productId=name, screen='town', dimensions=dict(width=W, height=H),
                    source=dict(file=src.name, sha256=sha, provider='android_adb', capturedBy=src_note, registeredAt=stamp),
                    region=dict(unit='fraction', space='capture', x=x / W, y=y / H, width=w / W, height=h / H),
                    referenceCenter=dict(unit='fraction', space='capture', x=(x + w / 2) / W, y=(y + h / 2) / H),
                    note='기준 카메라에서 이 건물이 배율 1.00·이 중심에 오면 카메라 정상(네 건물 배치 고정).')
        if ignores.get(name): meta['ignore'] = ignores[name]
        (out / f'{name}-{W}.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
    if not a.no_taps:
        taps = {f'{n}Tap': dict(unit='fraction', space='game', x=boxes[n]['x'] + boxes[n]['width'] / 2, y=boxes[n]['y'] + boxes[n]['height'] / 2,
                                source=dict(file=src.name, sha256=sha)) for n in ('market', 'barn')}
        (out / f'town-{W}x{H}.json').write_text(json.dumps(dict(dimensions=dict(width=W, height=H), registeredAt=stamp, **taps), ensure_ascii=False, indent=1), encoding='utf-8')

    # 검증: 방금 등록한 화면에서 후보마다 기준 카메라로 확인돼야 하고, 다른 건물 자리와 헷갈리지 않아야 한다.
    refs = camera_ref.load_refs(W, H, [out])
    bad = []
    for r in refs:
        ok, top = camera_ref.check(im, [r]); v, s, cx, cy, *_ = camera_ref.measure(im, [r])
        print(f"{r['name']}: 기준 확인 {'OK' if ok else '실패'} 점수 {top:.3f} / 전체 탐색 배율 {s:.2f} 중심 ({cx:.0f},{cy:.0f}) 기준 ({r['center'][0]:.0f},{r['center'][1]:.0f})")
        if not ok or abs(s - 1) > camera_ref.SCALE_TOLERANCE or np.hypot(cx - r['center'][0], cy - r['center'][1]) > camera_ref.POSITION_TOLERANCE * W: bad.append(r['name'])
    if bad: sys.exit(f'검증 실패: {bad} - 상자를 더 크게(건물 몸체 위주로) 다시 등록하세요')
    print(f'등록 완료: {out} ({len(refs)}개 후보). 봇을 다시 켜면 적용됩니다.')

if __name__ == '__main__':
    main()
