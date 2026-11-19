# -*- coding: utf-8 -*-
import io, json


def sub(p, a, b):
    s = io.open(p, encoding='utf-8').read()
    assert a in s, (p, a[:60])
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s.replace(a, b, 1))


entry = '''## Windows 1.18.0 — глобус на выбор и спутники

- Белый шар в светлой теме убран: глобус везде тёмный, чтобы не слепил.
- Второй вид на выбор — **«Планета»**: синий океан, материки по биомам
  (тропики зелёные, север песочный, полюса белые), блик солнца и атмосфера.
  Переключатель живёт в настройках, рядом со звуком.
- На орбитах появились два спутника с затухающим следом — чисто украшение.
- Наклон шара ограничен ±18°: страна ближе к центру, полярные ряды точек
  больше не собираются в кольца.
- Глобус можно крутить мышью: потянул — завертелся, отпустил — дальше
  дрейфует сам.

'''

sub('CHANGELOG.md', '## Windows 1.17.1', entry + '## Windows 1.17.1')
sub('app/src-tauri/tauri.conf.json', '"version": "1.17.1"', '"version": "1.18.0"')
sub('app/package.json', '"version": "1.17.1"', '"version": "1.18.0"')
sub('app/src-tauri/Cargo.toml', 'version = "1.17.1"', 'version = "1.18.0"')
v = json.load(io.open('version.json', encoding='utf-8'))
v['version'] = '1.18.0'
v['url'] = 'https://github.com/Killer4Reals/k4r-neko-vpn/releases/download/v1.18.0/K4R.Neko.VPN_1.18.0_x64-setup.exe'
v['notes'] = 'Глобус «Планета», спутники и вращение мышью'
io.open('version.json', 'w', encoding='utf-8', newline='\n').write(json.dumps(v, ensure_ascii=False, indent=2) + '\n')
print('windows 1.18.0 ok')
