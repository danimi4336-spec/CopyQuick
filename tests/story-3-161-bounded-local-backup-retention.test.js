const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  applyRetention,
  listRecognizedBackups
} = require('../lib/databaseBackup');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-story-3-161-'));

try {
  for (let day = 1; day <= 8; day += 1) {
    const date = String(day).padStart(2, '0');
    fs.writeFileSync(path.join(root, `copyquick-2026-08-${date}T000000Z.db`), 'backup');
  }
  fs.writeFileSync(path.join(root, 'operator-notes.txt'), 'preserve');

  assert.throws(
    () => listRecognizedBackups(root, fs, { maxEntries: 8 }),
    error => error.code === 'BACKUP_DIRECTORY_ENTRY_LIMIT_EXCEEDED'
  );

  const first = applyRetention({
    backupDirectory: root,
    databasePath: path.join(root, '..', 'copyquick.db'),
    retention: 2,
    retentionDeleteLimit: 3,
    maxDirectoryEntries: 20
  });
  assert.strictEqual(first.deleted.length, 3);
  assert.strictEqual(first.remainingCount, 3);
  assert(fs.existsSync(path.join(root, 'operator-notes.txt')));

  const second = applyRetention({
    backupDirectory: root,
    databasePath: path.join(root, '..', 'copyquick.db'),
    retention: 2,
    retentionDeleteLimit: 3,
    maxDirectoryEntries: 20
  });
  assert.strictEqual(second.deleted.length, 3);
  assert.strictEqual(second.remainingCount, 0);
  assert.strictEqual(listRecognizedBackups(root).length, 2);

  console.log('Story 3.161 Bounded Local Backup Retention tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
