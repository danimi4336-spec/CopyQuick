const assert = require('assert');
const {
  DEFAULT_REMOTE_DELETE_LIMIT,
  MAX_REMOTE_DELETE_LIMIT,
  applyRemoteRetention
} = require('../lib/offsiteBackup');

const prefix = 'copyquick/production';
function key(index) {
  return `${prefix}/2026/08/27/copyquick-2026-08-27T010000Z-${index + 1}-v1.cqbackup`;
}

async function run() {
  assert.strictEqual(DEFAULT_REMOTE_DELETE_LIMIT, 100);
  assert.strictEqual(MAX_REMOTE_DELETE_LIMIT, 1000);

  const objects = Array.from({ length: 105 }, (_, index) => ({
    key: key(index),
    sizeBytes: 1,
    lastModified: new Date(2026, 7, 27, 1, 0, index)
  }));
  const deleted = [];
  const batched = await applyRemoteRetention({
    storage: {
      listObjects: async () => objects,
      deleteObject: async objectKey => { deleted.push(objectKey); }
    },
    config: { prefix, retention: 0, retentionDeleteLimit: 3 }
  });
  assert.strictEqual(batched.deletedCount, 3);
  assert.strictEqual(batched.remainingCount, 102);
  assert.strictEqual(batched.failures.length, 0);
  assert.strictEqual(deleted.length, 3);

  let failedDeleteCalls = 0;
  const failed = await applyRemoteRetention({
    storage: {
      listObjects: async () => objects.slice(0, 3),
      deleteObject: async () => {
        failedDeleteCalls += 1;
        throw Object.assign(new Error('private provider detail'), { code: 'ACCESS_DENIED' });
      }
    },
    config: { prefix, retention: 0, retentionDeleteLimit: 3 }
  });
  assert.strictEqual(failedDeleteCalls, 1, 'retention must stop after its first provider delete failure');
  assert.strictEqual(failed.deletedCount, 0);
  assert.strictEqual(failed.remainingCount, 3);
  assert.deepStrictEqual(failed.failures, [{ code: 'ACCESS_DENIED' }]);
  assert.doesNotMatch(JSON.stringify(failed), /private provider detail/);

  console.log('Story 3.158 Bounded Off-site Retention tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
