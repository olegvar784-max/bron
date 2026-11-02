// Воспроизводимое создание учебных данных: 3 пользователя, 6 ресурсов, записи во всех состояниях.
// Пароль демонстрационных учётных записей берётся из SEED_PASSWORD и в репозиторий не попадает.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
require('../src/config');
const { pool } = require('../src/db');

// момент «через offset суток в hh:mm по Москве»
function mskAt(offsetDays, hh, mm = 0) {
  const msk = new Date(Date.now() + 3 * 3600e3 + offsetDays * 864e5);
  const day = msk.toISOString().slice(0, 10);
  return new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+03:00`).toISOString();
}

(async () => {
  let password = process.env.SEED_PASSWORD;
  if (!password) {
    password = crypto.randomBytes(9).toString('base64url');
    console.log(`SEED_PASSWORD не задан, сгенерирован пароль для демонстрационных учётных записей: ${password}`);
  }
  const hash = await bcrypt.hash(password, 10);

  await pool.query('TRUNCATE audit_events, idempotency_keys, bookings, resources, users RESTART IDENTITY CASCADE');
  await pool.query(`INSERT INTO users (full_name, login, password_hash, role) VALUES
    ('Иванов Сергей', 'ivanov', $1, 'user'),
    ('Петрова Анна', 'petrova', $1, 'user'),
    ('Администратор', 'admin', $1, 'admin')`, [hash]);
  await pool.query(`INSERT INTO resources (name, description, location, capacity, is_active) VALUES
    ('Ауд. 101', 'Лекционная аудитория, проектор, микрофон', 'Корпус 1, этаж 1', 80, true),
    ('Ауд. 204', 'Компьютерный класс, 20 рабочих мест, Windows и Linux', 'Корпус 1, этаж 2', 20, true),
    ('Ауд. 305', 'Компьютерный класс, 24 рабочих места, интерактивная доска', 'Корпус 1, этаж 3', 24, true),
    ('Переговорная «Нева»', 'Переговорная на 10 человек, экран для презентаций', 'Корпус 2, этаж 1', 10, true),
    ('Лаборатория сетей', 'Стенды Cisco и MikroTik для практических работ', 'Корпус 2, этаж 3', 16, true),
    ('Актовый зал', 'Зал для мероприятий, сцена и звуковое оборудование', 'Корпус 2, этаж 1', 200, false)`);
  // записи в разных состояниях (вставка напрямую, минуя API: история нужна и в прошлом)
  await pool.query(`INSERT INTO bookings (resource_id, user_id, starts_at, ends_at, purpose, status, cancelled_at, cancelled_by, cancel_reason) VALUES
    (2, 1, $1, $2, 'Консультация по курсовому проекту', 'active', NULL, NULL, NULL),
    (1, 2, $3, $4, 'Лекция для первого курса', 'active', NULL, NULL, NULL),
    (4, 1, $5, $6, 'Встреча проектной группы', 'active', NULL, NULL, NULL),
    (3, 2, $7, $8, 'Подготовка к экзамену', 'cancelled', now(), 2, NULL),
    (5, 1, $9, $10, 'Лабораторная работа по маршрутизации', 'active', NULL, NULL, NULL)`,
  [mskAt(-1, 14), mskAt(-1, 15, 30), mskAt(1, 9), mskAt(1, 10, 30), mskAt(2, 12), mskAt(2, 13),
    mskAt(3, 10), mskAt(3, 11), new Date(Date.now() - 10 * 60e3).toISOString(), new Date(Date.now() + 50 * 60e3).toISOString()]);
  console.log('Учебные данные загружены: пользователи ivanov, petrova, admin; 6 ресурсов (1 отключён);');
  console.log('записи: завершённая, будущие активные, отменённая и начавшаяся (идёт сейчас).');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
