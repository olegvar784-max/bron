# Резервное копирование и восстановление

Требования: PostgreSQL 16 (клиентские утилиты `pg_dump`, `pg_restore`, `createdb` той же или более
новой версии, чем сервер), Node.js 22. Пароль БД передаётся через переменную `PGPASSWORD` или файл
`~/.pgpass` и в инструкцию не записывается.

## 1. Контрольная запись

Перед копированием создайте будущее бронирование и запишите его номер (при проверке 02.11.2026 —
запись №20: Ауд. 204, 03.11.2026 16:00–17:00, владелец `ivanov`).

```bash
psql -U postgres -h localhost -d bron -c "SELECT id, resource_id, starts_at, status FROM bookings WHERE id = 20;"
psql -U postgres -h localhost -d bron -tAc "SELECT count(*) FROM bookings"      # 16
```

## 2. Резервная копия

```bash
pg_dump -U postgres -h localhost -Fc -d bron -f backup/bron_$(date +%Y%m%d_%H%M).dump
```

Формат `custom` (`-Fc`) сжат и восстанавливается выборочно через `pg_restore`.
Папка `backup/` исключена из Git (`.gitignore`). Копия хранится вне репозитория: на отдельном диске
или в закрытом хранилище с доступом только у администратора; рекомендуется хранить не менее
7 последних ежедневных копий.

## 3. Восстановление в отдельную тестовую базу

Рабочая база `bron` не удаляется.

```bash
createdb -U postgres -h localhost bron_restore
pg_restore -U postgres -h localhost -d bron_restore --no-owner backup/bron_20261102_1723.dump
psql -U postgres -h localhost -d bron_restore -tAc "SELECT count(*) FROM bookings"   # 16
```

## 4. Проверка через приложение

```bash
DB_NAME=bron_restore PORT=8081 npm start          # тестовый экземпляр
curl -s http://localhost:8081/health/ready          # {"status":"ready"}
```

Проверено 02.11.2026:

| Проверка | Результат |
|---|---|
| Готовность сервиса | `{"status":"ready"}` |
| Вход `ivanov` | токен получен |
| Ресурсы | 6 активных аудиторий, включая добавленную «Ауд. 112» |
| Контрольная запись №20 | найдена: Ауд. 204, 13:00–14:00 UTC (16:00–17:00 МСК), `active` |
| Ограничение пересечений | бронирование 16:30–17:30 на Ауд. 204 → 409 «Ресурс уже занят в выбранное время» |
| Ограничение в схеме | `bookings_no_overlap`, тип `x` (EXCLUDE) присутствует |

После проверки тестовый экземпляр останавливается, база `bron_restore` удаляется при необходимости:
`dropdb -U postgres -h localhost bron_restore`.
