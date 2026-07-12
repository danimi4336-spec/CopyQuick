const assert = require('assert');
const { renderGenerationResults } = require('../public/js/dashboardResults');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class FakeTextNode {
  constructor(text) {
    this.textContent = String(text);
  }

  get innerHTML() {
    return escapeHtml(this.textContent);
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toLowerCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.className = '';
    this.style = {};
    this.listeners = {};
    this.attributes = {};
    this._textContent = '';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this._textContent = '';
    this.children = children;
  }

  addEventListener(type, handler) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(handler);
  }

  click() {
    (this.listeners.click || []).forEach((handler) => handler({ target: this }));
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join('');
  }

  set href(value) {
    this.attributes.href = value;
  }

  set type(value) {
    this.attributes.type = value;
  }

  get innerHTML() {
    return escapeHtml(this._textContent) + this.children.map((child) => {
      if (child instanceof FakeTextNode) return child.innerHTML;
      return `<${child.tagName}>${child.innerHTML}</${child.tagName}>`;
    }).join('');
  }

  matches(selector) {
    if (selector.startsWith('.')) {
      return this.className.split(/\s+/).includes(selector.slice(1));
    }

    return this.tagName === selector.toLowerCase();
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      if (!(node instanceof FakeElement)) return;
      if (node.matches(selector)) matches.push(node);
      node.children.forEach(visit);
    };
    this.children.forEach(visit);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  createTextNode(text) {
    return new FakeTextNode(text);
  }
}

const dangerousImage = '<img src=x onerror=alert(1)>';
const dangerousScript = '<script>alert(1)</script>';
const multiline = 'Line one\nLine two\nLine three';
const copySample = 'Copy this <b>exact</b>\nwith line breaks';

['quick', 'bundle', 'campaign'].forEach((mode) => {
  const doc = new FakeDocument();
  const container = doc.createElement('div');
  let copiedText = null;

  renderGenerationResults(container, [
    { text: dangerousImage, tone: 'professional' },
    { text: dangerousScript, tone: 'casual' },
    { text: multiline, tone: 'urgent' },
    { text: copySample, tone: 'inspirational' }
  ], {
    copyText(text) {
      copiedText = text;
    }
  });

  assert.strictEqual(container.querySelectorAll('img').length, 0, `${mode} should not create image elements`);
  assert.strictEqual(container.querySelectorAll('script').length, 0, `${mode} should not create script elements`);
  assert(container.textContent.includes(dangerousImage), `${mode} should render image HTML as visible text`);
  assert(container.textContent.includes(dangerousScript), `${mode} should render script HTML as visible text`);
  assert(container.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'), `${mode} should escape image markup`);
  assert(container.innerHTML.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), `${mode} should escape script markup`);

  const resultBodies = container.querySelectorAll('.result-body');
  assert.strictEqual(resultBodies[2].textContent, multiline, `${mode} should preserve multiline copy text`);

  const copyButtons = container.querySelectorAll('.result-action-btn');
  copyButtons[3].click();
  assert.strictEqual(copiedText, copySample, `${mode} should copy the exact original text`);
});

console.log('Dashboard result renderer tests passed');
