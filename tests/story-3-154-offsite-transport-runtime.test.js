const assert = require('assert');
const {
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_ATTEMPTS,
  MAX_CONNECTION_TIMEOUT_MS,
  MAX_REQUEST_TIMEOUT_MS,
  createOffsiteStorageClient,
  resolveOffsiteTransportConfig
} = require('../lib/offsiteStorage');

const defaults = resolveOffsiteTransportConfig({});
assert.deepStrictEqual(defaults, {
  connectionTimeoutMs: DEFAULT_CONNECTION_TIMEOUT_MS,
  requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  maxAttempts: DEFAULT_MAX_ATTEMPTS
});
assert.deepStrictEqual(resolveOffsiteTransportConfig({
  OFFSITE_STORAGE_CONNECTION_TIMEOUT_MS: String(MAX_CONNECTION_TIMEOUT_MS),
  OFFSITE_STORAGE_REQUEST_TIMEOUT_MS: String(MAX_REQUEST_TIMEOUT_MS),
  OFFSITE_STORAGE_MAX_ATTEMPTS: String(MAX_ATTEMPTS)
}), {
  connectionTimeoutMs: MAX_CONNECTION_TIMEOUT_MS,
  requestTimeoutMs: MAX_REQUEST_TIMEOUT_MS,
  maxAttempts: MAX_ATTEMPTS
});
assert.deepStrictEqual(resolveOffsiteTransportConfig({
  OFFSITE_STORAGE_CONNECTION_TIMEOUT_MS: String(MAX_CONNECTION_TIMEOUT_MS + 1),
  OFFSITE_STORAGE_REQUEST_TIMEOUT_MS: String(MAX_REQUEST_TIMEOUT_MS + 1),
  OFFSITE_STORAGE_MAX_ATTEMPTS: String(MAX_ATTEMPTS + 1)
}), defaults);
assert.deepStrictEqual(resolveOffsiteTransportConfig({
  OFFSITE_STORAGE_CONNECTION_TIMEOUT_MS: '999',
  OFFSITE_STORAGE_REQUEST_TIMEOUT_MS: '4999',
  OFFSITE_STORAGE_MAX_ATTEMPTS: '0'
}), defaults);

let handlerConfig;
let clientConfig;
class FakeHandler {
  constructor(config) { handlerConfig = config; }
}
class FakeClient {
  constructor(config) { clientConfig = config; }
}
const client = createOffsiteStorageClient({
  endpoint: 'https://local.invalid',
  region: 'auto',
  accessKeyId: 'local-access-key',
  secretAccessKey: 'local-secret-key',
  env: {
    OFFSITE_STORAGE_CONNECTION_TIMEOUT_MS: '7000',
    OFFSITE_STORAGE_REQUEST_TIMEOUT_MS: '90000',
    OFFSITE_STORAGE_MAX_ATTEMPTS: '2'
  },
  S3ClientApi: FakeClient,
  NodeHttpHandlerApi: FakeHandler
});
assert(client instanceof FakeClient);
assert.deepStrictEqual(handlerConfig, {
  connectionTimeout: 7000,
  requestTimeout: 90000,
  throwOnRequestTimeout: true
});
assert.strictEqual(clientConfig.maxAttempts, 2);
assert(clientConfig.requestHandler instanceof FakeHandler);
assert.strictEqual(clientConfig.endpoint, 'https://local.invalid');

console.log('Story 3.154 Off-site Transport Runtime tests passed');
