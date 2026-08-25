const generator = require('./generator');

function strategySummary(strategySnapshot) {
  return Object.entries(strategySnapshot || {}).map(function(entry) {
    const value = entry[1]?.value;
    if (!value || value === 'Unknown') return null;
    const label = entry[0].replace(/([A-Z])/g, ' $1').replace(/^./, function(char) { return char.toUpperCase(); });
    return `${label}: ${Array.isArray(value) ? value.join('; ') : value}`;
  }).filter(Boolean).join('\n');
}

function dependencySummary(dependencyOutputs) {
  return (dependencyOutputs || []).map(function(dependency) {
    const text = (dependency.result || []).map(function(item) { return item.text; }).filter(Boolean).join('\n');
    return `${dependency.title}:\n${text}`;
  }).join('\n\n').slice(0, 12000);
}

function generateDeliverable({ job, productionRun, dependencyOutputs = [], handler, generatorApi = generator }) {
  if (!handler) {
    const error = new Error('Unsupported production deliverable');
    error.code = 'UNSUPPORTED_DELIVERABLE';
    error.permanent = true;
    throw error;
  }
  const strategy = job.strategySnapshot || productionRun.strategySnapshot || {};
  const primaryCustomer = strategy.primaryCustomer?.value;
  const communicationStyle = strategy.communicationStyle?.value;
  const inputText = [
    `Create the approved ${job.title} deliverable.`,
    `Strategic direction: ${job.strategic_direction}`,
    strategySummary(strategy) ? `Approved strategy:\n${strategySummary(strategy)}` : '',
    dependencyOutputs.length ? `Completed prerequisite outputs:\n${dependencySummary(dependencyOutputs)}` : ''
  ].filter(Boolean).join('\n\n');
  const tone = typeof communicationStyle === 'string' ? communicationStyle.slice(0, 160) : 'professional';
  const results = generatorApi.generateCopy({
    productDescription: inputText,
    targetAudience: primaryCustomer || '',
    contentType: handler.contentType,
    tone
  });
  if (!Array.isArray(results) || !results.length || results.some(function(item) { return !item?.text; })) {
    const error = new Error('Generator returned no usable production output');
    error.code = 'INVALID_GENERATION_OUTPUT';
    throw error;
  }
  const wordCount = results.reduce(function(sum, item) {
    return sum + item.text.split(/\s+/).filter(Boolean).length;
  }, 0);
  return {
    title: job.title,
    inputText,
    contentType: handler.contentType,
    tone: results[0].tone || 'professional',
    results,
    wordCount,
    generationType: 'production',
    goal: productionRun.objective
  };
}

module.exports = {
  generateDeliverable
};
