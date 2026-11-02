// Правила времени бронирования. Все проверки — по серверному времени.
const { rules, timezone } = require('../config');

// ISO 8601 с обязательным смещением часового пояса: 2026-11-03T10:00:00+03:00 или ...Z
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// дата и время момента в часовом поясе Москвы
function msk(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), seconds: Number(p.second) };
}

// границы московских суток YYYY-MM-DD в виде моментов времени
function mskDayBounds(day) {
  const from = new Date(`${day}T00:00:00+03:00`);
  return { from, to: new Date(from.getTime() + 24 * 3600 * 1000) };
}

// возвращает объект ошибок по полям или null
function validateInterval(startRaw, endRaw, now = new Date()) {
  if (typeof startRaw !== 'string' || !ISO_WITH_OFFSET.test(startRaw)) {
    return { startsAt: 'Укажите начало в формате ISO 8601 со смещением, например 2026-11-03T10:00:00+03:00' };
  }
  if (typeof endRaw !== 'string' || !ISO_WITH_OFFSET.test(endRaw)) {
    return { endsAt: 'Укажите окончание в формате ISO 8601 со смещением' };
  }
  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { startsAt: 'Некорректная дата' };
  if (end <= start) return { endsAt: 'Окончание должно быть позже начала' };
  if (start < now) return { startsAt: 'Начало не может находиться в прошлом' };
  if (start - now > rules.maxDaysAhead * 24 * 3600 * 1000) {
    return { startsAt: `Бронировать можно не более чем на ${rules.maxDaysAhead} суток вперёд` };
  }
  const s = msk(start);
  const e = msk(end);
  if (s.minutes % rules.stepMinutes || e.minutes % rules.stepMinutes || s.seconds || e.seconds ||
      start.getMilliseconds() || end.getMilliseconds()) {
    return { startsAt: `Время выбирается с шагом ${rules.stepMinutes} минут` };
  }
  const minutes = (end - start) / 60000;
  if (minutes < rules.minMinutes || minutes > rules.maxMinutes) {
    return { endsAt: 'Продолжительность — от 30 минут до 4 часов' };
  }
  const endsAtMidnight = e.minutes === 0 && msk(new Date(end - 1)).day === s.day;
  if ((e.day !== s.day && !endsAtMidnight) || s.minutes < rules.openHour * 60 ||
      (endsAtMidnight ? 24 * 60 : e.minutes) > rules.closeHour * 60) {
    return { startsAt: 'Бронирование возможно с 08:00 до 22:00 (МСК) в пределах одного дня' };
  }
  return null;
}

module.exports = { validateInterval, mskDayBounds, msk };
