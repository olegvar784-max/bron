// Идентификатор запроса (traceId) и запись технического журнала по каждому запросу
const { randomUUID } = require('crypto');
const log = require('../lib/log');

module.exports = function requestContext(req, res, next) {
  req.id = randomUUID();
  res.set('X-Request-Id', req.id);
  const started = Date.now();
  res.on('finish', () => {
    const entry = { traceId: req.id, method: req.method, path: req.originalUrl.split('?')[0],
      status: res.statusCode, userId: req.user ? req.user.id : null, ms: Date.now() - started };
    if (res.statusCode >= 500) log.error('http', entry);
    else if (res.statusCode === 401 || res.statusCode === 403) log.warn('access_denied', entry);
    else log.info('http', entry);
  });
  next();
};
