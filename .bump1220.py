# -*- coding: utf-8 -*-
import io
import json


def sub(p, a, b):
    s = io.open(p, encoding='utf-8').read()
    assert a in s, (p, a[:60])
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s.replace(a, b, 1))


entry = '''## Windows 1.22.0 — подписки с HWID и настоящий рельеф Земли

- Поддержка подписок с привязкой по устройству (Happ, Remnawave и их форки):
  приложение отправляет ID устройства и модель, поэтому провайдер отдаёт
  настоящий список серверов вместо заглушки «приложение не поддерживается».
- Если слоты кончились, приложение говорит словами провайдера: «лимит устройств
  исчерпан», а не «нет серверов». В настройках теперь виден ID устройства и есть
  кнопка «Новый ID» — она освобождает старый слот в кабинете провайдера.
- Серверы из подписки получают своё имя: «🇩🇪 Германия», «🇯🇵 Япония» вместо
  десяти одинаковых «🇪🇺 Fastest». Один и тот же узел больше не дублируется —
  в реальной подписке было 93 строки, осталось 15 живых серверов.
- Земля стала объёмной: карта рельефа (normal map) с горами и плоскогорьями,
  свет ложится на склоны, у воды блик, облака бросают тень на материки.
- Полярные шапки сглажены: у полюсов текстура больше не растягивается в лучи.

'''

sub('CHANGELOG.md', '## Windows 1.21.0', entry + '## Windows 1.21.0')
sub('app/src-tauri/tauri.conf.json', '"version": "1.21.0"', '"version": "1.22.0"')
sub('app/package.json', '"version": "1.21.0"', '"version": "1.22.0"')
sub('app/src-tauri/Cargo.toml', 'version = "1.21.0"', 'version = "1.22.0"')
v = json.load(io.open('version.json', encoding='utf-8'))
v['version'] = '1.22.0'
v['url'] = (
    'https://github.com/Killer4Reals/k4r-neko-vpn/releases/download/v1.22.0/'
    'K4R.Neko.VPN_1.22.0_x64-setup.exe'
)
v['notes'] = 'Подписки с HWID и объёмный рельеф Земли'
io.open('version.json', 'w', encoding='utf-8', newline='\n').write(
    json.dumps(v, ensure_ascii=False, indent=2) + '\n'
)
print('windows 1.22.0 ok')
