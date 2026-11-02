const express = require('express');
const { pool } = require('../db');

const router = express.Router();

// процесс жив
router.get('/live', (req, res) => res.json({ status: 'ok' });

// готовность обслуживать запросы: проверка БД; при недоступности — 503 без внутренних деталей
router.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not_ready', message: 'База данных недоступна', traceId: req.id });
  }
});

module.exports = router;
