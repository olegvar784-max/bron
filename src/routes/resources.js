const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { bad, notFound } = require('../lib/errors');
const { mskDayBounds } = require('../lib/time');

const router = express.Router();
router.use(requireAuth);
require('../lib/params')(router);

const COLS = `id, name, description, location, capacity, is_active AS "isActive"`;

// GET /api/resources?q=&location= — каталог активных ресурсов с поиском и фильтром
router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const location = String(req.query.location || '').trim();
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM resources
     WHERE is_active AND ($1 = '' OR name ILIKE '%' || $1 || '%') AND ($2 = '' OR location = $2)
     ORDER BY name`, [q, location]);
  res.json(rows);
});

// GET /api/resources/locations — значения для фильтра местоположения
router.get('/locations', async (req, res) => {
  const { rows } = await pool.query('SELECT DISTINCT location FROM resources WHERE is_active ORDER BY location');
  res.json(rows.map((r) => r.location));
});

// GET /api/resources/:id — карточка ресурса
router.get('/:id', async (req, res) => {
  const { rows } = await pool.query(`SELECT ${COLS} FROM resources WHERE id = $1`, [req.params.id]);
  if (!rows[0]) throw notFound('Ресурс не найден');
  res.json(rows[0]);
});

// GET /api/resources/:id/availability?date=YYYY-MM-DD — занятые интервалы без чужих данных
router.get('/:id/availability', async (req, res) => {
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Параметр date в формате ГГГГ-ММ-ДД', { date: 'Укажите дату' });
  const exists = await pool.query('SELECT 1 FROM resources WHERE id = $1', [req.params.id]);
  if (!exists.rowCount) throw notFound('Ресурс не найден');
  const { from, to } = mskDayBounds(date);
  const { rows } = await pool.query(
    `SELECT starts_at AS "startsAt", ends_at AS "endsAt", (user_id = $4) AS "mine"
     FROM bookings WHERE resource_id = $1 AND status = 'active' AND starts_at < $3 AND ends_at > $2
     ORDER BY starts_at`, [req.params.id, from, to, req.user.id]);
  res.json({ date, timezone: 'Europe/Moscow', busy: rows });
});

module.exports = router;
