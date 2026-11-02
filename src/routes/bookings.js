const express = require('express');
const crypto = require('crypto');
const { pool, tx } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { bad, notFound, conflict } = require('../lib/errors');
const { validateInterval } = require('../lib/time');
const { audit } = require('../lib/audit');

const router = express.Router();
router.use(requireAuth);
require('../lib/params')(router);

// Поля ответа. Состояние «завершена» / «идёт» вычисляется по времени, в БД хранится только active/cancelled.
const COLS = `b.id, b.resource_id AS "resourceId", r.name AS "resourceName", r.location,
  b.user_id AS "userId", u.login AS "userLogin", u.full_name AS "userName",
  b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.purpose, b.status, b.created_at AS "createdAt",
  b.cancelled_at AS "cancelledAt", b.cancel_reason AS "cancelReason", cu.login AS "cancelledBy",
  CASE WHEN b.status = 'cancelled' THEN 'cancelled'
       WHEN b.ends_at <= now() THEN 'finished'
       WHEN b.starts_at <= now() THEN 'in_progress'
       ELSE 'upcoming' END AS state`;
const FROM = `FROM bookings b JOIN resources r ON r.id = b.resource_id JOIN users u ON u.id = b.user_id
  LEFT JOIN users cu ON cu.id = b.cancelled_by`;

const STATE_FILTER = {
  upcoming: `b.status = 'active' AND b.starts_at > now()`,
  in_progress: `b.status = 'active' AND b.starts_at <= now() AND b.ends_at > now()`,
  finished: `b.status = 'active' AND b.ends_at <= now()`,
  cancelled: `b.status = 'cancelled'`
};

async function findById(db, id) {
  const { rows } = await db.query(`SELECT ${COLS} ${FROM} WHERE b.id = $1`, [id]);
  return rows[0];
}

// нормализованные данные запроса и их отпечаток для ключа повторного запроса
function normalize(body) {
  return {
    resourceId: Number(body.resourceId),
    startsAt: new Date(body.startsAt).toISOString(),
    endsAt: new Date(body.endsAt).toISOString(),
    purpose: String(body.purpose).trim()
  };
}
const fingerprint = (n) => crypto.createHash('sha256').update(JSON.stringify(n)).digest('hex');

// POST /api/bookings — создание записи для текущего пользователя
router.post('/', async (req, res) => {
  const key = req.get('Idempotency-Key');
  if (!key || !/^[A-Za-z0-9_-]{8,64}$/.test(key)) {
    throw bad('Нужен заголовок Idempotency-Key: 8–64 символа (латиница, цифры, _ -)');
  }
  const body = req.body || {};
  const fields = validateInterval(body.startsAt, body.endsAt) || {};
  if (!Number.isInteger(Number(body.resourceId)) || Number(body.resourceId) < 1) fields.resourceId = 'Выберите ресурс';
  const purpose = typeof body.purpose === 'string' ? body.purpose.trim() : '';
  if (purpose.length < 5 || purpose.length > 300) fields.purpose = 'Цель — от 5 до 300 символов';
  if (Object.keys(fields).length) throw bad('Проверьте поля формы', fields);

  const data = normalize(body);
  const hash = fingerprint(data);
  const userId = req.user.id; // владелец — только из проверенного JWT; userId из тела игнорируется

  try {
    const booking = await tx(async (db) => {
      // 1. Ключ повторного запроса: уникальность (user_id, key) обеспечивает БД.
      //    Конкурентный повтор с тем же ключом ждёт завершения этой транзакции.
      const k = await db.query(
        `INSERT INTO idempotency_keys (user_id, key, request_hash) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, key) DO NOTHING RETURNING key`, [userId, key, hash]);
      if (!k.rowCount) return null; // ключ уже использован — обработка ниже, вне транзакции

      // 2. Блокировка строки ресурса (FOR SHARE) согласует создание записи с отключением ресурса:
      //    PATCH ресурса берёт FOR UPDATE на ту же строку, порядок блокировок одинаков — ресурс первым.
      const r = await db.query('SELECT id, is_active FROM resources WHERE id = $1 FOR SHARE', [data.resourceId]);
      if (!r.rowCount) throw notFound('Ресурс не найден');
      if (!r.rows[0].is_active) throw conflict('resource_disabled', 'Ресурс отключён для новых бронирований');

      // 3. Вставка. Пересечение исключает ограничение bookings_no_overlap (EXCLUDE USING gist):
      //    оно проверяется внутри БД и действует при любом числе экземпляров приложения.
      const ins = await db.query(
        `INSERT INTO bookings (resource_id, user_id, starts_at, ends_at, purpose)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [data.resourceId, userId, data.startsAt, data.endsAt, data.purpose]);
      const id = ins.rows[0].id;
      await db.query('UPDATE idempotency_keys SET booking_id = $1 WHERE user_id = $2 AND key = $3', [id, userId, key]);
      await audit(db, req, { action: 'booking.create', objectType: 'booking', objectId: id,
        details: { resourceId: data.resourceId, startsAt: data.startsAt, endsAt: data.endsAt } });
      return findById(db, id);
    });

    if (booking) return res.status(201).json(booking);

    // Повтор с тем же ключом: тот же отпечаток — исходная запись, другой — 409
    const prev = await pool.query('SELECT request_hash, booking_id FROM idempotency_keys WHERE user_id = $1 AND key = $2',
      [userId, key]);
    if (prev.rows[0].request_hash !== hash) {
      throw conflict('idempotency_conflict', 'Ключ Idempotency-Key уже использован с другими данными');
    }
    return res.status(200).json(await findById(pool, prev.rows[0].booking_id));
  } catch (e) {
    if (e.code === '23P01') { // нарушение bookings_no_overlap: транзакция откатана, данных не осталось
      await audit(pool, req, { action: 'booking.create', objectType: 'resource', objectId: data.resourceId,
        result: 'rejected', details: { reason: 'overlap', startsAt: data.startsAt, endsAt: data.endsAt } });
      throw conflict('overlap', 'Ресурс уже занят в выбранное время');
    }
    if (e.code === '23503') throw notFound('Ресурс не найден');
    throw e;
  }
});

// GET /api/bookings/my?state= — собственные записи с фильтром состояния
router.get('/my', async (req, res) => {
  const filter = STATE_FILTER[req.query.state];
  const { rows } = await pool.query(
    `SELECT ${COLS} ${FROM} WHERE b.user_id = $1 ${filter ? 'AND ' + filter : ''} ORDER BY b.starts_at DESC`,
    [req.user.id]);
  res.json(rows);
});

// GET /api/bookings/:id — своя запись (администратор — любая); чужая недоступна (404)
router.get('/:id', async (req, res) => {
  const b = await findById(pool, req.params.id);
  if (!b || (b.userId !== req.user.id && req.user.role !== 'admin')) throw notFound();
  res.json(b);
});

// POST /api/bookings/:id/cancel — отмена с проверкой прав, состояния и серверного времени
router.post('/:id/cancel', async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const reason = typeof (req.body || {}).reason === 'string' ? req.body.reason.trim() : '';

  const result = await tx(async (db) => {
    // блокировка строки записи: конкурентные отмены выполняются по очереди
    const { rows } = await db.query('SELECT id, user_id, status, starts_at FROM bookings WHERE id = $1 FOR UPDATE',
      [req.params.id]);
    const b = rows[0];
    if (!b || (b.user_id !== req.user.id && !isAdmin)) throw notFound();
    if (isAdmin && b.user_id !== req.user.id && (reason.length < 5 || reason.length > 300)) {
      throw bad('Укажите причину отмены (5–300 символов)', { reason: 'Причина обязательна' });
    }
    if (b.status === 'cancelled') throw conflict('already_cancelled', 'Запись уже отменена, состояние не изменено');
    if (new Date(b.starts_at) <= new Date()) {
      throw conflict('already_started', 'Начавшуюся или завершённую запись отменить нельзя');
    }
    await db.query(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancelled_by = $1, cancel_reason = $2
       WHERE id = $3`, [req.user.id, reason || null, b.id]);
    await audit(db, req, { action: 'booking.cancel', objectType: 'booking', objectId: b.id,
      details: reason ? { reason } : null });
    return findById(db, b.id);
  });
  res.json(result);
});

module.exports = router;
