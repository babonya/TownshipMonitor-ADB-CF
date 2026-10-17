using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX.Direct3D11;

namespace TownshipDesktopBridge;

internal static class Native
{
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; public Point(int x,int y){X=x;Y=y;} }
    [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int X,Y; public uint Data,Flags,Time; public nuint Extra; }
    [StructLayout(LayoutKind.Explicit,Size=40)] public struct Input { [FieldOffset(0)] public uint Type; [FieldOffset(8)] public Mouse Mouse; }
    public delegate bool EnumProc(nint hwnd,nint param);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb,nint p);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(nint hwnd,EnumProc cb,nint p);
    [DllImport("user32.dll")] public static extern bool IsWindow(nint hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(nint hwnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(nint hwnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(nint hwnd,out uint pid);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(nint hwnd,StringBuilder text,int n);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(nint hwnd,StringBuilder text,int n);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(nint hwnd,out Rect rect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(nint hwnd,out Rect rect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(nint hwnd,ref Point point);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(nint hwnd);
    [DllImport("user32.dll")] public static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] public static extern nint WindowFromPoint(Point point);
    [DllImport("user32.dll")] public static extern nint GetAncestor(nint hwnd,uint flags);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] public static extern nint SetThreadDpiAwarenessContext(nint context);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(nint context);
    [DllImport("user32.dll",SetLastError=true)] public static extern uint SendInput(uint count,Input[] inputs,int size);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(nint hwnd,int attr,out Rect rect,int size);
    [DllImport("dwmapi.dll",EntryPoint="DwmGetWindowAttribute")] public static extern int DwmInt(nint hwnd,int attr,out int value,int size);
    [DllImport("d3d11.dll")] static extern int D3D11CreateDevice(nint adapter,int driver,nint software,uint flags,nint levels,uint count,uint sdk,out nint device,out int level,out nint context);
    [DllImport("d3d11.dll")] static extern int CreateDirect3D11DeviceFromDXGIDevice(nint device,out nint result);
    [DllImport("combase.dll",CharSet=CharSet.Unicode)] static extern int WindowsCreateString(string text,int length,out nint result);
    [DllImport("combase.dll")] static extern int WindowsDeleteString(nint text);
    [DllImport("combase.dll")] static extern int RoGetActivationFactory(nint text,ref Guid iid,out nint result);
    public static string Title(nint hwnd){var s=new StringBuilder(1024);GetWindowText(hwnd,s,s.Capacity);return s.ToString();}
    public static string Class(nint hwnd){var s=new StringBuilder(256);GetClassName(hwnd,s,s.Capacity);return s.ToString();}
    public static IDirect3DDevice CreateDevice()
    {
        Marshal.ThrowExceptionForHR(D3D11CreateDevice(0,1,0,0x20,0,0,7,out var device,out _,out var context));
        nint dxgi=0,abi=0;
        try {var id=new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");Marshal.ThrowExceptionForHR(Marshal.QueryInterface(device,ref id,out dxgi));
            Marshal.ThrowExceptionForHR(CreateDirect3D11DeviceFromDXGIDevice(dxgi,out abi));return WinRT.MarshalInterface<IDirect3DDevice>.FromAbi(abi);
        } finally {if(abi!=0)Marshal.Release(abi);if(dxgi!=0)Marshal.Release(dxgi);Marshal.Release(context);Marshal.Release(device);}
    }
    public static unsafe GraphicsCaptureItem CreateItem(nint hwnd)
    {
        const string name="Windows.Graphics.Capture.GraphicsCaptureItem";
        Marshal.ThrowExceptionForHR(WindowsCreateString(name,name.Length,out var hs));nint factory=0,item=0;
        try {var interop=new Guid("3628e81b-3cac-4c60-b7f4-23ce0e0c3356");Marshal.ThrowExceptionForHR(RoGetActivationFactory(hs,ref interop,out factory));
            var iid=new Guid("79c3f95b-31f7-4ec2-a464-632ef5d30760");
            var fn=(delegate* unmanaged[Stdcall]<nint,nint,Guid*,nint*,int>)(*(nint**)factory)[3];
            Marshal.ThrowExceptionForHR(fn(factory,hwnd,&iid,&item));return WinRT.MarshalInterface<GraphicsCaptureItem>.FromAbi(item);
        }finally{if(item!=0)Marshal.Release(item);if(factory!=0)Marshal.Release(factory);WindowsDeleteString(hs);}
    }
}
