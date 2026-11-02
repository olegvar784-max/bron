const app = require('./app');
const { port } = require('./config');
const log = require('./lib/log');

app.listen(port, () => {
  log.info('started', { port, db: process.env.DB_NAME || 'bron', env: process.env.NODE_ENV || 'development' });
});
