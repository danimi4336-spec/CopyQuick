const passport = require('passport');
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

// Google OAuth Strategy (only if credentials are configured)
const googleClientID = process.env.GOOGLE_CLIENT_ID || '';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
const googleCallbackURL = process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback';

if (googleClientID && googleClientSecret) {
  const GoogleStrategy = require('passport-google-oauth20').Strategy;

  console.log('📋 Registering Google OAuth strategy...');
  console.log(`  clientID:     "${googleClientID.substring(0, 20)}..."`);
  console.log(`  callbackURL:  "${googleCallbackURL}"`);

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
        if (!email) {
          console.error('❌ Google profile has no email. Profile:', JSON.stringify({ id: profile.id, displayName: profile.displayName }));
          return done(new Error('No email from Google'), null);
        }

        console.log('👤 Google profile received:', { id: profile.id, email, name: profile.displayName });

        // Check if user exists by google_id or email
        let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.id);
        console.log('  Lookup by google_id:', user ? 'found user ' + user.id : 'not found');

        if (!user && email) {
          user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
          console.log('  Lookup by email:', user ? 'found user ' + user.id : 'not found');
          if (user) {
            // Link Google account to existing user
            console.log('  Linking Google account to existing user:', user.id);
            db.prepare('UPDATE users SET google_id = ?, avatar_url = ? WHERE id = ?')
              .run(profile.id, profile.photos?.[0]?.value || null, user.id);
          }
        }

        if (!user) {
          // Create new user from Google profile
          console.log('  Creating new user for email:', email);
          const result = db.prepare(
            'INSERT INTO users (email, name, google_id, avatar_url) VALUES (?, ?, ?, ?)'
          ).run(
            email,
            profile.displayName || profile.name?.givenName || 'User',
            profile.id,
            profile.photos?.[0]?.value || null
          );
          user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
          console.log('  New user created with id:', user?.id);
        }

        if (!user) {
          console.error('❌ Failed to find or create user for Google profile:', profile.id);
          return done(new Error('User creation failed'), null);
        }

        console.log('✅ Google auth complete for user:', user.id, user.email);
        return done(null, user);
      } catch (err) {
        console.error('❌ GoogleStrategy error:', err.message);
        console.error('❌ Stack:', err.stack);
        return done(err, null);
      }
    }
  ));
} else {
  console.log('⚠️ Google OAuth credentials not configured — Google login disabled. Use email/password signup or set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET.');
}

module.exports = passport;