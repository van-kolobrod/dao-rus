# DAO Rus Core — prototype 0.1

Первый вертикальный срез цифрового ядра ДАО Русь.

Цель этой версии предельно узкая:

**Telegram identity → внутренний Participant → PostgreSQL → `/profile` → журнал событий.**

Архитектурный контекст проекта находится выше по репозиторию:

- `../../docs/ontology/ontology.md`
- `../../docs/architecture/dao-core-v0.1.md`
- `../../legacy/tg-oauth-bridge/` — только историческая справка; новый Core от него не зависит.

## Что уже реализовано

- собственный UUID участника, независимый от Telegram ID;
- связь участника с внешней Telegram identity;
- PostgreSQL как source of truth;
- события `participant.created` и `participant.logged_in`;
- серверные сессии с непрозрачным токеном в HttpOnly cookie;
- Telegram OpenID Connect Authorization Code Flow + PKCE;
- серверная проверка Telegram ID token через JWKS;
- профиль `/profile`;
- изменение `display_name` текущим авторизованным участником;
- страница `/profile/activity` со статистикой за 7 и 30 дней и последними событиями;
- создание простых предложений и список `/proposals`;
- приём сообщений одного разрешённого Telegram-чата через защищённый webhook;
- заглушки для трёх будущих профилей репутации: активность, отзывы, коммуникабельность;
- локальный demo-login, чтобы проверить прототип до настройки BotFather;
- SQL migrations;
- базовые тесты логики create/reuse identity.

## Что намеренно НЕ реализовано

- формулы репутации;
- редакции предложений и решения;
- вече и голосования;
- проекты;
- команды и ответы Telegram-бота;
- AI;
- миграция пользователей Discourse.

## 1. Самый простой локальный запуск: Docker Compose

Нужен Docker Desktop.

В PowerShell из `apps/core`:

```powershell
Copy-Item .env.example .env

docker compose up --build
```

При первом старте контейнер автоматически применит migrations.

Открой:

`http://localhost:3000`

Пока Telegram не настроен, нажми **«Демо-вход для локальной проверки»**. Он работает только при `DEV_AUTH_BYPASS=true` и автоматически отключается при `NODE_ENV=production`.

Остановить:

```powershell
docker compose down
```

Удалить также локальную БД прототипа:

```powershell
docker compose down -v
```

Последнюю команду не выполнять, если данные уже нужны.

## 2. Запуск Next.js локально, PostgreSQL в Docker

Подними только БД:

```powershell
docker compose up -d db
```

Затем:

```powershell
Copy-Item .env.example .env
npm install
npm run db:migrate
npm run dev
```

В `.env` `DATABASE_URL` уже указывает на `localhost:5432`, поэтому такой режим работает без изменения строки подключения.

## 3. Проверки

```powershell
npm test
npm run typecheck
npm run build
```

## 4. Настройка настоящего Telegram Login

Telegram использует стандартный OIDC Authorization Code Flow. Для прототипа используются `openid profile`, PKCE S256 и серверная проверка ID token.

В BotFather для бота, представляющего DAO Rus:

1. Открой настройки **Login Widget**.
2. Зарегистрируй Allowed URL сайта.
3. Зарегистрируй точный callback URL, например:
   `https://core.daorus.org/api/auth/telegram/callback`
4. Получи Client ID и Client Secret.
5. Оставь алгоритм подписи ID token по умолчанию **RS256**.

Заполни на сервере (не в Git):

```env
APP_BASE_URL=https://core.daorus.org
TELEGRAM_OIDC_CLIENT_ID=...
TELEGRAM_OIDC_CLIENT_SECRET=...
TELEGRAM_OIDC_REDIRECT_URI=https://core.daorus.org/api/auth/telegram/callback
DEV_AUTH_BYPASS=false
```

`TELEGRAM_OIDC_CLIENT_SECRET` никогда не должен попадать в браузер, Telegram Mini App или Git.

После изменения `.env` пересоздай контейнер `web`, чтобы Docker Compose передал ему новые значения:

```powershell
docker compose up -d --force-recreate web
```

Для реального Telegram OIDC локальный `localhost` может быть неудобен из-за Allowed URLs. Практический путь — тестовый HTTPS-домен/туннель, зарегистрированный в BotFather.

При тестировании через туннель открывай приложение и начинай Telegram login с того же публичного HTTPS origin, который указан в `APP_BASE_URL`. Если начать flow с `localhost`, host-only cookies с `state` и PKCE verifier останутся на `localhost`, и callback на домене туннеля их не получит.

## 5. Лабораторное подключение Telegram Ingestion v0.1

Поток данных:

`Telegram → HTTPS tunnel → /api/telegram/webhook → telegram.message_created → PostgreSQL`

DAO Core принимает только Bot API updates типа `message` из одного chat ID. Запрос защищён Telegram-заголовком `X-Telegram-Bot-Api-Secret-Token`; сообщения других чатов подтверждаются, но не сохраняются.

После проверки chat ID Core ищет отправителя в `external_identities` по Telegram user ID. Событие создаётся только для уже известного Participant. Сообщение неизвестного Telegram user получает `200 OK`, но его update ID, Telegram user ID, username, текст и другая история не сохраняются. Первый последующий вход такого человека через Telegram OIDC считается активацией профиля в DAO Core, а не повторным вступлением в ДАО.

`message_thread_id` сохраняется независимо и сам по себе не означает Forum Topic: Telegram может прислать его и для обычного message thread. Для различения используются отдельные поля `is_topic_message` и `chat_is_forum`; отсутствие этих optional-признаков в update нормализуется в `false`.

### Подготовка бота и чата

1. Создай отдельного лабораторного бота через BotFather или используй уже созданного бота DAO Rus.
2. Добавь бота в нужную группу/forum.
3. Чтобы бот получал обычные сообщения, сделай его администратором либо отключи Privacy Mode через `/setprivacy`. После отключения Privacy Mode удали и заново добавь бота в группу.
4. До установки webhook отправь в группу сообщение или команду боту и узнай numeric chat ID через `getUpdates`:

```powershell
$botToken = Read-Host "Telegram Bot Token"
(Invoke-RestMethod "https://api.telegram.org/bot$botToken/getUpdates").result |
  ForEach-Object { $_.message.chat.id } |
  Where-Object { $_ } |
  Select-Object -Unique
```

Bot Token нужен только оператору для вызовов Bot API. DAO Core не использует его при приёме webhook, поэтому не добавляй token в `.env`, код или Git.

### Конфигурация DAO Core

Создай случайный secret из разрешённых Telegram символов и заполни серверный `.env`:

```env
APP_BASE_URL=https://your-tunnel.trycloudflare.com
TELEGRAM_WEBHOOK_SECRET=replace-with-a-random-secret
TELEGRAM_INGEST_CHAT_ID=-1001234567890
```

Secret должен содержать 1–256 символов из `A-Z`, `a-z`, `0-9`, `_` и `-`. После изменения `.env` пересоздай `web`; при старте автоматически применится migration:

```powershell
docker compose up -d --force-recreate web
```

### Регистрация webhook

Точный endpoint всегда равен `${APP_BASE_URL}/api/telegram/webhook`. Для tunnel из примера это:

`https://your-tunnel.trycloudflare.com/api/telegram/webhook`

Зарегистрируй webhook, передав тот же secret, который находится в `.env`, и ограничь Telegram updates типом `message`:

```powershell
$webhookUrl = "https://your-tunnel.trycloudflare.com/api/telegram/webhook"
$webhookSecret = Read-Host "TELEGRAM_WEBHOOK_SECRET"

Invoke-RestMethod -Method Post `
  -Uri "https://api.telegram.org/bot$botToken/setWebhook" `
  -Body @{
    url = $webhookUrl
    secret_token = $webhookSecret
    allowed_updates = '["message"]'
  }

Remove-Variable botToken, webhookSecret
```

Quick Tunnel получает новый hostname после перезапуска. При его изменении обнови `APP_BASE_URL`, пересоздай `web` и повторно вызови `setWebhook` с новым URL.

### Проверка PostgreSQL

После сообщения в разрешённой группе:

```powershell
docker compose exec db psql -U dao -d dao -c "SELECT id, event_type, participant_id, payload, created_at FROM events WHERE event_type = 'telegram.message_created' ORDER BY id DESC LIMIT 10;"
```

Повторная доставка того же `update_id` не должна добавлять вторую строку события.

## 6. Модель данных v0.1

### `participants`

Внутренний субъект DAO Core:

- `id` — UUID;
- `display_name`;
- `membership_status`;
- `created_at`.

Новая identity по умолчанию получает статус `candidate`. Это можно изменить через `DEFAULT_MEMBERSHIP_STATUS`, но автоматическое присвоение статуса `participant` лучше вводить только после определения процедуры членства.

### `external_identities`

Связывает Participant с внешним провайдером. Для Telegram хранятся:

- OIDC `sub` как `provider_subject`;
- Telegram user ID;
- username;
- first/last name;
- avatar URL.

В будущем сюда могут добавляться другие identity без изменения внутреннего Participant.

### `events`

Append-oriented журнал значимых событий. Пока:

- `participant.created`;
- `participant.logged_in`;
- `participant.profile_updated`;
- `proposal.created`;
- `telegram.message_created`.

### `telegram_processed_updates`

Минимальный idempotency ledger Telegram webhook. Содержит уникальный `update_id` только для сообщений известных Participant; его создание и запись события происходят в одной транзакции.

### `proposals`

Простые предложения Governance v0.1:

- внутренний UUID;
- автор-Participant;
- заголовок и текст;
- статус `open`;
- дата создания.

### `sessions`

Серверные сессии. В БД хранится SHA-256 hash случайного session token; сам token находится только в HttpOnly cookie браузера.

## 7. Почему старый `tg-oauth-bridge` не используется

Legacy bridge был переходником между старым Telegram Login Widget и OAuth2, который требовался Discourse. DAO Core — собственное приложение, поэтому такой промежуточный OAuth-сервер больше не нужен.

Новый вход использует актуальный Telegram OIDC непосредственно.

## 8. Проверка Activity v0.2

Не расширять приложение сразу.

Сначала убедиться, что:

1. demo-login создаёт Participant;
2. повторный вход использует тот же Participant;
3. `/profile` работает;
4. в `events` появляются `participant.created` и `participant.logged_in`;
5. изменение имени на `/profile` сохраняется после обновления страницы;
6. в `events` появляется `participant.profile_updated`, а событие видно на `/profile/activity`;
7. после этого настроить настоящий Telegram OIDC.

Только затем расширять набор событий активности.

## 9. Проверка Proposal v0.1

1. авторизованный Participant открывает `/proposals`;
2. создаёт предложение с непустыми заголовком и текстом;
3. предложение появляется первым в списке;
4. в `events` появляется `proposal.created` с ID и заголовком предложения;
5. событие отображается на `/profile/activity` и учитывается в статистике активности.
