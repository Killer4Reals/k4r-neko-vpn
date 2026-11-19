# -*- coding: utf-8 -*-
import io, json


def sub(p, a, b):
    s = io.open(p, encoding='utf-8').read()
    assert a in s, (p, a[:60])
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s.replace(a, b, 1))


entry = '''## Windows 1.19.0 — планета по-настоящему

- «Планета» больше не из точек: это шар с настоящей текстурой Земли 4096×2048,
  собранной из Natural Earth 50m. Континенты, острова, Средиземное море и
  Японские острова узнаются в лицо.
- Свет: солнце с бликом на воде, терминатор, тёплая кайма на границе дня и ночи,
  голубая атмосфера по краю диска.
- Ночная сторона светится огнями городов — они собраны по береговой линии.
- Облака плывут чуть быстрее планеты.
- У воды появилась бирюзовая отмель у берегов, у суши — тонкая линия берега и
  рельеф, поэтому материки не выглядят заливкой.
- «Планета» теперь вид по умолчанию; «Неон» остался в настройках.
- Глобус на главной стал крупнее и больше не притушен до 45% прозрачности.

'''

sub('CHANGELOG.md', '## Windows 1.18.0', entry + '## Windows 1.18.0')
sub('app/src-tauri/tauri.conf.json', '"version": "1.18.0"', '"version": "1.19.0"')
sub('app/package.json', '"version": "1.18.0"', '"version": "1.19.0"')
sub('app/src-tauri/Cargo.toml', 'version = "1.18.0"', 'version = "1.19.0"')
v = json.load(io.open('version.json', encoding='utf-8'))
v['version'] = '1.19.0'
v['url'] = 'https://github.com/Killer4Reals/k4r-neko-vpn/releases/download/v1.19.0/K4R.Neko.VPN_1.19.0_x64-setup.exe'
v['notes'] = 'Планета с настоящей текстурой Земли, облака и ночные огни'
io.open('version.json', 'w', encoding='utf-8', newline='\n').write(json.dumps(v, ensure_ascii=False, indent=2) + '\n')
print('windows 1.19.0 ok')
