const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { jwtSecret, jwtTtl } = require('../config');
const { bad, unauthorized, conflict } = require('../lib/errors');

const router = express.Router();
const issue = (u) => jwt.sign({ sub: u.id, login: u.login, role: u.role }, jwtSecret, { expiresIn: jwtTtl });
const view = (u) => ({ id: u.id, login: u.login, fullName: u.full_name, role: u.role });

// POST /api/auth/register — регистрация (всегда с ролью user; роль из запроса игнорируется)
router.post('/register', async (req, res) => {
  const { login, password, fullName } = req.body || {};
  const fields = {};
  if (!/^[a-z0-9_.-]{3,32}$/.test(login || '')) fields.login = 'Логин: 3–32 символа, латиница в нижнем регистре, цифры, _ . -';
  if (typeof password !== 'string' || password.length < 8) fields.password = 'Пароль — не короче 8 символов';
  if (typeof fullName !== 'string' || fullName.trim().length < 2) fields.fullName = 'Укажите имя';
  if (Object.keys(fields).length) throw bad('Проверьте поля формы', fields);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (full_name, login, password_hash, role) VALUES ($1, $2, $3, 'user') RETURNING *`,
      [fullName.trim(), login, await bcrypt.hash(password, 10)]);
    res.status(201).json({ token: issue(rows[0]), user: view(rows[0]) });
  } catch (e) {
    if (e.code === '23505') throw conflict('login_taken', 'Логин уже занят');
    throw e;
  }
});

// POST /api/auth/login — вход, выдача JWT
router.post('/login', async (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) throw bad('Укажите логин и пароль');
  const { rows } = await pool.query('SELECT * FROM users WHERE login = $1', [login]);
  if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) {
    throw unauthorized('Неверный логин или пароль');
  }
  res.json({ token: issue(rows[0]), user: view(rows[0]) });
});

module.exports = router;
