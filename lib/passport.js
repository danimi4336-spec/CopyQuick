const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { getDb } = require('../db/database');

// Serialize user ID to session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser((id, done) => {
  const db = getDb();
  try {
    const user = db.prepare('SELECT id, email, name, plan_tier, avatar_url, generations_used, monthly_limit, created_at FROM users WHERE id = ?').get(id);
    done(null, user || null);
  } catch (err) {
    done(err, null);
  }
});

// Google OAuth Strategy
const googleClientID = process.env.GOOGLE_CLIENT_ID || '';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
const googleCallbackURL = process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback';

console.log('📋 Passport GoogleStrategy initialization:');
console.log(`  clientID:            "${googleClientID}"`);
console.log(`  clientID length:     ${googleClientID.length} chars`);
console.log(`  clientID ends with:  ...${googleClientID.slice(-15)}`);
console.log(`  clientSecret:        ${googleClientSecret ? '✅ set (' + googleClientSecret.length + ' chars)' : '❌ MISSING'}`);
console.log(`  callbackURL:         "${googleCallbackURL}"`);
console.log(`  NODE_ENV:            ${process.env.NODE_ENV || 'not set'}`);
console.log(`  HOSTNAME:            ${process.env.HOSTNAME || require('os').hostname()}`);
console.log(`  PORT:                ${process.env.PORT || '3000'}`);
console.log(`  RENDER_EXTERNAL_URL: ${process.env.RENDER_EXTERNAL_URL || 'not set'}`);

passport.use(new GoogleStrategy({
    clientID: googleClientID,
    clientSecret: googleClientSecret,
    callbackURL: googleCallbackURL,
    scope: ['profile', 'email'],
  },
  (accessToken, refreshToken, profile, done) => {
    const db = getDb();
    try {
      const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
      if (!email) return done(new Error('No email from Google'), null);

      // Check if user exists by google_id or email
      let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.id);
      
      if (!user && email) {
        user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (user) {
          // Link Google account to existing user
          db.prepare('UPDATE users SET google_id = ?, avatar_url = ? WHERE id = ?')
            .run(profile.id, profile.photos?.[0]?.value || null, user.id);
        }
      }

      if (!user) {
        // Create new user from Google profile
        const result = db.prepare(
          'INSERT INTO users (email, name, google_id, avatar_url) VALUES (?, ?, ?, ?)'
        ).run(
          email,
          profile.displayName || profile.name?.givenName || 'User',
          profile.id,
          profile.photos?.[0]?.value || null
        );
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
      }

      return done(null, user);
    } catch (err) {
      return done(err, null);
    }
  }
));

module.exports = passport;