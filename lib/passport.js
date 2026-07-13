const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { getDb } = require('../db/database');
const { getAuthenticatedUserById } = require('./authUser');

function getGoogleOAuthConfig(env = process.env) {
  const clientID = (env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();
  const callbackURL = env.GOOGLE_CALLBACK_URL || '/auth/google/callback';

  return {
    clientID,
    clientSecret,
    callbackURL,
    isConfigured: Boolean(clientID && clientSecret)
  };
}

// Serialize user ID to session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser((id, done) => {
  const db = getDb();
  try {
    const user = getAuthenticatedUserById(db, id);
    done(null, user || null);
  } catch (err) {
    done(err, null);
  }
});

// Google OAuth Strategy
const googleOAuthConfig = getGoogleOAuthConfig();

console.log('📋 Passport Google OAuth configuration:');
console.log(`  clientID:            ${googleOAuthConfig.clientID ? 'present' : 'missing'}`);
console.log(`  clientSecret:        ${googleOAuthConfig.clientSecret ? 'present' : 'missing'}`);
console.log(`  callbackURL:         ${googleOAuthConfig.callbackURL ? 'present' : 'missing'}`);
console.log(`  enabled:             ${googleOAuthConfig.isConfigured ? 'yes' : 'no'}`);

if (googleOAuthConfig.isConfigured) {
  passport.use(new GoogleStrategy({
      clientID: googleOAuthConfig.clientID,
      clientSecret: googleOAuthConfig.clientSecret,
      callbackURL: googleOAuthConfig.callbackURL,
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
  console.warn('⚠️ Google OAuth is disabled because GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing.');
}

passport.isGoogleOAuthConfigured = function() {
  return googleOAuthConfig.isConfigured;
};
passport.getGoogleOAuthConfig = getGoogleOAuthConfig;
module.exports = passport;
