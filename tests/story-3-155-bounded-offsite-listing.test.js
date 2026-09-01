const assert = require('assert');
const {
  DEFAULT_MAX_LISTED_OBJECTS,
  MAX_LISTED_OBJECTS,
  S3CompatibleStorage,
  resolveOffsiteTransportConfig
} = require('../lib/offsiteStorage');

assert.strictEqual(resolveOffsiteTransportConfig({}).maxListedObjects, DEFAULT_MAX_LISTED_OBJECTS);
assert.strictEqual(resolveOffsiteTransportConfig({
  OFFSITE_STORAGE_MAX_LISTED_OBJECTS: String(MAX_LISTED_OBJECTS)
}).maxListedObjects, MAX_LISTED_OBJECTS);
assert.strictEqual(resolveOffsiteTransportConfig({
  OFFSITE_STORAGE_MAX_LISTED_OBJECTS: String(MAX_LISTED_OBJECTS + 1)
}).maxListedObjects, DEFAULT_MAX_LISTED_OBJECTS);

async function run() {
  let calls = 0;
  const bounded = new S3CompatibleStorage({
    bucket: 'local', maxListedObjects: 3,
    client: { send: async () => {
      calls += 1;
      return calls === 1
        ? { Contents: [{ Key: 'a', Size: 1 }, { Key: 'b', Size: 1 }], IsTruncated: true, NextContinuationToken: 'next' }
        : { Contents: [{ Key: 'c', Size: 1 }, { Key: 'd', Size: 1 }], IsTruncated: false };
    } }
  });
  await assert.rejects(
    bounded.listObjects('prefix/'),
    error => error.code === 'REMOTE_LIST_LIMIT_EXCEEDED'
  );
  assert.strictEqual(calls, 2);

  let cycleCalls = 0;
  const cyclic = new S3CompatibleStorage({
    bucket: 'local', maxListedObjects: 10,
    client: { send: async () => {
      cycleCalls += 1;
      return { Contents: [], IsTruncated: true, NextContinuationToken: 'same-token' };
    } }
  });
  await assert.rejects(
    cyclic.listObjects('prefix/'),
    error => error.code === 'REMOTE_LIST_PAGINATION_INVALID'
  );
  assert.strictEqual(cycleCalls, 2, 'a repeated continuation token must terminate pagination');

  for (const invalidPage of [
    { Contents: [{ Key: 'partial', Size: 1 }], IsTruncated: true },
    { Contents: [], IsTruncated: true, NextContinuationToken: '' },
    { Contents: [], IsTruncated: 'true', NextContinuationToken: 'next' }
  ]) {
    const incomplete = new S3CompatibleStorage({
      bucket: 'local', maxListedObjects: 10,
      client: { send: async () => invalidPage }
    });
    await assert.rejects(
      incomplete.listObjects('prefix/'),
      error => error.code === 'REMOTE_LIST_PAGINATION_INVALID'
    );
  }

  let page = 0;
  const valid = new S3CompatibleStorage({
    bucket: 'local', maxListedObjects: 3,
    client: { send: async () => {
      page += 1;
      return page === 1
        ? { Contents: [{ Key: 'a', Size: 1 }], IsTruncated: true, NextContinuationToken: 'second' }
        : { Contents: [{ Key: 'b', Size: 2 }], IsTruncated: false };
    } }
  });
  assert.deepStrictEqual(await valid.listObjects('prefix/'), [
    { key: 'a', sizeBytes: 1, lastModified: null },
    { key: 'b', sizeBytes: 2, lastModified: null }
  ]);

  console.log('Story 3.155 Bounded Off-site Listing tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
