# K4R Neko VPN — промпты маскота (полный пакет)

Собрано на основе `Промпты.txt` и `Промпты_K4R_Apps.txt`, приведено к одному стилю.
Генерация: Gemini / Imagen. Фон везде плоский малиновый `#FF00FF` — вырезаем по цвету.
**На картинке текста нет** — названия и статусы пишет интерфейс.

## [BASE] — вставлять в каждый промпт

```
cute chibi anime girl, vibrant purple hair (#8A2BE2), fluffy cat ears, large expressive
purple eyes with a soft neon glow, confident slightly mischievous smile, wearing a
futuristic cyberpunk tech hoodie (dark fabric #0D0D15 with neon green #39FF14 glowing
accents on the hood, laces, cuffs, belt and chunky sneakers), smooth 2D anime
illustration, clean vector lines, highly detailed, consistent character design
```

## Negative (если модель поддерживает)

```
text, watermark, logo, letters, signature, checkerboard, gradient background, multiple
characters, extra fingers, deformed hands, blurry, low quality, realistic, 3d render,
photorealistic, frame border, drop shadow
```

## Параметры генерации

- 2–4 варианта на промпт, выбирать лучший.
- Прикреплять референс (сгенерированный сон на облаке) в каждый запрос — иначе лицо уплывёт.
- Аватар/иконки — 1:1, баннеры — 16:9, боковая поза — 3:4.
- После генерации: удалить малиновый фон → PNG с альфой.

---

# 1. Главная иконка приложения (512×512, 1:1)

```
App icon, perfect square 1:1 composition. [BASE]. Head-and-shoulders close-up,
front view, slight 3/4 turn, centered. She holds a small glowing neon-green
holographic shield up near her shoulder. Thick readable silhouette, high contrast,
works at 32px. Background: SOLID FLAT PURE MAGENTA COLOR (#FF00FF), RGB 255 0 255,
absolutely no checkerboard, no gradients, no shadows, no pattern. NO TEXT, NO WATERMARKS.
```

# 2. Иконка-глиф для трея (для маленьких размеров)

```
Minimal flat glyph icon, perfect square 1:1. Simple silhouette of a cat-ear pair
merged with a shield outline, thick 3px stroke, single neon green color #39FF14,
no fill details, no face. Centered, generous margins, pixel-crisp at 32px.
Background: SOLID FLAT PURE MAGENTA COLOR (#FF00FF), RGB 255 0 255, no gradients,
no shadows, no pattern. NO TEXT.
```

Состояния — тем же промптом, меняя только цвет глифа:
`серая #6B7280 (выключено)`, `зелёная #39FF14 (подключено)`, `голубая #22D3EE (подключение)`, `розовая #F2A0A0 (ошибка)`.

# 3. Экран «Выключено» — спит на облаке (1:1, полный рост)

```
Perfect square 1:1 composition. [BASE]. She is curled up and sleeping peacefully on
a small fluffy cloud, eyes closed, gentle smile, tiny "Zzz" above her head, ears
relaxed. Cloud: pale #E8F4FF with soft #8CD3FF shadow. Neon green accents dimmed.
Background: SOLID FLAT PURE MAGENTA COLOR (#FF00FF), RGB 255 0 255, absolutely no
checkerboard, no gradients, no shadows, no pattern. Character fully visible in center
with margins. NO TEXT, NO WATERMARKS.
```

# 4. Экран «Подключение» — держит голограмму (1:1)

```
Perfect square 1:1 composition. [BASE]. She stands, holding a floating holographic
panel in both hands and looking at it with focused expression. The panel shows a
circular loading ring made of neon green segments, three small server nodes orbit
around it in cyan #22D3EE. Background: SOLID FLAT PURE MAGENTA COLOR (#FF00FF),
RGB 255 0 255, absolutely no checkerboard, no gradients, no shadows, no pattern.
Character fully visible in center with margins. NO TEXT, NO WATERMARKS.
```

# 5. Экран «Подключено» — щит (1:1)

```
Perfect square 1:1 composition. [BASE]. She stands proudly holding a large glowing
neon-green holographic shield in front of her, data cracks and lightning bouncing
off the shield, confident smile, one ear flicked. Background: SOLID FLAT PURE
MAGENTA COLOR (#FF00FF), RGB 255 0 255, absolutely no checkerboard, no gradients,
no shadows, no pattern. Character fully visible in center with margins.
NO TEXT, NO WATERMARKS.
```

# 6. Экран «Ошибка» (1:1)

```
Perfect square 1:1 composition. [BASE]. She sits on the ground hugging her knees,
ears drooping, worried eyes, one small sweat drop, a grey cracked cloud (#5A6472)
broken into three pieces behind her, neon accents desaturated. Sad but not scary —
the "we can fix this" kind of sad. Background: SOLID FLAT PURE MAGENTA COLOR
(#FF00FF), RGB 255 0 255, absolutely no checkerboard, no gradients, no shadows,
no pattern. Character fully visible in center with margins. NO TEXT, NO WATERMARKS.
```

# 7. Баннер приветствия / онбординг (16:9)

```
Wide horizontal banner, 16:9 aspect ratio. [BASE]. She stands confidently at the
right third of the frame with a calm dynamic pose, holding her holographic shield,
leaving empty space on the left for interface text. Faint neon purple and green
circuit lines behind her. Background: SOLID FLAT PURE MAGENTA COLOR (#FF00FF),
RGB 255 0 255, absolutely no checkerboard, no gradients, no shadows, no pattern.
She is fully visible with clean margins. NO TEXT, NO WATERMARKS.
```

# 8. Аватар для шапки / профиля (1:1, поясной)

```
Perfect square 1:1 composition. [BASE]. Head-and-shoulders bust portrait, centered,
eyes looking at the viewer, soft confident expression. Background: SOLID FLAT PURE
MAGENTA COLOR (#FF00FF), RGB 255 0 255, absolutely no checkerboard, no gradients,
no shadows, no pattern. Character fully visible with clean margins. NO TEXT.
```

# 9. Маскот выглядывает сбоку (3:4, для навигации)

```
Vertical 3:4 composition. [BASE]. She peeks out from the right edge of the frame —
only head, shoulder, one hand and one ear visible, waving slightly, playful grin,
body cropped by the frame edge. Background: SOLID FLAT PURE MAGENTA COLOR (#FF00FF),
RGB 255 0 255, absolutely no checkerboard, no gradients, no shadows, no pattern.
NO TEXT, NO WATERMARKS.
```

# 10. Фон окна — бесшовная текстура

```
Seamless dark tileable background texture. Deep near-black base #0D0D15, very faint
low-opacity silhouette of the same chibi girl with purple hair and cat ears in the
center, around her subtle neon green #39FF14 and purple #8A2BE2 geometric circuit
lines, tiny glowing dots. Cyberpunk, very dark, unobtrusive, text must stay readable
on top. Flat design, seamless tile, high resolution. NO TEXT, NO WATERMARKS.
```

# 11. Пустое состояние «нет серверов»

```
Perfect square 1:1 composition. [BASE]. She stands holding an empty open cardboard
box, looking into it with a puzzled raised eyebrow, one ear tilted. Minimal, lots of
empty space around, small cheerful mood. Background: SOLID FLAT PURE MAGENTA COLOR
(#FF00FF), RGB 255 0 255, absolutely no checkerboard, no gradients, no shadows,
no pattern. Character fully visible in center with margins. NO TEXT, NO WATERMARKS.
```

# 12. Плитка установщика Windows (16:9, тёмная, без малинового)

```
Wide 16:9 installer banner. [BASE]. Full body, standing at the right side, holding
the neon green holographic shield, confident smile. Background: dark gradient-free
flat #0D0D15 with thin neon-green circuit lines fading to the left, empty space on
the left third. No text, no watermark, clean vector look.
```
