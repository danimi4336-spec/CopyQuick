require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('./lib/passport');
const SQLiteStore = require('./lib/sessionStore');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

const { getDb } = require('./db/database');
const { initDb } = require('./db/init');
const { router: authRoutes, requireAuth } = require('./routes/auth');
const dashboardRoutes = require('./routes/generations');
const pricingRoutes = require('./routes/pricing');
const webhookRoutes = require('./routes/webhook');
const { sendContactFormEmails } = require('./lib/email');
const { contentTypes } = require('./lib/contentTypes');

// Startup auth config check
console.log('🔐 Auth Configuration:');
console.log(`  GOOGLE_CLIENT_ID:     ${process.env.GOOGLE_CLIENT_ID ? '✅ present (' + process.env.GOOGLE_CLIENT_ID.substring(0, 20) + '...)' : '❌ MISSING'}`);
console.log(`  GOOGLE_CLIENT_SECRET: ${process.env.GOOGLE_CLIENT_SECRET ? '✅ present (' + process.env.GOOGLE_CLIENT_SECRET.substring(0, 8) + '...)' : '❌ MISSING'}`);
console.log(`  GOOGLE_CALLBACK_URL:  ${process.env.GOOGLE_CALLBACK_URL ? '✅ ' + process.env.GOOGLE_CALLBACK_URL : '❌ MISSING'}`);
console.log(`  SESSION_SECRET:       ${process.env.SESSION_SECRET ? '✅ present' : '⚠️ using default'}`);

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

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Provide user to all templates
app.use((req, res, next) => {
  const userId = req.session?.userId || req.session?.passport?.user || req.user?.id;
  if (userId) {
    const db = getDb();
    const user = db.prepare('SELECT id, email, name, plan_tier, avatar_url, generations_used, monthly_limit, created_at FROM users WHERE id = ?').get(userId);
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
  res.render('index', { title: 'CopyQuick - AI Powered Marketing Copy', currentPage: 'home', contentTypes });
});

app.get('/about', (req, res) => {
  res.render('about', { title: 'About - CopyQuick', currentPage: 'about', contentTypes });
});

app.get('/contact', (req, res) => {
  res.render('contact', { title: 'Contact - CopyQuick', currentPage: 'contact', sent: false, error: null });
});

app.post('/contact', async (req, res) => {
  const { name, email, subject, message } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'N/A';
  const userAgent = req.headers['user-agent'] || 'N/A';

  if (!name || !email || !subject || !message) {
    return res.render('contact', { 
      title: 'Contact - CopyQuick', currentPage: 'contact', sent: false,
      error: 'Please fill in all fields.' 
    });
  }

  try {
    const { ticketNumber } = await sendContactFormEmails({ name, email, subject, message, ip, userAgent });
    console.log(`Contact form processed: ticket ${ticketNumber} from ${email}`);
    res.render('contact', { title: 'Contact - CopyQuick', currentPage: 'contact', sent: true, error: null });
  } catch (err) {
    console.error('Contact form error:', err);
    res.render('contact', { 
      title: 'Contact - CopyQuick', currentPage: 'contact', sent: false,
      error: 'Sorry, your message could not be sent. Please try again later.' 
    });
  }
});

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});
