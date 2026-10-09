const assert = require('assert');
const http = require('http');
const express = require('express');
const proxyaddr = require('proxy-addr');

function request(server, forwardedFor) {
  return new Promise((resolve, reject) => {
    const headers = forwardedFor === undefined ? {} : { 'X-Forwarded-For': forwardedFor };
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path: '/ip',
      method: 'GET',
      headers
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function fakeRequest(remoteAddress, forwardedFor) {
  return {
    socket: { remoteAddress },
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor }
  };
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

async function run() {
  const installed = require('proxy-addr/package.json');
  assert.strictEqual(installed.version, '2.0.8', 'the official CVE-2026-90711 fix must remain installed');

  // Regression cases published with proxy-addr 2.0.8 for GHSA-jqcg-44mw-7w3h.
  // A malformed short-prefix IPv4-mapped subnet must not trust arbitrary IPv4,
  // mapped IPv4, or native IPv6 candidates.
  const vulnerableShape = proxyaddr.compile(['::ffff:10.0.0.0/8']);
  for (const candidate of ['8.8.8.8', '10.0.0.1', '::ffff:8.8.8.8', '::ffff:10.0.0.1', '::1']) {
    assert.strictEqual(vulnerableShape(candidate), false, `${candidate} must not match a short-prefix mapped subnet`);
  }

  const validMappedSubnet = proxyaddr.compile(['::ffff:10.0.0.0/104']);
  assert.strictEqual(validMappedSubnet('10.0.0.1'), true);
  assert.strictEqual(validMappedSubnet('::ffff:10.0.0.1'), true);
  assert.strictEqual(validMappedSubnet('8.8.8.8'), false);

  const trustedPrivateProxy = proxyaddr.compile(['10.0.0.0/8']);
  assert.strictEqual(
    proxyaddr(fakeRequest('10.0.0.5', '198.51.100.25'), trustedPrivateProxy),
    '198.51.100.25',
    'a trusted proxy hop should expose its client address'
  );
  assert.strictEqual(
    proxyaddr(fakeRequest('203.0.113.50', '198.51.100.25'), trustedPrivateProxy),
    '203.0.113.50',
    'an untrusted socket peer must not make its forwarding header authoritative'
  );
  assert.strictEqual(
    proxyaddr(fakeRequest('::ffff:8.8.8.8', '198.51.100.25'), vulnerableShape),
    '::ffff:8.8.8.8',
    'a spoofed mapped peer must not become a trusted forwarding hop'
  );

  // Production intentionally trusts exactly one Render hop. The right-most
  // forwarding value is therefore authoritative; attacker-controlled or
  // malformed values farther left cannot replace it.
  const app = express();
  app.set('trust proxy', 1);
  app.get('/ip', (req, res) => res.json({ ip: req.ip, ips: req.ips }));
  const server = await listen(app);
  try {
    assert.deepStrictEqual(await request(server), {
      statusCode: 200,
      body: { ip: '127.0.0.1', ips: [] }
    });
    assert.deepStrictEqual(await request(server, '198.51.100.10'), {
      statusCode: 200,
      body: { ip: '198.51.100.10', ips: ['198.51.100.10'] }
    });
    assert.deepStrictEqual(await request(server, '203.0.113.9, 10.0.0.7'), {
      statusCode: 200,
      body: { ip: '10.0.0.7', ips: ['10.0.0.7'] }
    });
    assert.deepStrictEqual(await request(server, 'not-an-ip, 198.51.100.20'), {
      statusCode: 200,
      body: { ip: '198.51.100.20', ips: ['198.51.100.20'] }
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('Proxy address advisory regression tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
