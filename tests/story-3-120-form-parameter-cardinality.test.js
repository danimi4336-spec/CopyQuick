const assert = require('assert');
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createGlobalErrorHandler } = require('../lib/errorHandler');
const {
  BROWSER_REQUEST_BODY_LIMIT,
  BROWSER_FORM_PARAMETER_LIMIT
} = require('../lib/requestBodyLimits');

function request(server, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json'
      }
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: responseBody }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function run() {
  assert.strictEqual(BROWSER_FORM_PARAMETER_LIMIT, 100);
  const events = [];
  const app = express();
  app.use(express.urlencoded({
    extended: true,
    limit: BROWSER_REQUEST_BODY_LIMIT,
    parameterLimit: BROWSER_FORM_PARAMETER_LIMIT
  }));
  app.post('/', (req, res) => res.json({ count: Object.keys(req.body).length }));
  app.use(createGlobalErrorHandler({ getNodeEnv: () => 'production', logger: (event) => events.push(event) }));

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.on('error', reject);
  });
  try {
    const atLimit = new URLSearchParams(Array.from({ length: 100 }, (_, index) => [`field${index}`, 'value'])).toString();
    assert.strictEqual((await request(server, atLimit)).statusCode, 200);

    const overLimit = `${atLimit}&field100=value`;
    const rejected = await request(server, overLimit);
    assert.strictEqual(rejected.statusCode, 413);
    assert.deepStrictEqual(events.map((event) => event.code), ['TOO_MANY_FORM_PARAMETERS']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(serverSource, /parameterLimit: BROWSER_FORM_PARAMETER_LIMIT/);
  console.log('Story 3.120 form parameter cardinality tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
