require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('./lib/sessionStore');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

const { getDb } = require('./db/database');
const { initDb } = require('./db/init');
const { router: authRoutes, requireAuth } = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const pricingRoutes = require('./routes/pricing');
const webhookRoutes = require('./routes/webhook');

// Initialize database
initDb();

// Webhook route must be before express.json() to get raw body
app.use('/', webhookRoutes);

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store: new SQLiteStore(),
  secret: process.env.SESSION_SECRET || 'copyquick-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Provide user to all templates
app.use((req, res, next) => {
  if (req.session.userId) {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    res.locals.user = user;
  } else {
    res.locals.user = null;
  }
  next();
});

// Wrapper for layout
app.use((req, res, next) => {
  const _render = res.render;
  res.render = function(view, options, fn) {
    if (view === 'layout') return _render.call(this, view, options, fn);
    
    _render.call(this, view, options, (err, html) => {
      if (err) return next(err);
      _render.call(this, 'layout', { ...options, ...res.locals, body: html }, fn);
    });
  };
  next();
});

// Routes
app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/', pricingRoutes);

app.get('/', (req, res) => {
  res.render('index', { title: 'CopyQuick - AI Powered Marketing Copy' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});
