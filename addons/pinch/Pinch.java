// [사용자 변경 2026-10-15] adb 셸 권한(INJECT_EVENTS)으로 두 손가락 핀치를 주입한다(scrcpy와 같은 app_process 방식).
// adb input 에는 멀티터치가 없고, /dev/input 직접 쓰기는 SELinux가 막는다.
// 사용: CLASSPATH=/data/local/tmp/pinch.dex app_process / Pinch <cx> <cy> <startGap> <endGap> <steps> <stepMs> [x|y]
// 좌표는 현재 화면(회전 반영된 논리 디스플레이) 픽셀. startGap>endGap = 줌아웃, startGap<endGap = 줌인.
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.InputEvent;
import android.view.MotionEvent;
import java.lang.reflect.Method;

public class Pinch {
  static Object manager;
  static Method inject;

  public static void main(String[] a) throws Exception {
    float cx = Float.parseFloat(a[0]), cy = Float.parseFloat(a[1]);
    float g0 = Float.parseFloat(a[2]), g1 = Float.parseFloat(a[3]);
    int steps = Integer.parseInt(a[4]), stepMs = Integer.parseInt(a[5]);
    boolean vertical = a.length > 6 && a[6].equals("y");
    manager = Class.forName("android.hardware.input.InputManager").getMethod("getInstance").invoke(null);
    inject = manager.getClass().getMethod("injectInputEvent", InputEvent.class, int.class);
    long down = SystemClock.uptimeMillis();
    send(down, MotionEvent.ACTION_DOWN, 1, cx, cy, vertical, g0);
    send(down, MotionEvent.ACTION_POINTER_DOWN | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), 2, cx, cy, vertical, g0);
    for (int i = 1; i <= steps; i++) {
      Thread.sleep(stepMs);
      send(down, MotionEvent.ACTION_MOVE, 2, cx, cy, vertical, g0 + (g1 - g0) * i / steps);
    }
    Thread.sleep(stepMs);
    send(down, MotionEvent.ACTION_POINTER_UP | (1 << MotionEvent.ACTION_POINTER_INDEX_SHIFT), 2, cx, cy, vertical, g1);
    send(down, MotionEvent.ACTION_UP, 1, cx, cy, vertical, g1);
  }

  static void send(long down, int action, int count, float cx, float cy, boolean vertical, float gap) throws Exception {
    MotionEvent.PointerProperties[] props = new MotionEvent.PointerProperties[count];
    MotionEvent.PointerCoords[] coords = new MotionEvent.PointerCoords[count];
    for (int i = 0; i < count; i++) {
      props[i] = new MotionEvent.PointerProperties();
      props[i].id = i;
      props[i].toolType = MotionEvent.TOOL_TYPE_FINGER;
      coords[i] = new MotionEvent.PointerCoords();
      float d = (i == 0 ? -gap : gap) / 2;
      coords[i].x = vertical ? cx : cx + d;
      coords[i].y = vertical ? cy + d : cy;
      coords[i].pressure = 1;
      coords[i].size = 1;
    }
    MotionEvent e = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, count, props, coords, 0, 0, 1, 1, 0, 0,
        InputDevice.SOURCE_TOUCHSCREEN, 0);
    inject.invoke(manager, e, 2);
    e.recycle();
  }
}
