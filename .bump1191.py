# -*- coding: utf-8 -*-
import io, json


def sub(p, a, b):
    s = io.open(p, encoding='utf-8').read()
    assert a in s, (p, a[:60])
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s.replace(a, b, 1))


entry = '''## Windows 1.19.1 — шар и маскот разъехались

- Маскот больше не сидит на планете: глобус слева, кнопка включения справа.
  Каждому свой угол, ничего не перекрывается.
- Страна встаёт ровно в центр диска — доворот по широте стал полным, а не
  урезанным до ±18°.
- Глобус сам подстраивается под ширину окна: на 1200 px он большой, на 900 px
  уменьшается, кнопка тоже поджимается, подпись сервера переносится.
- Свет мягче и ближе к зрителю, тёмная сторона больше не съедает полшара.

'''

sub('CHANGELOG.md', '## Windows 1.19.0', entry + '## Windows 1.19.0')
sub('app/src-tauri/tauri.conf.json', '"version": "1.19.0"', '"version": "1.19.1"')
sub('app/package.json', '"version": "1.19.0"', '"version": "1.19.1"')
sub('app/src-tauri/Cargo.toml', 'version = "1.19.0"', 'version = "1.19.1"')
v = json.load(io.open('version.json', encoding='utf-8'))
v['version'] = '1.19.1'
v['url'] = 'https://github.com/Killer4Reals/k4r-neko-vpn/releases/download/v1.19.1/K4R.Neko.VPN_1.19.1_x64-setup.exe'
v['notes'] = 'Планета слева, кнопка справа — больше никаких наложений'
io.open('version.json', 'w', encoding='utf-8', newline='\n').write(json.dumps(v, ensure_ascii=False, indent=2) + '\n')
print('windows 1.19.1 ok')
