# Android «Сияй! Мия»

Приложение открывает `https://marinavoronka-dev.github.io/siyai/` внутри Android WebView.
Нужны Android 6.0+, интернет и актуальный Android System WebView. Прогресс хранится в данных приложения, отдельно от браузера. Удаление приложения или очистка его данных удаляет локальные отметки.

## Скачать

[APK 1.1 с постоянной подписью](../dist/download/Siyai-Mia.apk). Перед использованием убедитесь, что GitHub Pages опубликован. Сборка и подпись проверены; тест на физическом телефоне не проводился.

## Автоматическая сборка

Actions → Android APK → Run workflow.
Режим `debug` работает без секретов. APK находится в артефакте `Siyai-Mia-debug` на странице успешного запуска. Тестовый ключ на чистом runner создаётся заново: такие APK могут требовать удаления предыдущей тестовой версии с потерей её локальных данных. Debug-сборка не обновляет опубликованную версию с постоянным ключом.

Режим `release` требует Repository Secrets:
- `ANDROID_KEYSTORE_BASE64`: постоянный ключ подписи в base64.
- `ANDROID_STORE_PASSWORD`: пароль хранилища.
- `ANDROID_KEY_PASSWORD`: пароль ключа.
- `ANDROID_KEY_ALIAS`: alias ключа.

Ключ и пароли не хранятся в Git. Для обновления используйте тот же ключ и увеличивайте `versionCode` в AndroidManifest.xml. Workflow сам не заменяет APK в `dist/download`: публикация файла выполняется отдельно после проверки.

## Локальная сборка (PowerShell 7)

Нужны JDK 17, Android Build Tools 35.0.0 и SDK Platform API 35.
```powershell
./android/build.ps1 -JavaHome 'C:/tools/jdk-17' -BuildTools 'C:/Android/build-tools/35.0.0' -AndroidJar 'C:/Android/platforms/android-35/android.jar'
```
Для release задайте переменные среды `SIYAI_KEYSTORE_PATH`, `SIYAI_STORE_PASSWORD`, `SIYAI_KEY_PASSWORD`, `SIYAI_KEY_ALIAS` и передайте `-SigningMode release`. Не добавляйте ключи в коммиты.

Внешние ссылки открываются в браузере или другом приложении. Для сохранения файлов blob/data используйте меню «Открыть в браузере»; состояние браузера отдельное. Камера и микрофон приложению не нужны.
