function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(value) {
  return escapeHtml(value).replace(/https:\/\/[^\s<]+/g, function(candidate) {
    const trailing = candidate.match(/[),.;:!?]+$/)?.[0] || '';
    const url = candidate.slice(0, candidate.length - trailing.length);
    try {
      const parsed = new URL(url.replace(/&amp;/g, '&'));
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return candidate;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${trailing}`;
    } catch (_) { return candidate; }
  });
}

function renderSafeMarkdown(value) {
  const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let paragraph = [];
  let list = [];

  const flushParagraph = function() {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.map(line => renderInline(line.trim())).join(' ')}</p>`);
    paragraph = [];
  };
  const flushList = function() {
    if (!list.length) return;
    html.push(`<ul>${list.map(item => `<li>${renderInline(item)}</li>`).join('')}</ul>`);
    list = [];
  };

  lines.forEach(function(line) {
    const heading = line.match(/^\s*(#{1,3})\s+(.+?)\s*$/);
    const bullet = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length + 1, 4);
      html.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
    } else if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  });
  flushParagraph();
  flushList();
  return html.join('');
}

module.exports = { escapeHtml, renderInline, renderSafeMarkdown };
