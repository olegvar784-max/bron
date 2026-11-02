// Применение SQL-миграций по порядку. Рекомендательная блокировка PostgreSQL не даёт
// двум процессам миграции (например, двум экземплярам при публикации) выполняться одновременно.
const fs = require('fs');
const path = require('path');
require('../src/config');
const { pool } = require('../src/db');

const LOCK_ID = 841001;

(async () => {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())');
    const dir = path.join(__dirname, '..', 'migrations');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (done.rowCount) { console.log('Уже применена:', file); continue; }
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log('Применена миграция:', file);
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Ошибка миграции:', e.message);
    process.exitCode = 1;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
    await pool.end();
  }
})();
