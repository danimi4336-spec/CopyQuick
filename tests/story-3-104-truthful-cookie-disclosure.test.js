const assert = require('assert');
const fs = require('fs');
const path = require('path');

const views = path.join(__dirname, '..', 'views');
const privacy = fs.readFileSync(path.join(views, 'privacy.ejs'), 'utf8');
const cookies = fs.readFileSync(path.join(views, 'cookies.ejs'), 'utf8');

for (const unsupported of [
  /Analytics Cookies:<\/strong> Help us understand/i,
  /Preference Cookies:<\/strong> Remember your settings/i,
  /We use cookies to understand how visitors interact/i,
  /Cookies remember your settings/i,
  /collect anonymized data about page visits/i,
  /Third-party analytics services may offer opt-out/i
]) {
  assert.doesNotMatch(`${privacy}\n${cookies}`, unsupported);
}

assert.match(privacy, /essential session cookie for account authentication and request security/i);
assert.match(privacy, /does not currently set analytics or advertising cookies/i);
assert.match(cookies, /Session state supports protections such as CSRF validation/i);
assert.match(cookies, /does not currently set analytics or advertising cookies/i);

console.log('Story 3.104 Truthful Cookie Disclosure tests passed');
