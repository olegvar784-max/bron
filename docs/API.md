# Описание API «Бронь без конфликтов»

Базовый адрес: `http://localhost:8080`. Формат — JSON. Время — ISO 8601 со смещением на входе, UTC на выходе.
Защищённые маршруты требуют заголовок `Authorization: Bearer <JWT>`. Каждому ответу назначается
идентификатор запроса: заголовок ответа `X-Request-Id` и поле `traceId` в ошибках.

## Формат ошибки

```json
{ "error": "overlap", "message": "Ресурс уже занят в выбранное время",
  "traceId": "84c91f43-1996-4fc4-9c68-a0be5817fb0d", "fields": { "endsAt": "..." } }
```

| Код | Когда | `error` |
|---|---|---|
| 400 | неверные поля, неверный JSON, нет `Idempotency-Key` | `validation` (+ `fields`) |
| 401 | нет действительного JWT, истёк срок, неверный пароль | `unauthorized` |
| 403 | административная функция обычным пользователем | `forbidden` |
| 404 | объект не найден или недоступен (чужая запись) | `not_found` |
| 409 | конфликт времени, состояния или ключа | `overlap`, `resource_disabled`, `idempotency_conflict`, `already_cancelled`, `already_started`, `name_taken`, `login_taken` |
| 500 | непредвиденная ошибка; стек, пароль, JWT и строка подключения не возвращаются | `internal` |
| 503 | `/health/ready`: БД недоступна | `not_ready` |

## Аутентификация

| Маршрут | Права | Тело / параметры | Успех | Ошибки |
|---|---|---|---|---|
| `POST /api/auth/login` | все | `{login, password}` | 200 `{token, user:{id, login, fullName, role}}` | 400, 401 |
| `POST /api/auth/register` | все | `{login, password (≥8), fullName}`; роль всегда `user` | 201 `{token, user}` | 400, 409 `login_taken` |

Срок действия JWT — `JWT_TTL` (по умолчанию 2 часа). Выход выполняется на клиенте удалением токена.

## Ресурсы (пользователь и администратор)

| Маршрут | Параметры | Успех | Ошибки |
|---|---|---|---|
| `GET /api/resources` | `q` — часть названия, `location` — точное местоположение | 200 `[{id, name, description, location, capacity, isActive}]`, только активные | 401 |
| `GET /api/resources/locations` | — | 200 `["Корпус 1, этаж 1", …]` | 401 |
| `GET /api/resources/{id}` | — | 200 карточка ресурса | 401, 404 |
| `GET /api/resources/{id}/availability` | `date=ГГГГ-ММ-ДД` (московская дата) | 200 `{date, timezone, busy:[{startsAt, endsAt, mine}]}` — без ФИО и целей других пользователей | 400, 401, 404 |

## Бронирования

| Маршрут | Права | Параметры | Успех | Ошибки |
|---|---|---|---|---|
| `POST /api/bookings` | пользователь, администратор (для себя) | заголовок `Idempotency-Key` (8–64 символа); тело `{resourceId, startsAt, endsAt, purpose}` | 201 новая запись; 200 исходная запись при повторе с тем же ключом и данными | 400, 401, 404, 409 `overlap` / `resource_disabled` / `idempotency_conflict` |
| `GET /api/bookings/my` | владелец | `state`: `upcoming`, `in_progress`, `finished`, `cancelled` | 200 список своих записей | 401 |
| `GET /api/bookings/{id}` | владелец или администратор | — | 200 запись | 401, 404 (чужая) |
| `POST /api/bookings/{id}/cancel` | владелец — своя будущая; администратор — любая будущая | `{reason}` — обязательна (5–300) для администратора при отмене чужой записи | 200 запись со статусом `cancelled` | 400, 401, 404, 409 `already_cancelled` / `already_started` |

Запись в ответе: `id, resourceId, resourceName, location, userId, userLogin, userName, startsAt, endsAt,
purpose, status, createdAt, cancelledAt, cancelReason, cancelledBy, state`. Поле `state` вычисляется по времени: `upcoming`, `in_progress`,
`finished`, `cancelled`. `userId` из тела запроса игнорируется — владелец берётся из JWT.

## Администрирование (только `admin`, иначе 403)

| Маршрут | Параметры | Успех | Ошибки |
|---|---|---|---|
| `GET /api/admin/bookings` | `date` (ГГГГ-ММ-ДД), `resourceId`, `state` | 200 все записи с владельцем (`userLogin`, `userName`) и причиной отмены | 400, 401, 403 |
| `GET /api/admin/resources` | — | 200 все ресурсы, включая отключённые | 401, 403 |
| `POST /api/admin/resources` | `{name (3–100), location, capacity (1–1000), description?}` | 201 ресурс | 400, 401, 403, 409 `name_taken` |
| `PATCH /api/admin/resources/{id}` | любые из полей ресурса и `isActive` (true/false) | 200 ресурс | 400, 401, 403, 404, 409 |
| `GET /api/admin/audit` | `limit` (до 500, по умолчанию 100) | 200 `[{at, actor, action, objectType, objectId, result, requestId, details}]` | 401, 403 |

Отключение ресурса (`isActive: false`) запрещает новые записи; существующие сохраняются.
Удаление ресурсов и записей через API не предусмотрено.

## Проверки работоспособности

| Маршрут | Успех | Ошибка |
|---|---|---|
| `GET /health/live` | 200 `{status:"ok"}` — процесс запущен | — |
| `GET /health/ready` | 200 `{status:"ready"}` — БД отвечает | 503 `{status:"not_ready", message:"База данных недоступна", traceId}` |

## Пример

```bash
TOKEN=$(curl -s -X POST localhost:8080/api/auth/login -H 'Content-Type: application/json' \
  -d '{"login":"ivanov","password":"<пароль>"}' | jq -r .token)
curl -X POST localhost:8080/api/bookings -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" -H 'Content-Type: application/json' \
  -d '{"resourceId":3,"startsAt":"2026-11-03T10:00:00+03:00","endsAt":"2026-11-03T11:00:00+03:00","purpose":"Консультация по курсовому проекту"}'
```
