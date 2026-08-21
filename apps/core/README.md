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
- заглушки для трёх будущих профилей репутации: активность, отзывы, коммуникабельность;
- локальный demo-login, чтобы проверить прототип до настройки BotFather;
- SQL migrations;
- базовые тесты логики create/reuse identity.

## Что намеренно НЕ реализовано

- формулы репутации;
- редакции предложений и решения;
- вече и голосования;
- проекты;
- Telegram-бот;
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

## 5. Модель данных v0.1

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
- `proposal.created`.

### `proposals`

Простые предложения Governance v0.1:

- внутренний UUID;
- автор-Participant;
- заголовок и текст;
- статус `open`;
- дата создания.

### `sessions`

Серверные сессии. В БД хранится SHA-256 hash случайного session token; сам token находится только в HttpOnly cookie браузера.

## 6. Почему старый `tg-oauth-bridge` не используется

Legacy bridge был переходником между старым Telegram Login Widget и OAuth2, который требовался Discourse. DAO Core — собственное приложение, поэтому такой промежуточный OAuth-сервер больше не нужен.

Новый вход использует актуальный Telegram OIDC непосредственно.

## 7. Проверка Activity v0.2

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

## 8. Проверка Proposal v0.1

1. авторизованный Participant открывает `/proposals`;
2. создаёт предложение с непустыми заголовком и текстом;
3. предложение появляется первым в списке;
4. в `events` появляется `proposal.created` с ID и заголовком предложения;
5. событие отображается на `/profile/activity` и учитывается в статистике активности.
