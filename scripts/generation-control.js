#!/usr/bin/env node
const {
  PAUSED,
  RUNNING,
  getGenerationControlState,
  setGenerationControlMode
} = require('../lib/generationControls');

function selectedAction(argv) {
  if (argv.some(value => !['--status', '--pause', '--resume'].includes(value))) return null;
  const actions = argv.filter(value => ['--status', '--pause', '--resume'].includes(value));
  if (actions.length > 1) return null;
  return actions[0] || '--status';
}

function safeSummary(state) {
  return {
    mode: state.mode,
    code: state.code,
    updatedAt: state.updatedAt || null
  };
}

function main(argv = process.argv.slice(2)) {
  const action = selectedAction(argv);
  if (!action) {
    console.error(JSON.stringify({ status: 'failed', code: 'GENERATION_CONTROL_ACTION_INVALID' }));
    process.exitCode = 2;
    return;
  }
  try {
    const state = action === '--pause'
      ? setGenerationControlMode(PAUSED)
      : action === '--resume'
        ? setGenerationControlMode(RUNNING)
        : getGenerationControlState();
    console.log(JSON.stringify(safeSummary(state)));
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', code: error.code || 'GENERATION_CONTROL_FAILED' }));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { main, safeSummary, selectedAction };
