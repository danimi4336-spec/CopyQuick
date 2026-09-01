const assert = require('assert');
const fs = require('fs');
const path = require('path');

const views = path.join(__dirname, '..', 'views');
const files = ['layout.ejs', 'signup.ejs', 'about.ejs', 'contact.ejs', 'dashboard.ejs'];
const source = files.map(file => fs.readFileSync(path.join(views, file), 'utf8')).join('\n');

for (const unsupported of [
  /high-converting copy/i,
  /copy that converts/i,
  /headlines that convert/i,
  /drive clicks and conversions/i,
  /better copy in seconds/i,
  /content and campaigns for your business instantly/i,
  /single piece of content in seconds/i
]) assert.doesNotMatch(source, unsupported);

assert.match(source, /Guided marketing planning and customer-ready content/);
assert.match(source, /clearer path from an early idea to useful, customer-ready content/);
assert.match(source, /ad headline drafts grounded in your approved direction/);
assert.match(source, /Create a single focused content draft/);

console.log('Story 3.100 Truthful Shared Messaging tests passed');
