// Ручная проверка конкурентных запросов: две сессии (ivanov и petrova) одновременно
require('../src/config'); // загрузка .env (SEED_PASSWORD)
// бронируют один и тот же свободный интервал с разными ключами. Повторить можно на новых интервалах.
// Запуск: SEED_PASSWORD=... node scripts/race-test.js [номер_попытки]
const crypto = require('crypto');
const BASE = process.env.BASE_URL || 'http://localhost:8080';
const attempt = Number(process.argv[2] || 1);

async function login(login) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password: process.env.SEED_PASSWORD }) });
  return (await r.json()).token;
}

(async () => {
  const [a, b] = [await login('ivanov'), await login('petrova')];
  const day = new Date(Date.now() + 3 * 3600e3 + 5 * 864e5).toISOString().slice(0, 10); // через 5 суток
  const hh = String(8 + attempt).padStart(2, '0');
  const body = JSON.stringify({ resourceId: 3, startsAt: `${day}T${hh}:00:00+03:00`,
    endsAt: `${day}T${hh}:30:00+03:00`, purpose: `Проверка гонки, попытка ${attempt}` });
  const send = (token, who) => fetch(`${BASE}/api/bookings`, { method: 'POST', body, headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() } })
    .then(async (r) => ({ who, status: r.status, body: await r.json() }));
  const results = await Promise.all([send(a, 'ivanov'), send(b, 'petrova')]);
  console.log(`Попытка ${attempt}: ресурс 3, ${day} ${hh}:00–${hh}:30 МСК`);
  for (const r of results) {
    console.log(`  ${r.who.padEnd(8)} → ${r.status} ${r.status === 201 ? 'создана запись №' + r.body.id : r.body.message}`);
  }
})();
