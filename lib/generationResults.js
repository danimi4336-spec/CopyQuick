function parseStoredGenerationResults(serialized) {
  if (typeof serialized !== 'string') return null;
  try {
    const results = JSON.parse(serialized);
    if (!Array.isArray(results) || !results.every(function(result) {
      return result && typeof result === 'object' && !Array.isArray(result) &&
        typeof result.text === 'string' && typeof result.tone === 'string';
    })) return null;
    return results;
  } catch (error) {
    return null;
  }
}

module.exports = { parseStoredGenerationResults };
