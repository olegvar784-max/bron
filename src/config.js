// Настройки сервиса. Значения берутся из переменных окружения (или из файла .env при локальном запуске).
const fs = require('fs');
const path = require('path');

// минимальный загрузчик .env без зависимостей; уже заданные переменные окружения не перезаписываются
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const production = process.env.NODE_ENV === 'production';
if (production && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET не задан: в production запуск без секрета запрещён');
}

module.exports = {
  port: Number(process.env.PORT || 8080),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-not-for-production',
  jwtTtl: process.env.JWT_TTL || '2h',
  logFile: process.env.LOG_FILE || path.join(__dirname, '..', 'logs', 'app.log'),
  timezone: 'Europe/Moscow',
  rules: {
    openHour: 8,          // ресурсы доступны с 08:00
    closeHour: 22,        // до 22:00 по Москве
    stepMinutes: 30,      // шаг выбора времени
    minMinutes: 30,       // минимальная продолжительность
    maxMinutes: 240,      // максимальная продолжительность — 4 часа
    maxDaysAhead: 30      // начало не позднее чем через 30 суток
  }
};
