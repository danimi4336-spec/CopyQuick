const assert = require('assert');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const { createContactHandler } = require('../lib/contactProtection');

const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'contact.ejs'), 'utf8');
function render(confirmationSent) {
  return ejs.render(template, { sent: true, confirmationSent, error: null, csrfToken: 'csrf' });
}

assert.match(render(true), /A confirmation was sent to your email/);
assert.doesNotMatch(render(true), /could not send the email confirmation/);
assert.match(render(false), /could not send the email confirmation, but your message was delivered/);
assert.doesNotMatch(template, /within 24 (?:business )?hours/i);

async function invoke(autoReplyDelivered) {
  let rendered;
  const handler = createContactHandler({
    sendContactFormEmails: async () => ({ ticketNumber: 'CQ-TEST', adminDelivered: true, autoReplyDelivered })
  });
  await handler({
    body: { name: 'Ada', email: 'ada@example.com', subject: 'Question', message: 'Hello' },
    headers: {},
    ip: '127.0.0.1',
    get: () => 'text/html'
  }, {
    render: (_view, options) => { rendered = options; },
    status() { return this; }
  });
  return rendered;
}

(async () => {
  assert.strictEqual((await invoke(true)).confirmationSent, true);
  assert.strictEqual((await invoke(false)).confirmationSent, false);

  const emailSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'email.js'), 'utf8');
  assert.doesNotMatch(emailSource, /Within 24 business hours|respond within 24 business hours/i);
  assert.match(emailSource, /review your message as soon as possible/i);
  console.log('Story 3.103 Truthful Contact Acknowledgement tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
