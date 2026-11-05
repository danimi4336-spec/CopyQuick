function authConfigurationEvent(env = process.env) {
  const configured = Boolean(String(env.GOOGLE_CLIENT_ID || '').trim()) &&
    Boolean(String(env.GOOGLE_CLIENT_SECRET || '').trim());
  return Object.freeze({
    event: 'auth_configuration_loaded',
    operation: 'google_oauth',
    outcome: configured ? 'configured' : 'disabled'
  });
}

module.exports = { authConfigurationEvent };
