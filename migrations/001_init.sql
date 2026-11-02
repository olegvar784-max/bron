-- Миграция 001: структура базы данных сервиса «Бронь без конфликтов»
-- Время хранится как TIMESTAMPTZ (однозначный момент, UTC); интерфейс показывает московское время.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Пользователи (существующая система аутентификации: логин + хеш bcrypt)
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    full_name     VARCHAR(100) NOT NULL,
    login         VARCHAR(32)  NOT NULL UNIQUE CHECK (login ~ '^[a-z0-9_.-]{3,32}$'),
    password_hash VARCHAR(72)  NOT NULL,
    role          VARCHAR(10)  NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Ресурсы: аудитории колледжа
CREATE TABLE resources (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(500) NOT NULL DEFAULT '',
    location    VARCHAR(100) NOT NULL,
    capacity    SMALLINT     NOT NULL CHECK (capacity BETWEEN 1 AND 1000),
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Бронирования. Основной статус хранится явно: active / cancelled.
-- «Завершена» вычисляется по времени окончания, фоновое обновление не требуется.
CREATE TABLE bookings (
    id            SERIAL PRIMARY KEY,
    resource_id   INTEGER      NOT NULL REFERENCES resources(id),
    user_id       INTEGER      NOT NULL REFERENCES users(id),
    starts_at     TIMESTAMPTZ  NOT NULL,
    ends_at       TIMESTAMPTZ  NOT NULL,
    purpose       VARCHAR(300) NOT NULL CHECK (char_length(btrim(purpose)) BETWEEN 5 AND 300),
    status        VARCHAR(10)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    cancelled_at  TIMESTAMPTZ,
    cancelled_by  INTEGER      REFERENCES users(id),
    cancel_reason VARCHAR(300),
    CONSTRAINT bookings_time_order CHECK (ends_at > starts_at),
    CONSTRAINT bookings_cancel_info CHECK (
        (status = 'active' AND cancelled_at IS NULL AND cancelled_by IS NULL) OR
        (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)),
    -- Главный инвариант: активные записи одного ресурса не пересекаются.
    -- Полуоткрытый интервал [начало, окончание): соседние 10:00–11:00 и 11:00–12:00 допустимы.
    CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
        resource_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (status = 'active')
);

-- Ключи повторного запроса (Idempotency-Key): одна попытка создания бронирования
CREATE TABLE idempotency_keys (
    user_id      INTEGER     NOT NULL REFERENCES users(id),
    key          VARCHAR(64) NOT NULL,
    request_hash CHAR(64)    NOT NULL,          -- отпечаток нормализованных данных запроса (SHA-256)
    booking_id   INTEGER     REFERENCES bookings(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)                  -- ключ уникален в пределах пользователя
);

-- Аудит: история создания и отмены бронирований, изменения ресурсов
CREATE TABLE audit_events (
    id          BIGSERIAL PRIMARY KEY,
    at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id    INTEGER     REFERENCES users(id),
    action      VARCHAR(40) NOT NULL,           -- booking.create, booking.cancel, resource.create, resource.update ...
    object_type VARCHAR(20) NOT NULL,
    object_id   INTEGER,
    result      VARCHAR(20) NOT NULL,           -- success / rejected
    request_id  UUID        NOT NULL,           -- traceId запроса
    details     JSONB
);

-- Индексы под запросы приложения:
-- «Мои брони»: WHERE user_id = $1 ORDER BY starts_at DESC
CREATE INDEX bookings_user_starts_idx ON bookings (user_id, starts_at DESC);
-- «Занятые интервалы ресурса на дату»: WHERE resource_id = $1 AND status = 'active' AND starts_at < $3 AND ends_at > $2
-- (дополнительно используется GiST-индекс ограничения bookings_no_overlap)
CREATE INDEX bookings_resource_active_idx ON bookings (resource_id, starts_at) WHERE status = 'active';
-- Админ-список всех записей с фильтром по дате: ORDER BY starts_at DESC
CREATE INDEX bookings_starts_idx ON bookings (starts_at DESC);
-- Просмотр аудита: ORDER BY at DESC
CREATE INDEX audit_events_at_idx ON audit_events (at DESC);
