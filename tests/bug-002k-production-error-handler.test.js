const assert = require('assert');
const express = require('express');
const http = require('http');
const { createGlobalErrorHandler, GENERIC_ERROR_MESSAGE } = require('../lib/errorHandler');

const SECRET_MESSAGE = 'Sensitive database path /Users/example/CopyQuick/db/copyquick.db leaked';

function request(server, url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      method: 'GET',
      path: url,
      headers
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ res, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.on('listening', resolve);
    server.on('error', reject);
  });
  return server;
}

function createTestApp(nodeEnv, loggedErrors) {
  const app = express();

  app.get('/boom', (req, res, next) => {
    const err = new Error(SECRET_MESSAGE);
    err.stack = `Error: ${SECRET_MESSAGE}\n    at forcedRoute (/Users/example/CopyQuick/server.js:123:45)`;
    next(err);
  });

  app.get('/teapot', (req, res, next) => {
    const err = new Error(SECRET_MESSAGE);
    err.status = 418;
    next(err);
  });

  app.use((err, req, res, next) => {
    const originalConsoleError = console.error;
    console.error = (...args) => {
      loggedErrors.push(args);
    };

    try {
      createGlobalErrorHandler({ getNodeEnv: () => nodeEnv })(err, req, res, next);
    } finally {
      console.error = originalConsoleError;
    }
  });

  return app;
}

function assertProductionBodyIsSafe(body) {
  assert(body.includes(GENERIC_ERROR_MESSAGE));
  assert(!body.includes(SECRET_MESSAGE), 'production response should not expose err.message');
  assert(!body.includes('forcedRoute'), 'production response should not expose stack frames');
  assert(!body.includes('/Users/example/CopyQuick'), 'production response should not expose local paths');
  assert(!body.includes('<pre'), 'production response should not include stack trace markup');
}

async function run() {
  const productionLogs = [];
  const productionServer = await listen(createTestApp('production', productionLogs));
  try {
    const htmlResponse = await request(productionServer, '/boom', { Accept: 'text/html' });
    assert.strictEqual(htmlResponse.res.statusCode, 500);
    assert.match(htmlResponse.res.headers['content-type'], /text\/html/);
    assertProductionBodyIsSafe(htmlResponse.body);

    const jsonResponse = await request(productionServer, '/boom', { Accept: 'application/json' });
    assert.strictEqual(jsonResponse.res.statusCode, 500);
    assert.match(jsonResponse.res.headers['content-type'], /application\/json/);
    assert.deepStrictEqual(JSON.parse(jsonResponse.body), { error: GENERIC_ERROR_MESSAGE });

    const jsonContentTypeResponse = await request(productionServer, '/boom', { 'Content-Type': 'application/json' });
    assert.strictEqual(jsonContentTypeResponse.res.statusCode, 500);
    assert.match(jsonContentTypeResponse.res.headers['content-type'], /application\/json/);
    assert.deepStrictEqual(JSON.parse(jsonContentTypeResponse.body), { error: GENERIC_ERROR_MESSAGE });

    const statusResponse = await request(productionServer, '/teapot', { Accept: 'application/json' });
    assert.strictEqual(statusResponse.res.statusCode, 418);
    assert.deepStrictEqual(JSON.parse(statusResponse.body), { error: GENERIC_ERROR_MESSAGE });

    assert(productionLogs.some((entry) => entry.includes('❌ SERVER ERROR:') && entry.some((item) => item instanceof Error && item.message === SECRET_MESSAGE)));
  } finally {
    productionServer.close();
  }

  const developmentLogs = [];
  const developmentServer = await listen(createTestApp('development', developmentLogs));
  try {
    const devResponse = await request(developmentServer, '/boom', { Accept: 'text/html' });
    assert.strictEqual(devResponse.res.statusCode, 500);
    assert(devResponse.body.includes(SECRET_MESSAGE));
    assert(devResponse.body.includes('forcedRoute'));
    assert(developmentLogs.some((entry) => entry.includes('❌ SERVER ERROR:')));
  } finally {
    developmentServer.close();
  }
}

run()
  .then(() => {
    console.log('BUG-002K production error handler tests passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
