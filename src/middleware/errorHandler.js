// Перевод ошибок в ответ API. Стек, SQL и внутренние детали остаются только в техническом журнале.
const { ApiError } = require('../lib/errors');
const log = require('../lib/log');

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'validation', message: 'Некорректный JSON', traceId: req.id });
  }
  if (err instanceof ApiError) {
    const body = { error: err.code, message: err.message, traceId: req.id };
    if (err.fields) body.fields = err.fields;
    if (err.status >= 400 && err.status !== 404) {
      log.warn('api_error', { traceId: req.id, status: err.status, code: err.code, message: err.message });
    }
    return res.status(err.status).json(body);
  }
  log.error('unhandled', { traceId: req.id, message: err.message, code: err.code, stack: err.stack });
  res.status(500).json({ error: 'internal', message: 'Внутренняя ошибка сервера. Сообщите traceId администратору', traceId: req.id });
};
