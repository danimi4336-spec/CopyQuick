const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const session = require('express-session');
const { initBundleAssetSelection } = require('../public/js/bundleAssetSelection');

process.env.DATABASE_URL = path.join('/tmp', 'copyquick-ux-001-test.sqlite');
process.env.SESSION_SECRET = 'ux-001-session-secret';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-secret';

for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.unlinkSync(process.env.DATABASE_URL + suffix);
  } catch (err) {
    // Temp database may not exist yet.
  }
}

const generatorState = { calls: [] };
const generatorModuleId = require.resolve('../lib/generator');
require.cache[generatorModuleId] = {
  id: generatorModuleId,
  filename: generatorModuleId,
  loaded: true,
  exports: {
    generateCopy: (input) => {
      generatorState.calls.push(input);
      return [{ text: `Generated ${input.contentType}`, tone: input.tone || 'professional' }];
    },
    getContentTypes: () => ({ subject_line: 'Subject Lines', sales_message: 'Sales Message' }),
    getTones: () => ['professional', 'casual']
  }
};

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  _tokens() {
    return this.element.className.split(/\s+/).filter(Boolean);
  }

  contains(token) {
    return this._tokens().includes(token);
  }

  add(token) {
    const tokens = this._tokens();
    if (!tokens.includes(token)) tokens.push(token);
    this.element.className = tokens.join(' ');
  }

  remove(token) {
    this.element.className = this._tokens().filter((value) => value !== token).join(' ');
  }

  toggle(token, force) {
    const shouldAdd = force === undefined ? !this.contains(token) : Boolean(force);
    if (shouldAdd) this.add(token);
    else this.remove(token);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this._textContent = '';
    this.checked = false;
    this.value = '';
    this.classList = new FakeClassList(this);
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'class') this.className = String(value);
    if (name === 'id') this.id = String(value);
  }

  getAttribute(name) {
    if (name === 'class') return this.className;
    if (name === 'id') return this.id || null;
    return this.attributes[name] || null;
  }

  addEventListener(type, handler) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(handler);
  }

  dispatch(type, event = {}) {
    const evt = {
      key: event.key,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      }
    };
    (this.listeners[type] || []).forEach((handler) => handler(evt));
    return evt;
  }

  click() {
    return this.dispatch('click');
  }

  keydown(key) {
    return this.dispatch('keydown', { key });
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector === 'input[name="assets"]') return this.tagName === 'input' && this.attributes.name === 'assets';
    return this.tagName === selector.toLowerCase();
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
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

class FakeDocument extends FakeElement {
  constructor() {
    super('document');
  }

  getElementById(id) {
    let found = null;
    const visit = (node) => {
      if (node.id === id) {
        found = node;
        return;
      }
      node.children.forEach(visit);
    };
    visit(this);
    return found;
  }
}

const assetDefs = [
  ['email_campaign:Email Campaign', 'Email Campaign', true],
  ['social_post:Facebook Post', 'Facebook Post', true],
  ['ad_headline:Facebook Ad', 'Facebook Ad', true],
  ['social_post:Google Search Ad', 'Google Search Ad', true],
  ['product_description:Product Description', 'Product Description', true],
  ['subject_line:Amazon Listing', 'Amazon Listing', false],
  ['blog_intro:SEO Package', 'SEO Package', false],
  ['blog_intro:Blog Article', 'Blog Article', false],
  ['cta:Landing Page', 'Landing Page', false],
  ['sales_message:Video Package', 'Video Package', false]
];

function createBundleDocument(selectedIndexes = [0, 1, 2, 3, 4]) {
  const doc = new FakeDocument();
  const grid = new FakeElement('div');
  grid.className = 'bundle-assets-grid';
  doc.appendChild(grid);

  const selectedSet = new Set(selectedIndexes);
  assetDefs.forEach(([value, label], index) => {
    const chip = new FakeElement('label');
    chip.className = selectedSet.has(index) ? 'bundle-asset-chip selected' : 'bundle-asset-chip';
    chip.setAttribute('data-asset-label', label);

    const input = new FakeElement('input');
    input.setAttribute('name', 'assets');
    input.setAttribute('tabindex', '-1');
    input.setAttribute('aria-hidden', 'true');
    input.value = value;
    input.checked = selectedSet.has(index);

    const badge = new FakeElement('span');
    badge.className = 'bundle-order-badge';

    const icon = new FakeElement('span');
    icon.className = 'chip-icon';
    icon.textContent = '*';

    const labelEl = new FakeElement('span');
    labelEl.className = 'chip-label';
    labelEl.textContent = label;

    chip.appendChild(input);
    chip.appendChild(badge);
    chip.appendChild(icon);
    chip.appendChild(labelEl);
    grid.appendChild(chip);
  });

  const count = new FakeElement('span');
  count.setAttribute('id', 'bundleCount');
  doc.appendChild(count);

  const toast = new FakeElement('div');
  toast.setAttribute('id', 'bundleSelectionToast');
  doc.appendChild(toast);

  const live = new FakeElement('div');
  live.setAttribute('id', 'bundleSelectionLive');
  doc.appendChild(live);

  return doc;
}

function chips(doc) {
  return doc.querySelectorAll('.bundle-asset-chip');
}

function checkedValues(doc) {
  return chips(doc).map((chip) => chip.querySelector('input[name="assets"]')).filter((input) => input.checked).map((input) => input.value);
}

function badgeTexts(doc) {
  return chips(doc).map((chip) => chip.querySelector('.bundle-order-badge').textContent);
}

function request(agent, method, url, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body || null;
    const payload = body ? new URLSearchParams(body).toString() : '';
    const headers = { ...(options.headers || {}) };
    if (payload) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (agent.cookie) headers.Cookie = agent.cookie;

    const req = http.request({
      hostname: '127.0.0.1',
      port: agent.server.address().port,
      method,
      path: url,
      headers
    }, (res) => {
      const setCookie = res.headers['set-cookie'];
      if (setCookie?.length) agent.cookie = setCookie.map((cookie) => cookie.split(';')[0]).join('; ');
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => resolve({ res, body: responseBody }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.on('listening', resolve);
    server.on('error', reject);
  });
  return server;
}

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const { createCsrfProtection } = require('../lib/csrf');
const generationRoutes = require('../routes/generations');

function createUser(db) {
  return db.prepare(`
    INSERT INTO users (email, name, plan_tier, monthly_limit, generations_used)
    VALUES (?, ?, 'free', 10, 0)
  `).run('ux-001@example.com', 'UX User').lastInsertRowid;
}

async function getToken(agent) {
  const response = await request(agent, 'GET', '/csrf-token');
  return JSON.parse(response.body).csrfToken;
}

async function withServer(userId, fn) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: true }));
  app.use((req, res, next) => {
    const db = getDb();
    req.session.userId = userId;
    res.locals.user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    next();
  });
  app.use(createCsrfProtection());
  app.get('/csrf-token', (req, res) => res.json({ csrfToken: req.csrfToken() }));
  app.use(generationRoutes);

  const server = await listen(app);
  const agent = { server, cookie: '' };
  try {
    await fn(agent);
  } finally {
    server.close();
  }
}

async function run() {
  let doc = createBundleDocument();
  let controller = initBundleAssetSelection({ document: doc, maxSelected: 5, toastDuration: 1 });
  assert.strictEqual(chips(doc).length, 10, 'all 10 asset tiles should exist');
  chips(doc).forEach((chip) => {
    assert.strictEqual(chip.getAttribute('tabindex'), '0');
    assert.strictEqual(chip.getAttribute('role'), 'option');
    const input = chip.querySelector('input[name="assets"]');
    assert.strictEqual(input.getAttribute('tabindex'), '-1');
    assert.strictEqual(input.getAttribute('aria-hidden'), 'true');
    assert.notStrictEqual(input.getAttribute('disabled'), 'true');
  });
  assert.deepStrictEqual(controller.getSelectionOrder(), assetDefs.slice(0, 5).map(([value]) => value));
  assert.strictEqual(doc.getElementById('bundleCount').textContent, 'Selected Assets (5 / 5)');
  assert.deepStrictEqual(badgeTexts(doc).slice(0, 5), ['1', '2', '3', '4', '5']);

  doc = createBundleDocument([]);
  controller = initBundleAssetSelection({ document: doc, maxSelected: 5, toastDuration: 1 });
  assert.strictEqual(doc.getElementById('bundleCount').textContent, 'Selected Assets (0 / 5)');
  chips(doc)[5].click();
  assert.strictEqual(doc.getElementById('bundleCount').textContent, 'Selected Assets (1 / 5)');
  assert.strictEqual(chips(doc)[5].getAttribute('aria-selected'), 'true');
  chips(doc)[5].click();
  assert.strictEqual(doc.getElementById('bundleCount').textContent, 'Selected Assets (0 / 5)');
  assert.strictEqual(chips(doc)[5].getAttribute('aria-selected'), 'false');

  doc = createBundleDocument();
  controller = initBundleAssetSelection({ document: doc, maxSelected: 5, toastDuration: 1 });
  chips(doc)[5].click();
  assert.deepStrictEqual(controller.getSelectionOrder(), assetDefs.slice(1, 6).map(([value]) => value));
  assert.strictEqual(checkedValues(doc).length, 5);
  assert(!checkedValues(doc).includes(assetDefs[0][0]));
  assert(checkedValues(doc).includes(assetDefs[5][0]));
  assert.deepStrictEqual(badgeTexts(doc).slice(1, 6), ['1', '2', '3', '4', '5']);
  assert.strictEqual(doc.getElementById('bundleSelectionToast').textContent, 'Maximum of 5 assets. Replaced "Email Campaign" with "Amazon Listing".');
  assert.strictEqual(doc.getElementById('bundleSelectionToast').classList.contains('visible'), true);
  assert.strictEqual(doc.getElementById('bundleSelectionLive').textContent, 'Amazon Listing selected. Email Campaign replaced.');

  chips(doc)[6].click();
  assert.deepStrictEqual(controller.getSelectionOrder(), assetDefs.slice(2, 7).map(([value]) => value));
  assert(!checkedValues(doc).includes(assetDefs[1][0]));
  assert(checkedValues(doc).includes(assetDefs[6][0]));

  chips(doc)[4].click();
  assert.strictEqual(checkedValues(doc).length, 4);
  assert.deepStrictEqual(badgeTexts(doc).filter(Boolean), ['1', '2', '3', '4']);

  const enterEvent = chips(doc)[7].keydown('Enter');
  assert.strictEqual(enterEvent.defaultPrevented, true);
  assert(checkedValues(doc).includes(assetDefs[7][0]));
  assert(controller.getSelectionOrder().includes(assetDefs[7][0]));
  assert.strictEqual(chips(doc)[7].getAttribute('aria-selected'), 'true');
  const spaceEvent = chips(doc)[7].keydown(' ');
  assert.strictEqual(spaceEvent.defaultPrevented, true);
  assert(!checkedValues(doc).includes(assetDefs[7][0]));
  assert(!controller.getSelectionOrder().includes(assetDefs[7][0]));
  assert.strictEqual(chips(doc)[7].getAttribute('aria-selected'), 'false');

  const beforeHiddenCheckboxState = {
    checked: checkedValues(doc),
    order: controller.getSelectionOrder(),
    counter: doc.getElementById('bundleCount').textContent
  };
  const hiddenInput = chips(doc)[8].querySelector('input[name="assets"]');
  assert.strictEqual(hiddenInput.getAttribute('tabindex'), '-1');
  assert.strictEqual(hiddenInput.getAttribute('aria-hidden'), 'true');
  assert.notStrictEqual(hiddenInput.getAttribute('disabled'), 'true');
  assert.deepStrictEqual(checkedValues(doc), beforeHiddenCheckboxState.checked);
  assert.deepStrictEqual(controller.getSelectionOrder(), beforeHiddenCheckboxState.order);
  assert.strictEqual(doc.getElementById('bundleCount').textContent, beforeHiddenCheckboxState.counter);

  assert.strictEqual(new Set(checkedValues(doc)).size, checkedValues(doc).length);

  const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'views', 'dashboard.ejs'), 'utf8');
  assert(dashboardSource.includes('Selected Assets (5 / 5)'));
  assert(dashboardSource.includes('bundle-selection-toast'));
  assert(dashboardSource.includes('bundle-order-badge'));
  assert(dashboardSource.includes('tabindex="-1" aria-hidden="true"'));
  assert(dashboardSource.includes('aria-live="polite"'));
  assert(dashboardSource.includes('mode-bundle input[name="assets"]:checked'));
  assert(dashboardSource.includes('d.append(\'generationType\',\'bundle\')'));
  assert(dashboardSource.includes('name="_csrf" value="<%= csrfToken %>"'));
  assert(dashboardSource.includes('@media(max-width:768px)'));
  assert(dashboardSource.includes('.bundle-assets-grid{grid-template-columns:repeat(2,minmax(0,1fr));}'));

  initDb();
  const db = getDb();
  const userId = createUser(db);
  await withServer(userId, async (agent) => {
    const token = await getToken(agent);
    const response = await request(agent, 'POST', '/dashboard/generate', {
      headers: { Accept: 'application/json', 'X-CSRF-Token': token },
      body: {
        productDescription: 'Bundle product',
        targetAudience: 'Founders',
        tone: 'professional',
        assets: checkedValues(doc).join(','),
        generationType: 'bundle'
      }
    });
    assert.strictEqual(response.res.statusCode, 200);
  });

  const generation = db.prepare('SELECT generation_type FROM generations WHERE user_id = ?').get(userId);
  assert.strictEqual(generation.generation_type, 'bundle');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE user_id = ?').get(userId).count, 1);
  assert.strictEqual(db.prepare('SELECT COALESCE(SUM(usage_count), 0) AS count FROM usage_periods WHERE user_id = ?').get(userId).count, 1);
  assert.strictEqual(db.prepare('SELECT generations_used FROM users WHERE id = ?').get(userId).generations_used, 1);
  assert(generatorState.calls.length >= 1);
}

run()
  .then(() => {
    console.log('UX-001 intelligent bundle selection tests passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
