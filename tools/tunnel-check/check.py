#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Поднять туннели в Docker, померить и убрать за собой.

Каждый узел — отдельный контейнер, SOCKS только на 127.0.0.1. Системные
маршруты не меняются: игра и VPN-клиенты работают как работали.

    python tools/tunnel-check/check.py sub.json de nl us jp

Печатает таблицу: страна, IP выхода, задержка, скорость. Контейнеры удаляются
в конце, даже если проверка упала.
"""
import io
import json
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
IMAGE = "teddysun/xray:latest"
BASE_PORT = 10801


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def clean():
    for name in [f"k4r-check-{n}" for n in range(1, 9)] + ["k4r-de", "k4r-nl", "k4r-us", "k4r-jp"]:
        run(["docker", "rm", "-f", name])


def curl(proxy_port, url, extra=None, timeout=60):
    cmd = ["curl", "-s", "--max-time", str(timeout), "--proxy", f"socks5h://127.0.0.1:{proxy_port}"]
    cmd += extra or ["-o", "-", url]
    return run(cmd).stdout.strip()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    payload = json.load(io.open(sys.argv[1], encoding="utf-8"))
    want = [a.lower() for a in sys.argv[2:]] or ["de"]

    if run(["docker", "version"]).returncode != 0:
        print("Docker не запущен — включи Docker Desktop и повтори")
        return 1

    # конфиги узлов
    mk = os.path.join(HERE, "mk-configs.py")
    made = run([sys.executable, "-X", "utf8", mk, sys.argv[1], *want])
    print(made.stdout.strip())
    if made.returncode != 0:
        return 1

    direct_ip = curl(0, "https://api.ipify.org") if False else run(
        ["curl", "-s", "--max-time", "15", "https://api.ipify.org"]
    ).stdout.strip()
    print(f"без туннеля: {direct_ip}\n")

    clean()
    names = []
    try:
        for i, cc in enumerate(want):
            port = BASE_PORT + i
            name = f"k4r-check-{i + 1}"
            cfg = os.path.join(OUT, f"xray-{cc[:2]}{i + 1}.json")
            if not os.path.exists(cfg):
                continue
            names.append(name)
            r = run(
                [
                    "docker", "run", "-d", "--name", name,
                    "-p", f"127.0.0.1:{port}:1080",
                    "-v", f"{cfg}:/etc/xray/config.json:ro", IMAGE,
                ]
            )
            if r.returncode != 0:
                print(f"{cc}: не поднялся — {r.stderr.strip()[:120]}")
                continue
        time.sleep(5)

        print(f"{'стр':<4}{'IP выхода':<17}{'задержка':>10}{'скорость':>12}")
        for i, cc in enumerate(want):
            port = BASE_PORT + i
            ip = curl(port, "https://api.ipify.org", timeout=25)
            if not ip:
                print(f"{cc:<4}{'—':<17}{'нет ответа':>10}")
                continue
            t = run(
                ["curl", "-s", "-o", os.devnull, "-w", "%{time_total}", "--max-time", "25",
                 "--proxy", f"socks5h://127.0.0.1:{port}", "https://api.ipify.org"]
            ).stdout.strip()
            speed = run(
                ["curl", "-s", "-o", os.devnull, "-w", "%{speed_download}", "--max-time", "45",
                 "--proxy", f"socks5h://127.0.0.1:{port}",
                 "https://speed.cloudflare.com/__down?bytes=5000000"]
            ).stdout.strip()
            speed_mb = float(speed or 0) / 1_000_000
            print(f"{cc:<4}{ip:<17}{float(t or 0) * 1000:>8.0f} мс{speed_mb:>9.1f} МБ/с")
    finally:
        clean()
        shutil.rmtree(OUT, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
