const assert = require('assert');

const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
const { validateProductionEmailConfig } = require('../lib/email');
if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = originalNodeEnv;

assert.deepStrictEqual(validateProductionEmailConfig({ NODE_ENV: 'development' }), { enabled: false });
assert.deepStrictEqual(validateProductionEmailConfig({ NODE_ENV: 'test', RESEND_API_KEY: 'test-key' }), { enabled: true });
assert.deepStrictEqual(validateProductionEmailConfig({ NODE_ENV: 'production', RESEND_API_KEY: 're_not_a_real_key' }), { enabled: true });

for (const value of [undefined, '', '   \t\n ']) {
  assert.throws(
    () => validateProductionEmailConfig({ NODE_ENV: 'production', RESEND_API_KEY: value }),
    error => error.message === 'Transactional email configuration error: RESEND_API_KEY is required when NODE_ENV=production.'
  );
}

console.log('Story 3.169 Transactional Email Configuration Gate tests passed');
