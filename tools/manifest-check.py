# -*- coding: utf-8 -*-
"""Проверка манифестов обновления против настоящих релизов.

Что проверяем:
  * версия в манифесте указывает на существующий тег;
  * ссылка в манифесте ведёт на ассет этого релиза (HEAD 200, размер совпадает);
  * sha256 из манифеста совпадает с digest ассета (для Android он обязателен);
  * в заметках нет ответа API об ошибке — такую ошибку уже один раз занесли.

Запуск:
  python tools/manifest-check.py --repo Killer4Reals/k4r-neko-vpn \
      --manifest version.json --tag-template "v{version}"
  python tools/manifest-check.py --repo Killer4Reals/k4r-neko-vpn-android \
      --manifest ../"K4R Neko VPN Android"/version.json --tag-template "v{version}-android"

Токен берётся из `K4R_GITHUB_TOKEN` или из git credential helper — как в CI.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request

API = "https://api.github.com"


def token() -> str:
    env = os.environ.get("K4R_GITHUB_TOKEN", "").strip()
    if env:
        return env
    try:
        out = subprocess.run(
            [
                "C:/Program Files/Git/cmd/git.exe",
                "credential",
                "fill",
            ],
            input="protocol=https\nhost=github.com\n\n",
            capture_output=True,
            text=True,
            timeout=30,
        ).stdout
    except Exception:
        return ""
    for line in out.splitlines():
        if line.startswith("password="):
            return line[len("password=") :].strip()
    return ""


def get(url: str, tok: str, method: str = "GET", accept: str | None = None):
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", f"Bearer {tok}")
    req.add_header("Accept", accept or "application/vnd.github+json")
    return urllib.request.urlopen(req, timeout=60)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="владелец/имя")
    ap.add_argument("--manifest", required=True, help="путь к version.json")
    ap.add_argument("--tag-template", default="v{version}")
    args = ap.parse_args()

    tok = token()
    if not tok:
        print("нет токена: положи K4R_GITHUB_TOKEN")
        return 2

    man = json.loads(pathlib.Path(args.manifest).read_text(encoding="utf-8"))
    version = str(man.get("version", "")).strip()
    url = str(man.get("url", "")).strip()
    notes = str(man.get("notes", ""))
    sha = str(man.get("sha256", "")).strip().lower()
    tag = args.tag_template.format(version=version)
    print(f"манифест {args.manifest}: версия {version}, тег {tag}")

    problems: list[str] = []

    if "documentation_url" in notes or notes.strip() in ("", "null", "{}"):
        problems.append(f"в notes мусор вместо текста: {notes[:60]!r}")

    try:
        rel = json.loads(get(f"{API}/repos/{args.repo}/releases/tags/{tag}", tok).read())
    except urllib.error.HTTPError as e:
        print(f"  релиз {tag} не найден ({e.code})")
        return 1

    if rel.get("draft"):
        problems.append("релиз всё ещё черновик")
    assets = {a["name"]: a for a in rel.get("assets", [])}
    name = url.rsplit("/", 1)[-1]
    asset = assets.get(name)
    if not asset:
        problems.append(f"в релизе нет ассета {name} (есть: {', '.join(assets) or '—'})")
    else:
        print(f"  ассет {name}: {asset['size'] // 1024} KB, digest {asset.get('digest')}")
        if sha and asset.get("digest") and asset["digest"] != f"sha256:{sha}":
            problems.append(f"sha256 манифеста {sha[:16]}… не совпал с ассетом")
        try:
            with get(asset["url"], tok, "HEAD", "application/octet-stream") as r:
                size = int(r.headers.get("content-length") or 0)
                if size != asset["size"]:
                    problems.append(f"HEAD отдал {size} байт вместо {asset['size']}")
                print(f"  ссылка отдаётся: HEAD {r.status}, {size} байт")
        except Exception as e:  # noqa: BLE001
            problems.append(f"ссылка не открывается: {e}")

    if not sha:
        print("  sha256 в манифесте нет (для Windows его не пишем)")

    if problems:
        print("ПРОБЛЕМЫ:")
        for p in problems:
            print("  -", p)
        return 1
    print("  всё сходится")
    return 0


if __name__ == "__main__":
    sys.exit(main())
