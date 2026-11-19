# -*- coding: utf-8 -*-
import io, json


def sub(p, a, b):
    s = io.open(p, encoding='utf-8').read()
    assert a in s, (p, a[:60])
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s.replace(a, b, 1))


entry = '''## Windows 1.21.0 — дуга подключения и проверка стран

- Кольцо вокруг планеты стало прогрессом: при подключении по нему бежит дуга,
  набирает 85% и ждёт рукопожатия, а на «подключено» закрывается в круг и
  загорается зелёным.
- Добавлены тесты на центрирование: каждая страна из реальной подписки
  (Германия, Нидерланды, Норвегия, Эстония, Швеция, Турция, Казахстан, Япония,
  США, Россия, Бразилия, Австралия, ЮАР, Сингапур) после доворота встаёт ровно
  в центр диска и оказывается на передней стороне шара.

'''

sub('CHANGELOG.md', '## Windows 1.20.0', entry + '## Windows 1.20.0')
sub('app/src-tauri/tauri.conf.json', '"version": "1.20.0"', '"version": "1.21.0"')
sub('app/package.json', '"version": "1.20.0"', '"version": "1.21.0"')
sub('app/src-tauri/Cargo.toml', 'version = "1.20.0"', 'version = "1.21.0"')
v = json.load(io.open('version.json', encoding='utf-8'))
v['version'] = '1.21.0'
v['url'] = 'https://github.com/Killer4Reals/k4r-neko-vpn/releases/download/v1.21.0/K4R.Neko.VPN_1.21.0_x64-setup.exe'
v['notes'] = 'Дуга подключения на кольце глобуса'
io.open('version.json', 'w', encoding='utf-8', newline='\n').write(json.dumps(v, ensure_ascii=False, indent=2) + '\n')
print('windows 1.21.0 ok')
