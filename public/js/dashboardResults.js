(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(root);
  } else {
    root.CopyQuickDashboardResults = factory(root);
  }
})(typeof window !== 'undefined' ? window : globalThis, function(root) {
  function appendText(el, text) {
    el.textContent = text;
    return el;
  }

  function createElement(doc, tagName, className, text) {
    const el = doc.createElement(tagName);
    if (className) el.className = className;
    if (text !== undefined) appendText(el, text);
    return el;
  }

  function clearElement(el) {
    if (typeof el.replaceChildren === 'function') {
      el.replaceChildren();
      return;
    }

    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  function createCopyButton(doc, text, copyHandler) {
    const button = createElement(doc, 'button', 'result-action-btn');
    const label = createElement(doc, 'span', '', 'Copy');
    button.type = 'button';
    button.appendChild(doc.createTextNode('📋 '));
    button.appendChild(label);
    button.addEventListener('click', function() {
      const handler = copyHandler || root.copyText;
      if (typeof handler === 'function') {
        handler(text, button);
      }
    });
    return button;
  }

  function createResultCard(doc, result, index, copyHandler) {
    const text = String(result?.text || '');
    const card = createElement(doc, 'div', 'premium-card');
    card.style.animation = 'cardFadeIn 0.3s ease-out ' + (index * 0.1) + 's both';

    card.appendChild(createElement(doc, 'div', 'result-variation-label', 'Variation ' + (index + 1)));
    card.appendChild(createElement(doc, 'div', 'result-tone-badge', String(result?.tone || '')));
    card.appendChild(createElement(doc, 'div', 'result-body', text));

    const actions = createElement(doc, 'div', 'result-card-actions');
    actions.appendChild(createCopyButton(doc, text, copyHandler));
    card.appendChild(actions);

    return card;
  }

  function renderGenerationResults(container, results, options = {}) {
    if (!container) return;

    const doc = container.ownerDocument || root.document;
    const resultList = Array.isArray(results) ? results : [];
    const wrapper = createElement(doc, 'div', 'results-container mt-5');
    const header = createElement(doc, 'div', 'results-header');
    const heading = createElement(doc, 'h2', 'h3', 'Results');
    const historyLink = createElement(doc, 'a', 'btn btn-outline btn-sm', 'View All →');
    const success = createElement(doc, 'div', 'gen-success-msg', '✓ Done');
    const grid = createElement(doc, 'div', 'results-grid');

    historyLink.href = '/history';
    header.appendChild(heading);
    header.appendChild(historyLink);
    wrapper.appendChild(header);
    wrapper.appendChild(success);

    resultList.forEach(function(result, index) {
      grid.appendChild(createResultCard(doc, result, index, options.copyText));
    });

    wrapper.appendChild(grid);
    clearElement(container);
    container.appendChild(wrapper);
  }

  function renderError(container, message) {
    if (!container) return;

    const doc = container.ownerDocument || root.document;
    const alert = createElement(doc, 'div', 'alert alert-error', String(message || 'Failed'));
    clearElement(container);
    container.appendChild(alert);
  }

  return {
    createResultCard,
    renderError,
    renderGenerationResults
  };
});
