const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function listTestFiles(testsDirectory) {
  return fs.readdirSync(testsDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.js'))
    .map(entry => entry.name)
    .sort();
}

function runRepositoryTests(options = {}) {
  const repositoryRoot = options.repositoryRoot || path.resolve(__dirname, '..');
  const testsDirectory = options.testsDirectory || path.join(repositoryRoot, 'tests');
  const spawn = options.spawnSync || spawnSync;
  const nodePath = options.nodePath || process.execPath;
  const environment = options.env || process.env;
  const logger = options.logger || console;
  const testFiles = listTestFiles(testsDirectory);

  if (!testFiles.length) {
    logger.error('No repository test files were found.');
    return 1;
  }

  for (const testFile of testFiles) {
    const relativePath = path.join('tests', testFile);
    const result = spawn(nodePath, [relativePath], {
      cwd: repositoryRoot,
      env: environment,
      stdio: 'inherit'
    });

    if (result.error) {
      logger.error(`Unable to run ${relativePath}.`);
      return 1;
    }
    if (result.status !== 0) {
      return Number.isInteger(result.status) ? result.status : 1;
    }
  }

  logger.log(`Complete repository suite passed (${testFiles.length} files).`);
  return 0;
}

if (require.main === module) {
  process.exitCode = runRepositoryTests();
}

module.exports = { listTestFiles, runRepositoryTests };
