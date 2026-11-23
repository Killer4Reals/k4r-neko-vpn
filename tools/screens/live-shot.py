# -*- coding: utf-8 -*-
"""Снимок окна приложения без перехвата фокуса: PrintWindow рисует окно даже
под другой программой. Нужен, чтобы проверять клиент, не мешая игре."""
import ctypes
import ctypes.wintypes as wt
import os
import subprocess
import sys
import time

from PIL import Image

EXE = r'C:\Users\KILLER~1\AppData\Local\Temp\k4r_portable3\K4R-Neko-VPN\K4R Neko VPN.exe'
OUT = r'C:\Users\KILLER~1\AppData\Local\Temp'

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
user32.SetProcessDPIAware()


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ('biSize', wt.DWORD), ('biWidth', wt.LONG), ('biHeight', wt.LONG),
        ('biPlanes', wt.WORD), ('biBitCount', wt.WORD), ('biCompression', wt.DWORD),
        ('biSizeImage', wt.DWORD), ('biXPelsPerMeter', wt.LONG), ('biYPelsPerMeter', wt.LONG),
        ('biClrUsed', wt.DWORD), ('biClrImportant', wt.DWORD),
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [('bmiHeader', BITMAPINFOHEADER), ('bmiColors', wt.DWORD * 3)]


def find_window(title_part: str, timeout=45.0):
    end = time.time() + timeout
    while time.time() < end:
        found = []

        @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
        def cb(hwnd, _):
            n = user32.GetWindowTextLengthW(hwnd)
            if n:
                buf = ctypes.create_unicode_buffer(n + 1)
                user32.GetWindowTextW(hwnd, buf, n + 1)
                if title_part.lower() in buf.value.lower():
                    found.append((hwnd, buf.value))
            return True

        user32.EnumWindows(cb, 0)
        if found:
            return found[0]
        time.sleep(0.7)
    return None


def print_window(hwnd, path):
    r = wt.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    w, h = r.right - r.left, r.bottom - r.top
    hdc = user32.GetWindowDC(hwnd)
    mem = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
    gdi32.SelectObject(mem, bmp)
    # 2 = PW_RENDERFULLCONTENT: иначе WebView2 отдаёт пустой кадр
    ok = user32.PrintWindow(hwnd, mem, 2)
    bi = BITMAPINFO()
    bi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bi.bmiHeader.biWidth = w
    bi.bmiHeader.biHeight = -h
    bi.bmiHeader.biPlanes = 1
    bi.bmiHeader.biBitCount = 32
    bi.bmiHeader.biCompression = 0  # BI_RGB
    buf = ctypes.create_string_buffer(w * h * 4)
    gdi32.GetDIBits(mem, bmp, 0, h, buf, ctypes.byref(bi), 0)
    img = Image.frombuffer('RGBA', (w, h), buf, 'raw', 'BGRA', 0, 1)
    img.convert('RGB').save(path)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mem)
    user32.ReleaseDC(hwnd, hdc)
    print('PrintWindow', ok, path, (w, h))


# screen=history — открыть нужный экран сразу, без кликов мышью
SCREEN = os.environ.get('K4R_SCREEN', '')
proc = subprocess.Popen([EXE] + ([f'--screen={SCREEN}'] if SCREEN else []), cwd=os.path.dirname(EXE))
time.sleep(10)
win = find_window('K4R Neko VPN')
if not win:
    print('ОКНО НЕ НАЙДЕНО')
    sys.exit(1)
hwnd, title = win
print('окно:', title)
print_window(hwnd, os.path.join(OUT, 'pw_home.png'))
# закрываем аккуратно, без кликов по экрану
user32.PostMessageW(hwnd, 0x0010, 0, 0)
time.sleep(2)
if proc.poll() is None:
    proc.terminate()
print('готово')
