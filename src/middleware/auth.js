// Проверка JWT и роли. Пользователь определяется только по проверенному токену.
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config');
const { unauthorized, forbidden } = require('../lib/errors');

function requireAuth(req, res, next) {
  const [type, token] = (req.get('authorization') || '').split(' ');
  if (type !== 'Bearer' || !token) return next(unauthorized());
  try {
    const p = jwt.verify(token, jwtSecret);
    req.user = { id: p.sub, login: p.login, role: p.role };
    next();
  } catch (e) {
    next(unauthorized(e.name === 'TokenExpiredError'
      ? 'Срок действия входа истёк, войдите снова' : 'Токен недействителен, войдите снова'));
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return next(forbidden());
  next();
}

module.exports = { requireAuth, requireAdmin };
