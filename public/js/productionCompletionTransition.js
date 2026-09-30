(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CopyQuickProductionCompletionTransition = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  const TERMINAL_RUN_STATUSES = Object.freeze(['completed', 'partially_completed', 'failed', 'blocked', 'canceled']);

  function isTerminalRunStatus(status) {
    return TERMINAL_RUN_STATUSES.includes(String(status || ''));
  }

  function createCompletionTransition(options) {
    let transitionStarted = false;
    return function transitionForStatus(status) {
      if (transitionStarted || !isTerminalRunStatus(status)) return false;
      transitionStarted = true;
      options.stopPolling();
      options.navigate(options.targetUrl);
      return true;
    };
  }

  return { TERMINAL_RUN_STATUSES, isTerminalRunStatus, createCompletionTransition };
});
