#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Xray-клиент из подписки провайдера: один JSON на каждый выбранный узел.

Читает массив конфигов (как их отдаёт панель с заголовком X-HWID) и пишет
конфиги для контейнера: SOCKS внутри, VLESS/Reality наружу. Ключи остаются
локально — в репозиторий их класть нельзя.

    python tools/tunnel-check/mk-configs.py sub.json de nl us jp

Результат: out/xray-<cc><n>.json
"""
import io
import json
import os
import sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")


def nodes(payload):
    for cfg in payload:
        for ob in cfg.get("outbounds") or []:
            if ob.get("protocol") != "vless":
                continue
            vnext = (ob.get("settings") or {}).get("vnext") or []
            if not vnext:
                continue
            v = vnext[0]
            user = (v.get("users") or [{}])[0]
            if not user.get("id") or not v.get("address"):
                continue
            stream = ob.get("streamSettings") or {}
            reality = stream.get("realitySettings") or {}
            yield {
                "host": v.get("address"),
                "port": v.get("port") or 443,
                "uuid": user.get("id"),
                "flow": user.get("flow") or "",
                "network": stream.get("network") or "tcp",
                "security": stream.get("security") or "none",
                "sni": reality.get("serverName") or "",
                "pbk": reality.get("publicKey") or "",
                "sid": reality.get("shortId") or "",
                "fp": reality.get("fingerprint") or "chrome",
            }


def to_config(node):
    stream = {"network": node["network"], "security": node["security"]}
    if node["security"] == "reality":
        stream["realitySettings"] = {
            "serverName": node["sni"],
            "publicKey": node["pbk"],
            "shortId": node["sid"],
            "fingerprint": node["fp"],
        }
    if node["network"] == "tcp":
        stream["tcpSettings"] = {"header": {"type": "none"}}
    user = {"id": node["uuid"], "encryption": "none"}
    if node["flow"]:
        user["flow"] = node["flow"]
    return {
        "log": {"loglevel": "warning"},
        "inbounds": [
            {
                "tag": "socks",
                "listen": "0.0.0.0",
                "port": 1080,
                "protocol": "socks",
                "settings": {"udp": True, "auth": "noauth"},
            }
        ],
        "outbounds": [
            {
                "tag": "proxy",
                "protocol": "vless",
                "settings": {"vnext": [{"address": node["host"], "port": node["port"], "users": [user]}]},
                "streamSettings": stream,
            },
            {"tag": "direct", "protocol": "freedom"},
        ],
    }


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    payload = json.load(io.open(sys.argv[1], encoding="utf-8"))
    want = [a.lower() for a in sys.argv[2:]] or ["de"]
    pools = {}
    for n in nodes(payload):
        pools.setdefault((n["host"] or "")[:2].lower(), []).append(n)

    os.makedirs(OUT, exist_ok=True)
    made = 0
    for key in want:
        cc = key[:2]
        pool = pools.get(cc) or []
        if not pool:
            print(f"нет узла для «{cc}» — в подписке есть: {', '.join(sorted(pools))}")
            continue
        node = pool[0]
        path = os.path.join(OUT, f"xray-{cc}{made + 1}.json")
        io.open(path, "w", encoding="utf-8", newline="\n").write(
            json.dumps(to_config(node), ensure_ascii=False, indent=2)
        )
        made += 1
        print(f"{path}: {node['host']}:{node['port']} {node['security']}/{node['network']}")
    return 0 if made else 1


if __name__ == "__main__":
    raise SystemExit(main())
