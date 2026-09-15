require('dotenv').config();
const { evaluateDeploymentReadiness } = require('../lib/deploymentReadiness');

const result = evaluateDeploymentReadiness(process.env);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ready) process.exitCode = 1;
