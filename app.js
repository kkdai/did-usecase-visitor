require('dotenv').config();

const express = require('express');
const path = require('path');
const logger = require('morgan');

const indexRouter = require('./routes/index');

const app = express();

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// error handler
app.use((err, req, res, next) => {
  console.error('[app] Unhandled error:', err);
  res.status(err.status || 500).json({ error: 'internal_error', message: err.message });
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`[did-usecase-visitor] listening on :${port}`);
});

module.exports = app;
