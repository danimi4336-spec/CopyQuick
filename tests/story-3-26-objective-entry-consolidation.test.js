const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const dashboard = fs.readFileSync(path.join(__dirname, '..', 'views', 'dashboard.ejs'), 'utf8');

  assert.match(dashboard, /selectedJourneyId==='launch_product'/);
  assert.match(dashboard, /Start Launch a New Product →/);
  assert.match(dashboard, /href','\/welcome\?goal=launch_product'/);
  assert.match(dashboard, /fetch\('\/welcome'/);
  assert.match(dashboard, /body: 'goal=launch_product'/);
  assert.match(dashboard, /window\.CopyQuickCsrf\.headers/);
  assert.match(dashboard, /window\.location\.assign\(response\.url \|\| '\/discovery'\)/);
  assert.match(dashboard, /window\.location\.assign\('\/welcome\?goal=launch_product'\)/);

  const clickHandlerStart = dashboard.indexOf("bjCtaBtn.addEventListener('click'");
  const launchBranchStart = dashboard.indexOf("if(selectedJourneyId==='launch_product')", clickHandlerStart);
  const legacySaveStart = dashboard.indexOf('if(selectedJourneyId){', launchBranchStart);
  const launchBranch = dashboard.slice(launchBranchStart, legacySaveStart);
  assert.doesNotMatch(launchBranch, /brand-brain|dashboard\/update-goal/);

  assert.match(dashboard, /if\(brainPct<100\)return'Continue to Brand Brain'/,
    'legacy objectives should retain their current Brand Brain path');
  console.log('Story 3.26 Objective Entry Consolidation tests passed');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
