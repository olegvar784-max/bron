const express = require('express');
const path = require('path');
const requestContext = require('./middleware/requestContext');
const errorHandler = require('./middleware/errorHandler');
const { notFound } = require('./lib/errors');

const app = express();
app.disable('x-powered-by');
app.use(requestContext);
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/health', require('./routes/health'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/resources', require('./routes/resources'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', (req, res, next) => next(notFound('Маршрут не найден')));
app.use(errorHandler);

module.exports = app;
