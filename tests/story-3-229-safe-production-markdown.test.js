const assert = require('assert');
const { renderSafeMarkdown } = require('../lib/safeMarkdown');

const rendered = renderSafeMarkdown('## Useful heading\n\nA clear paragraph.\n\n- First item\n- Second item');
assert.match(rendered, /<h3>Useful heading<\/h3>/);
assert.match(rendered, /<p>A clear paragraph\.<\/p>/);
assert.match(rendered, /<ul><li>First item<\/li><li>Second item<\/li><\/ul>/);

const unsafe = renderSafeMarkdown('## <script>alert("x")</script>\n\n<img src=x onerror=alert(1)>');
assert.doesNotMatch(unsafe, /<script>|<img/i);
assert.match(unsafe, /&lt;script&gt;/);
assert.match(unsafe, /&lt;img/);

console.log('Story 3.229 Safe Production Markdown tests passed');
