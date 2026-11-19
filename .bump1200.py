# -*- coding: utf-8 -*-
import io, json


def sub(p, a, b):
    s = io.open(p, encoding='utf-8').read()
    assert a in s, (p, a[:60])
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s.replace(a, b, 1))


entry = '''## Windows 1.20.0 — шар стал кнопкой

- Кнопка включения — теперь сам глобус: нажал на планету, VPN поднялся,
  нажал ещё раз — опустился. Отдельный кружок с маскотом убран.
- Вокруг шара тонкое кольцо состояния: серое — выключено, пунктир крутится —
  подключаемся, зелёное дышит — работает, красное — блокировка.
- Шар занимает всю высоту блока: пустоты вокруг больше нет, статистика
  подъехала ближе к планете.
- Маскот стал маленьким компаньоном рядом с подписью — планету он не закрывает.
- Потянул шар мышью — он крутится и не считается нажатием; чтобы включить,
  нужен обычный клик.
- Метка страны и ореол вокруг неё меньше, чтобы не залеплять материк под ней.

'''

sub('CHANGELOG.md', '## Windows 1.19.1', entry + '## Windows 1.19.1')
sub('app/src-tauri/tauri.conf.json', '"version": "1.19.1"', '"version": "1.20.0"')
sub('app/package.json', '"version": "1.19.1"', '"version": "1.20.0"')
sub('app/src-tauri/Cargo.toml', 'version = "1.19.1"', 'version = "1.20.0"')
v = json.load(io.open('version.json', encoding='utf-8'))
v['version'] = '1.20.0'
v['url'] = 'https://github.com/Killer4Reals/k4r-neko-vpn/releases/download/v1.20.0/K4R.Neko.VPN_1.20.0_x64-setup.exe'
v['notes'] = 'Глобус-кнопка с кольцом состояния'
io.open('version.json', 'w', encoding='utf-8', newline='\n').write(json.dumps(v, ensure_ascii=False, indent=2) + '\n')
print('windows 1.20.0 ok')
