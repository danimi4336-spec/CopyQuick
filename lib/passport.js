const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { getDb } = require('../db/database');
const { getAuthenticatedUserById } = require('./authUser');
const { normalizeEmail } = require('./authProtection');

function getVerifiedGoogleEmail(profile) {
  const emailRecord = profile?.emails?.[0];
  const email = normalizeEmail(emailRecord?.value);
  const verified = emailRecord?.verified === true || profile?._json?.email_verified === true;
  if (!verified || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error('Google did not provide a verified email address.');
    error.code = 'GOOGLE_EMAIL_UNVERIFIED';
    throw error;
  }
  return email;
}

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
        const email = getVerifiedGoogleEmail(profile);

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

        if (!user) {
          return done(new Error('User creation failed'), null);
        }

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }
  ));
}

passport.isGoogleOAuthConfigured = function() {
  return googleOAuthConfig.isConfigured;
};
passport.getGoogleOAuthConfig = getGoogleOAuthConfig;
passport.getVerifiedGoogleEmail = getVerifiedGoogleEmail;
module.exports = passport;
