# Mascot prompts (for Gemini / Imagen)

Палитра (брать строго эти значения):
- волосы: `#7C3AED` → `#A855F7`, блики `#C084FC`, тени `#5B21B6`
- худи: `#10131A` (ткань), `#1B2230` (складки), кант/швы `#7CFF4D`
- вторичный неон: `#22D3EE`
- кожа: `#F7D7C4`, румянец `#F2A0A0`
- фон: `#0A0A12` → `#1A0B2E`

## STYLE LOCK — вставлять в начало каждого промпта

```
chibi anime character, 2.5 heads tall, thick clean outlines (3px), cel shading with exactly 3 tones per material,
flat colors, no gradients on skin or hair, soft neon rim light only,
purple messy short hair (#7C3AED to #A855F7) with #C084FC highlights,
wolf-cat ears (purple fur outside, cream inner ear), big violet eyes,
dark charcoal hoodie (#10131A) with neon green (#7CFF4D) seams and zipper,
black shorts, black thigh-high socks, chunky black sneakers with neon green soles,
confident friendly expression, centered composition, full body,
background: flat #0A0A12, no text, no watermark, no logo,
consistent character sheet quality, single character only
```

Negative (в конце, если поле есть): `realistic, 3d render, photorealistic, extra fingers, deformed hands, text, watermark, logo, busy background, lens flare, oversaturated gradient blobs, multiple characters, different hair color, different outfit`

---

## 1. idle — «спит на облаке» (экран отключён)

```
[STYLE LOCK]
pose: curled up asleep on a soft rounded cloud, eyes closed, small smile, "Z Z Z" floating glyphs,
cloud colors: pale #E8F4FF with #8CD3FF shadow, outline #4A90C2,
green neon seams dimmed to 40% brightness,
mood: calm, safe, cozy, night
```

## 2. connecting — «включается» (подключение)

```
[STYLE LOCK]
pose: standing, holding a floating holographic panel in both hands, looking at it, focused,
panel shows a circular loading ring made of neon green segments, panel glow #7CFF4D,
three small server nodes orbiting around the panel in cyan #22D3EE,
mood: focused, tech, expectant
```

## 3. connected — «на связи» (активно)

```
[STYLE LOCK]
pose: standing tall, one hand raised making a small thumbs-up, confident grin, eyes half closed in satisfaction,
a thin neon green shield outline emits behind the character (#7CFF4D, 2px, geometric hex pattern),
small tail of green sparks at the feet,
background: flat #0A0A12 with a subtle violet hexagonal grid at 8% opacity
```

## 4. error / offline — «не вышло»

```
[STYLE LOCK]
pose: sitting on the ground, hugging knees, ears drooping, worried eyes, small sweat drop,
cloud behind is grey (#5A6472) and cracked into 3 pieces,
neon seams desaturated to #6B7280, one small cyan spark above the head,
mood: sad but not scary, empathic, "it's fixable"
```

## 5. app icon — 512×512

```
[STYLE LOCK]
composition: close-up head and shoulders, centered, front view, slight 3/4 turn,
thick outline, flat #0A0A12 background, neon green shield glyph formed by the ear silhouette (#7CFF4D),
readable at 32px, high contrast, no text
```

## 6. tray icon states — 4 иконки 32×32

```
minimal flat glyph of the mascot's wolf-cat ear pair only, thick 2px stroke,
idle: #6B7280 outline, connected: #7CFF4D outline, connecting: #22D3EE with 3 dots, error: #F2A0A0 with a slash,
pure transparent background, no text, pixel-perfect at 32px
```

---

## Правила консистентности

1. Один и тот же прикреплённый референс (первое фото с облаком) держать в каждом запросе — иначе лицо «уплывёт».
2. Никакого текста на арте: подписи и реплики рисует интерфейс, а не картинка.
3. Фон всегда плоский `#0A0A12` — так проще вырезать без ореола.
4. Руки: у chibi их рисует ИИ плохо. Если пальцы «поплыли» — перегенерировать, а не ретушировать.
5. Поза в кадре одна: полный рост в 3/4, лицо смотрит в камеру.
