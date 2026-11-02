# Диагностика

## Журналы

| Журнал | Где | Что содержит |
|---|---|---|
| Технический | `logs/app.log` (путь задаётся `LOG_FILE`), дублируется в stdout | JSON-строки: `time`, `level`, `event`, `traceId`, метод, путь, статус, `userId`, время обработки; ошибки API (`api_error`); отказы доступа 401/403 (`access_denied`); непредвиденные ошибки (`level: error`) со стеком |
| Аудит | таблица `audit_events`, раздел «Администрирование → Аудит», `GET /api/admin/audit` | создание и отмена бронирований (успешные и отклонённые), создание, изменение, отключение и включение ресурсов: время, исполнитель, действие, объект, результат, traceId |

Пароли, JWT, заголовок `Authorization` и параметры подключения к БД в журналы не записываются.

## Ошибка по traceId

Каждый ответ содержит заголовок `X-Request-Id`, ответ об ошибке — поле `traceId`. В интерфейсе он
показывается как «код для поддержки».

```bash
grep 84c91f43-1996-4fc4-9c68-a0be5817fb0d logs/app.log
psql -d bron -c "SELECT at, action, result, details FROM audit_events WHERE request_id = '84c91f43-1996-4fc4-9c68-a0be5817fb0d';"
```

## Готовность и БД

```bash
curl -s localhost:8080/health/live     # 200 {"status":"ok"} — процесс работает
curl -s localhost:8080/health/ready    # 200 {"status":"ready"} или 503 {"status":"not_ready"} — БД недоступна
pg_isready -h localhost -p 5432        # доступность PostgreSQL
psql -d bron -c "SELECT name, applied_at FROM schema_migrations;"           # применённые миграции
psql -d bron -c "SELECT count(*) FROM bookings WHERE status = 'active';"   # состояние данных
```

Порядок действий при отказе: `/health/live` → если 200, `/health/ready` → если 503, `pg_isready` и
настройки `DB_*` → поиск последних `level":"error"` в `logs/app.log` по traceId из ответа.
