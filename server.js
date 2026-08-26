require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('./lib/passport');
const SQLiteStore = require('./lib/sessionStore');
const path = require('path');
const app = express();
app.set('trust proxy', 1); // Trust Render's proxy for HTTPS
const PORT = process.env.PORT || 3000;

const { getDatabaseStorage, getDb } = require('./db/database');
const { safeStorageDiagnostics } = require('./lib/databasePath');
const { initDb } = require('./db/init');
const { router: authRoutes, requireAuth } = require('./routes/auth');
const dashboardRoutes = require('./routes/generations');
const pricingRoutes = require('./routes/pricing');
const webhookRoutes = require('./routes/webhook');
const builderRoutes = require('./routes/builder');
const discoveryRoutes = require('./routes/discovery');
const productionRoutes = require('./routes/production');
const { sendContactFormEmails } = require('./lib/email');
const { contentTypes } = require('./lib/contentTypes');
const { getAuthenticatedUserById } = require('./lib/authUser');
const { createGlobalErrorHandler } = require('./lib/errorHandler');
const { createCsrfProtection } = require('./lib/csrf');
const { createSessionConfig, getSessionSecretStatus } = require('./lib/sessionConfig');
const { createContactHandler, createContactRateLimiter } = require('./lib/contactProtection');
const { createProductionWorker } = require('./lib/productionWorker');

// Startup auth config check
const hasGoogleClientId = Boolean(String(process.env.GOOGLE_CLIENT_ID || '').trim());
const hasGoogleClientSecret = Boolean(String(process.env.GOOGLE_CLIENT_SECRET || '').trim());
const hasGoogleCallbackUrl = Boolean(String(process.env.GOOGLE_CALLBACK_URL || '').trim());
console.log('🔐 Auth Configuration:');
console.log(`  GOOGLE_CLIENT_ID:     ${hasGoogleClientId ? 'present' : 'missing'}`);
console.log(`  GOOGLE_CLIENT_SECRET: ${hasGoogleClientSecret ? 'present' : 'missing'}`);
console.log(`  GOOGLE_CALLBACK_URL:  ${hasGoogleCallbackUrl ? 'present' : 'missing'}`);
console.log(`  Google OAuth:         ${hasGoogleClientId && hasGoogleClientSecret ? 'configured' : 'disabled'}`);
console.log(`  SESSION_SECRET:       ${getSessionSecretStatus(process.env)}`);

// Validate storage before opening SQLite. Production never falls back to a local path.
const databaseStorage = getDatabaseStorage();
const databaseDiagnostics = safeStorageDiagnostics(databaseStorage);
console.log('Database storage:');
console.log(`  mode:     ${databaseDiagnostics.mode}`);
if (databaseDiagnostics.path) console.log(`  path:     ${databaseDiagnostics.path}`);
console.log(`  writable: ${databaseDiagnostics.writable ? 'yes' : 'no'}`);
initDb();
console.log(databaseStorage.existedBeforeStartup
  ? 'Existing SQLite database opened without reset.'
  : 'New SQLite database initialized at the configured storage location. Existing data was not migrated automatically.');

// Stripe webhooks are intentionally mounted before body parsing, sessions, and
// CSRF protection because Stripe authenticates them with a signed raw body.
app.use('/', webhookRoutes);

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session(createSessionConfig({ store: new SQLiteStore() })));

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Central CSRF protection for browser-originated state changes.
app.use(createCsrfProtection());

// Provide user to all templates
app.use((req, res, next) => {
  const userId = req.session?.userId || req.session?.passport?.user || req.user?.id;
  if (userId) {
    const db = getDb();
    const user = getAuthenticatedUserById(db, userId);
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
app.use('/', builderRoutes);
app.use('/', discoveryRoutes);
app.use('/', productionRoutes);

app.get('/', (req, res) => {
  res.render('index', { title: 'CopyQuick - AI Powered Marketing Copy', currentPage: 'home', contentTypes });
});

app.get('/about', (req, res) => {
  res.render('about', { title: 'About - CopyQuick', currentPage: 'about', contentTypes });
});

app.get('/contact', (req, res) => {
  res.render('contact', { title: 'Contact - CopyQuick', currentPage: 'contact', sent: false, error: null });
});

app.post('/contact', createContactRateLimiter(), createContactHandler({ sendContactFormEmails }));

app.get('/blog', (req, res) => {
  res.render('blog', { title: 'Blog - CopyQuick', currentPage: 'blog' });
});

app.get('/privacy', (req, res) => {
  res.render('privacy', { title: 'Privacy Policy - CopyQuick', currentPage: 'privacy' });
});

app.get('/terms', (req, res) => {
  res.render('terms', { title: 'Terms of Service - CopyQuick', currentPage: 'terms' });
});

app.get('/cookies', (req, res) => {
  res.render('cookies', { title: 'Cookie Policy - CopyQuick', currentPage: 'cookies' });
});

app.get('/refunds', (req, res) => {
  res.render('refunds', { title: 'Refund Policy - CopyQuick', currentPage: 'refunds' });
});

// Global error handler — logs full errors, but hides internals from production users.
app.use(createGlobalErrorHandler());

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});
const productionWorker = createProductionWorker({ db: getDb() });
productionWorker.start();

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}. Stopping production scheduling safely.`);
  await productionWorker.stop();
  server.close(() => process.exit(0));
}
process.once('SIGTERM', () => { shutdown('SIGTERM'); });
process.once('SIGINT', () => { shutdown('SIGINT'); });
