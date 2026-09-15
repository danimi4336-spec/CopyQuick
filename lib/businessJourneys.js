// Compatibility facade for existing routes. Objective registration and
// availability now live in the shared framework, while this module preserves
// its historical public surface exactly.
const { objectiveUniverse, getObjective, getAvailableObjective } = require('./objectiveFramework');

module.exports = { objectiveUniverse, getObjective, getAvailableObjective };
