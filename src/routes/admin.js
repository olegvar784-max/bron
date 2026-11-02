const express = require('express');
const { pool, tx } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { bad, notFound, conflict } = require('../lib/errors');
const { audit } = require('../lib/audit');
const { mskDayBounds } = require('../lib/time');

const router = express.Router();
router.use(requireAuth, requireAdmin); // любой маршрут /api/admin/* для обычного пользователя — 403
require('../lib/params')(router);

const RCOLS = `id, name, description, location, capacity, is_active AS "isActive", updated_at AS "updatedAt"`;

// GET /api/admin/bookings?date=&resourceId=&state= — все записи с владельцами
router.get('/bookings', async (req, res) => {
  const where = [];
  const args = [];
  if (req.query.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) throw bad('date в формате ГГГГ-ММ-ДД');
    const { from, to } = mskDayBounds(req.query.date);
    args.push(from, to);
    where.push(`b.starts_at < $${args.length} AND b.ends_at > $${args.length - 1}`);
  }
  if (req.query.resourceId) { args.push(Number(req.query.resourceId)); where.push(`b.resource_id = $${args.length}`); }
  const states = {
    upcoming: `b.status = 'active' AND b.starts_at > now()`,
    in_progress: `b.status = 'active' AND b.starts_at <= now() AND b.ends_at > now()`,
    finished: `b.status = 'active' AND b.ends_at <= now()`,
    cancelled: `b.status = 'cancelled'`
  };
  if (states[req.query.state]) where.push(states[req.query.state]);
  const { rows } = await pool.query(
    `SELECT b.id, r.name AS "resourceName", u.login AS "userLogin", u.full_name AS "userName",
       b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.purpose, b.status, b.cancel_reason AS "cancelReason",
       CASE WHEN b.status = 'cancelled' THEN 'cancelled' WHEN b.ends_at <= now() THEN 'finished'
            WHEN b.starts_at <= now() THEN 'in_progress' ELSE 'upcoming' END AS state
     FROM bookings b JOIN resources r ON r.id = b.resource_id JOIN users u ON u.id = b.user_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.starts_at DESC LIMIT 500`, args);
  res.json(rows);
});

// GET /api/admin/resources — все ресурсы, включая отключённые
router.get('/resources', async (req, res) => {
  const { rows } = await pool.query(`SELECT ${RCOLS} FROM resources ORDER BY id`);
  res.json(rows);
});

function checkResource(body, partial) {
  const f = {};
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length < 3 || body.name.length > 100) f.name = 'Название — 3–100 символов';
  }
  if (!partial || body.location !== undefined) {
    if (typeof body.location !== 'string' || body.location.trim().length < 2 || body.location.length > 100) f.location = 'Укажите местоположение';
  }
  if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 500)) f.description = 'Описание — до 500 символов';
  if (!partial || body.capacity !== undefined) {
    if (!Number.isInteger(body.capacity) || body.capacity < 1 || body.capacity > 1000) f.capacity = 'Вместимость — целое число 1–1000';
  }
  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') f.isActive = 'true или false';
  if (Object.keys(f).length) throw bad('Проверьте поля формы', f);
}

// POST /api/admin/resources — создание ресурса
router.post('/resources', async (req, res) => {
  const b = req.body || {};
  checkResource(b, false);
  try {
    const r = await tx(async (db) => {
      const { rows } = await db.query(
        `INSERT INTO resources (name, description, location, capacity) VALUES ($1, $2, $3, $4) RETURNING ${RCOLS}`,
        [b.name.trim(), (b.description || '').trim(), b.location.trim(), b.capacity]);
      await audit(db, req, { action: 'resource.create', objectType: 'resource', objectId: rows[0].id, details: { name: rows[0].name } });
      return rows[0];
    });
    res.status(201).json(r);
  } catch (e) {
    if (e.code === '23505') throw conflict('name_taken', 'Ресурс с таким названием уже есть');
    throw e;
  }
});

// PATCH /api/admin/resources/:id — изменение и отключение ресурса
router.patch('/resources/:id', async (req, res) => {
  const b = req.body || {};
  checkResource(b, true);
  const r = await tx(async (db) => {
    // FOR UPDATE на строку ресурса: создание брони держит FOR SHARE на ту же строку,
    // поэтому отключение и создание записи не выполняются одновременно
    const cur = await db.query('SELECT * FROM resources WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!cur.rowCount) throw notFound('Ресурс не найден');
    const c = cur.rows[0];
    const { rows } = await db.query(
      `UPDATE resources SET name = $1, description = $2, location = $3, capacity = $4, is_active = $5, updated_at = now()
       WHERE id = $6 RETURNING ${RCOLS}`,
      [b.name !== undefined ? b.name.trim() : c.name, b.description !== undefined ? b.description.trim() : c.description,
        b.location !== undefined ? b.location.trim() : c.location, b.capacity !== undefined ? b.capacity : c.capacity,
        b.isActive !== undefined ? b.isActive : c.is_active, c.id]);
    const action = b.isActive === false && c.is_active ? 'resource.disable'
      : b.isActive === true && !c.is_active ? 'resource.enable' : 'resource.update';
    await audit(db, req, { action, objectType: 'resource', objectId: c.id, details: b });
    return rows[0];
  });
  res.json(r);
});

// GET /api/admin/audit?limit= — просмотр аудита
router.get('/audit', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const { rows } = await pool.query(
    `SELECT a.id, a.at, u.login AS actor, a.action, a.object_type AS "objectType", a.object_id AS "objectId",
       a.result, a.request_id AS "requestId", a.details
     FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.at DESC, a.id DESC LIMIT $1`, [limit]);
  res.json(rows);
});

module.exports = router;
