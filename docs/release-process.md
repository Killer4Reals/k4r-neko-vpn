# Чек-лист релиза (Windows и Android)

Один порядок для обеих платформ. Смысл — чтобы сборка, тег и артефакт всегда
соответствовали друг другу, а `version.json` не расходился с APK.

## Windows (`k4r-neko-vpn`)

1. **Код и тесты.** `cargo test --release --manifest-path app/src-tauri/Cargo.toml`,
   в `app/` — `npx tsc --noEmit` и `npx vitest run`.
2. **Bump — отдельным коммитом** `build: 1.8.X`:
   - `app/src-tauri/tauri.conf.json` → `version`
   - `app/package.json` → `version`
   - `app/src-tauri/Cargo.toml` → `version`
   - `version.json` (манифест обновлений: `version`, `url`, `notes`)
3. **CHANGELOG** отдельным коммитом `docs: changelog X`.
4. **Тег** только после зелёных тестов:
   `git tag -a v1.8.X -m "Windows 1.8.X: <одна строка>"` и `git push origin v1.8.X`.
5. **CI** собирает установщик и portable, создаёт **черновик** релиза.
6. **Проверить sha256** ассетов (`gh api .../releases` → `assets[].digest`) и
   `FileVersion` в exe.
7. **Публикация.** Владелец разрешил ассистенту публиковать релизы самому
   (`draft → published`) — но только после зелёного CI и сверки sha256.
   Если релиз делает человек, шаг остаётся ручным.

## Android (`k4r-neko-vpn-android`)

1. **Код и тесты.** `./gradlew testDebugUnitTest`.
2. **Bump — отдельным коммитом** `build: android X.Y.Z`:
   - `app/build.gradle.kts`: `versionCode` (+1) и `versionName`.
3. **CHANGELOG** отдельным коммитом `docs: changelog X`.
4. **Тег**: `git tag -a vX.Y.Z-android -m "<строка, она попадёт в notes манифеста>"`,
   `git push origin vX.Y.Z-android`.
5. **CI** собирает подписанный APK, проверяет сертификат, заливает в **черновик** и
   **сам** пишет `version.json` со sha256 этого APK (коммит `chore: version.json X
   [skip ci]`). Руками манифест не правим: `docs/android-release.md` (репозиторий Android).
6. **Проверить**: `version.json.sha256` == digest ассета; versionCode/versionName в
   APK; сертификат `CN=K4R Neko VPN`.
7. **Публикация.** Ассистент публикует сам по разрешению владельца, человек —
   вручную. До публикации ссылка в манифесте отдаёт 404 (ассеты черновика наружу
   не видны), поэтому публиковать сразу после проверки.

## Чего не делать

- Не смешивать bump версии с фичей или фиксом в одном коммите: по истории должно
  быть видно, где логика, а где сборка.
- Не переиспользовать тег: удалить и поставить заново после фикса, иначе «тег →
  ассет» перестаёт быть однозначным.
- Не заливать в релиз артефакт из локальной сборки (Android sha разойдётся с
  манифестом; Windows-установщик собирает только CI).
- Не публиковать черновик до сверки sha.
