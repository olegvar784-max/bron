// Единый формат ошибок API: { error, message, traceId }
class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields; // ошибки отдельных полей формы (для вывода рядом с полями)
  }
}

const bad = (message, fields) => new ApiError(400, 'validation', message, fields);
const unauthorized = (message = 'Требуется вход в систему') => new ApiError(401, 'unauthorized', message);
const forbidden = (message = 'Действие доступно только администратору') => new ApiError(403, 'forbidden', message);
const notFound = (message = 'Запись не найдена') => new ApiError(404, 'not_found', message);
const conflict = (code, message) => new ApiError(409, code, message);

module.exports = { ApiError, bad, unauthorized, forbidden, notFound, conflict };
