// Технический журнал (JSON Lines): диагностика ошибок и отказов доступа.
// Пароли, JWT, заголовок Authorization и строки подключения в журнал не попадают.
const fs = require('fs');
const path = require('path');
const { logFile } = require('../config');

fs.mkdirSync(path.dirname(logFile), { recursive: true });
const stream = fs.createWriteStream(logFile, { flags: 'a' });

function write(level, event, data = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...data });
  stream.write(line + '\n');
  if (process.env.LOG_STDOUT !== '0') console.log(line);
}

module.exports = {
  info: (event, data) => write('info', event, data),
  warn: (event, data) => write('warn', event, data),
  error: (event, data) => write('error', event, data)
};
