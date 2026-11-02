// Проверка числового параметра :id — некорректный идентификатор трактуется как отсутствующая запись
const { notFound } = require('./errors');

module.exports = function idParam(router) {
  router.param('id', (req, res, next, value) => {
    if (!/^\d{1,9}$/.test(value)) return next(notFound());
    req.params.id = Number(value);
    next();
  });
};
