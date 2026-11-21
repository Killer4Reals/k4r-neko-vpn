# Снимки экранов для проверки вида

`set-theme.html` — служебная страница: ставит в `localStorage` тему и вид шара и
уводит на главную. Нужна, чтобы делать снимки одного и того же экрана в разных
темах без ручных кликов.

```bash
cd app && npx vite build && npx vite preview --port 4173 --strictPort &
cp ../tools/screens/set-theme.html dist/
chrome --headless=new --enable-unsafe-swiftshader --window-size=1100,900 \
  --hide-scrollbars --virtual-time-budget=9000 \
  --screenshot=shot.png "http://127.0.0.1:4173/set-theme.html?t=light&go=1"
```

`t` — `dark` | `light` | `mascot`, `g` — `planet` | `neon`. Копируется в `dist/`
только на время снимков: в приложение этот файл не попадает.

## Снимок настоящего окна (`live-shot.py`)

Скриншоты из браузера показывают вёрстку, но не сам клиент. `live-shot.py`
запускает собранный `K4R Neko VPN.exe`, снимает его окно через
`PrintWindow(PW_RENDERFULLCONTENT)` и закрывает. Окно при этом не выходит на
передний план и не забирает фокус — можно проверять клиент, пока за машиной
работает что-то ещё.

```
python -X utf8 tools/screens/live-shot.py
```

Путь к exe и папку для снимков правьте в начале файла. Клик по элементам так
не сделать (нужен фокус), поэтому навигацию проверяйте в браузерной сборке, а
здесь — что приложение вообще стартует и рисует главный экран без прав
администратора, с плашкой и живым глобусом.
