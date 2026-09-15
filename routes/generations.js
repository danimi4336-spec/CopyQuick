const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { generationActionRateLimit } = require('../lib/generationProtection');
const { requireGenerationAvailable } = require('../lib/generationControls');
const { getDb } = require('../db/database');
const { requireAuth } = require('./auth');
const generator = require('../lib/generator');
const { generateCopy, getContentTypes, getTones } = generator;
const { isValidContentType } = require('../lib/contentTypes');
const { getProductionContract } = require('../lib/productionContracts');
const { generateDeliverable } = require('../lib/generationService');
const { loadDependencyOutputs } = require('../lib/productionExecution');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');
const { parseJob, parseStrategySnapshot } = require('../lib/productionState');
const { bundleAssets, brandVoices, audiencePresets, resolveBundleAsset } = require('../lib/generatorModes');
const { GENERATION_METADATA_LIMITS, boundedQueryText, buildPaginationPages, parseHistoryPage, validateOptionalText } = require('../lib/generationMetadata');
const { parseStoredGenerationResults } = require('../lib/generationResults');
const { parsePositiveIntegerId } = require('../lib/httpIdentifiers');
const { writeOperationalEvent } = require('../lib/operationalLogger');
const { getLatestProductionResume } = require('../lib/productionResume');
const {
  configuredProductionProvider,
  productionProviderStatus,
  storedProductionSource
} = require('../lib/openaiProductionProvider');
const { consumeBillingReturnNotice } = require('../lib/billingCheckoutReturn');
const {
  getCurrentUsageSnapshot,
  getCurrentUsageSnapshotReadOnly,
  persistGenerationUsageTransaction,
  UsageLimitExceededError
} = require('../lib/subscriptions');
const {
  GenerationRequestError,
  beginGenerationRequest,
  completeGenerationRequest,
  failGenerationRequest,
  loadReplayGeneration
} = require('../lib/generationIdempotency');

router.use((req, res, next) => {
  res.locals.generationRequestKeys = {
    quick: crypto.randomUUID(),
    bundle: crypto.randomUUID(),
    regenerate: crypto.randomUUID(),
    productionRegenerate: crypto.randomUUID()
  };
  next();
});

router.param('id', (req, res, next, value) => {
  const id = parsePositiveIntegerId(value);
  if (!id) return res.status(404).send('Not found');
  req.generationResourceId = id;
  return next();
});

class GenerationValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GenerationValidationError';
    this.statusCode = 400;
  }
}

function logGenerationFailure(req, event, code, statusCode) {
  writeOperationalEvent({
    event,
    requestId: req.requestId,
    method: req.method,
    route: req.route?.path || 'unmatched',
    statusCode,
    code
  });
}

function normalizeField(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeGenerationContentType(contentType) {
  if (typeof generator.normalizeContentType === 'function') {
    return generator.normalizeContentType(contentType);
  }
  return normalizeField(contentType).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function resolveGenerationTone(tone) {
  if (typeof generator.resolveTone === 'function') {
    return generator.resolveTone(tone);
  }
  return { templateTone: normalizeField(tone || 'professional').toLowerCase() || 'professional', customGuidance: '' };
}

function parseBundleAssets(rawAssets) {
  const rawList = Array.isArray(rawAssets) ? rawAssets : [rawAssets || ''];
  const values = rawList
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  const seen = new Set();
  const parsed = values.map((value) => {
    const separatorIndex = value.indexOf(':');
    const rawId = separatorIndex === -1 ? value : value.slice(0, separatorIndex);
    const rawLabel = separatorIndex === -1 ? '' : value.slice(separatorIndex + 1);
    const assetId = normalizeField(rawId);
    const label = normalizeField(rawLabel);
    const asset = resolveBundleAsset(assetId, label);

    if (!assetId || !label || !asset) {
      throw new GenerationValidationError('Unsupported bundle asset');
    }

    const dedupeKey = asset.id;
    if (seen.has(dedupeKey)) return null;
    seen.add(dedupeKey);

    return {
      assetId: asset.id,
      label: asset.label,
      contentType: asset.contentType
    };
  }).filter(Boolean);

  if (parsed.length > 5) {
    throw new GenerationValidationError('Too many bundle assets selected');
  }

  return parsed;
}

function formatPlanName(planTier) {
  if (!planTier) return 'Free';
  return planTier.charAt(0).toUpperCase() + planTier.slice(1);
}

function formatAiCredits(snapshot, user) {
  const monthlyLimit = snapshot?.monthlyLimit || user.monthly_limit || 10;
  const used = snapshot?.used || 0;
  const remaining = Math.max(monthlyLimit - used, 0);
  const usedPercentage = monthlyLimit > 0 ? Math.min(Math.round((used / monthlyLimit) * 100), 100) : 0;
  const remainingPercentage = monthlyLimit > 0 ? Math.max(100 - usedPercentage, 0) : 0;
  const periodEnd = snapshot?.usagePeriod?.period_end || null;

  return {
    label: 'AI Credits',
    planName: formatPlanName(user.plan_tier),
    monthlyAllocation: monthlyLimit,
    used,
    remaining,
    usedPercentage,
    remainingPercentage,
    periodEnd,
    manageUrl: user.plan_tier === 'free' ? '/pricing' : '/manage',
    manageLabel: user.plan_tier === 'free' ? 'Upgrade Plan' : 'Manage Plan'
  };
}

function getAiCredits(db, user) {
  return formatAiCredits(getCurrentUsageSnapshotReadOnly(db, user), user);
}

const DASHBOARD_BRAIN_FIELDS = ['business_name', 'industry', 'target_audience', 'brand_voice', 'unique_value', 'competitors', 'goals', 'key_messages'];

function loadDashboardSnapshot(db, user, options = {}) {
  const userId = user.id;
  const brain = db.prepare('SELECT * FROM brand_brain WHERE user_id = ?').get(userId) || {};
  const brainFilled = DASHBOARD_BRAIN_FIELDS.filter((field) => brain[field] && brain[field].trim()).length;

  return {
    history: db.prepare('SELECT * FROM generations WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 5').all(userId),
    totalGenerations: db.prepare('SELECT COUNT(*) AS count FROM generations WHERE user_id = ? AND is_deleted = 0').get(userId).count,
    favorites: db.prepare('SELECT COUNT(*) AS count FROM generations WHERE user_id = ? AND favorite = 1 AND is_deleted = 0').get(userId).count,
    thisMonth: db.prepare("SELECT COUNT(*) AS count FROM generations WHERE user_id = ? AND is_deleted = 0 AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')").get(userId).count,
    quickCount: db.prepare("SELECT COUNT(*) AS count FROM generations WHERE user_id = ? AND is_deleted = 0 AND generation_type = 'quick'").get(userId).count,
    bundleCount: db.prepare("SELECT COUNT(*) AS count FROM generations WHERE user_id = ? AND is_deleted = 0 AND generation_type = 'bundle'").get(userId).count,
    recent: db.prepare('SELECT id, title, input_text, content_type, tone, created_at, favorite, word_count, generation_type FROM generations WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 10').all(userId),
    typeBreakdown: db.prepare('SELECT content_type, COUNT(*) AS count FROM generations WHERE user_id = ? AND is_deleted = 0 GROUP BY content_type ORDER BY count DESC').all(userId),
    latestProduction: getLatestProductionResume(db, userId),
    bundleAssets,
    brandVoices,
    audiencePresets,
    brain,
    brainFilled,
    brainPct: Math.round((brainFilled / DASHBOARD_BRAIN_FIELDS.length) * 100),
    aiCredits: Object.hasOwn(options, 'aiCredits') ? options.aiCredits : getAiCredits(db, user)
  };
}

// ====== Dashboard ======
router.get('/dashboard', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const user = res.locals.user;
    if (!user) return res.redirect('/login');

    res.render('dashboard', {
      title: 'Dashboard - CopyQuick',
      contentTypes: getContentTypes(),
      tones: getTones(),
      ...loadDashboardSnapshot(db, user),
      billingReturnNotice: consumeBillingReturnNotice(req.session),
      results: null,
      currentPage: 'dashboard'
    });
  } catch(err) {
    writeOperationalEvent({
      event: 'dashboard_data_failed',
      requestId: req.requestId,
      code: 'DASHBOARD_DATA_FAILED'
    });
    return res.status(503).render('error', {
      errorStatus: 503,
      title: 'Dashboard Temporarily Unavailable - CopyQuick',
      currentPage: 'dashboard',
      message: 'Your dashboard data could not be loaded safely. Please try again shortly.'
    });
  }
});

// ====== Generate Copy ======
router.post('/dashboard/generate', requireAuth, requireGenerationAvailable, generationActionRateLimit, (req, res) => {
  const { productDescription, targetAudience, contentType, tone, generationType, assets } = req.body;
  const db = getDb();
  const user = res.locals.user;
  const isAjax = req.xhr || req.headers.accept?.includes('json');
  const genType = generationType || 'quick';
  let generationRequest = { enabled: false };

  // The legacy campaign mode has never generated customer-ready work. Do not
  // persist or charge for its historical future-build placeholders; direct
  // customers to the validated Objective -> Production workflow instead.
  if (genType === 'campaign') {
    const message = 'Complete campaigns are created through the guided Objective workflow.';
    if (isAjax) return res.status(409).json({
      error: message,
      code: 'CAMPAIGN_OBJECTIVE_REQUIRED',
      actionUrl: '/welcome'
    });
    return res.status(409).render('error', {
      errorStatus: 409,
      title: 'Start a Guided Objective - CopyQuick',
      currentPage: 'dashboard',
      message
    });
  }

  let cleanProductDescription;
  let cleanTargetAudience;
  let cleanContentType;
  let cleanTone;
  let customToneGuidance = '';
  let selectedBundleAssets = [];
  try {
    cleanProductDescription = normalizeField(productDescription);
    cleanTargetAudience = normalizeField(targetAudience);
    cleanContentType = normalizeGenerationContentType(contentType || 'sales_message');
    const toneResolution = resolveGenerationTone(tone);
    cleanTone = toneResolution.templateTone;
    customToneGuidance = toneResolution.customGuidance;
    if (customToneGuidance) {
      throw new GenerationValidationError('Custom tone is not available for dashboard generation');
    }

    if (!cleanProductDescription) {
      throw new GenerationValidationError('Product description is required');
    }
    if (!['quick', 'bundle'].includes(genType)) {
      throw new GenerationValidationError('Unsupported generation type');
    }
    if (genType === 'bundle') {
      selectedBundleAssets = parseBundleAssets(assets);
      if (selectedBundleAssets.length === 0) {
        selectedBundleAssets = parseBundleAssets(bundleAssets.filter((asset) => asset.default).map((asset) => `${asset.id}:${asset.label}`).join(','));
      }
    } else if (genType === 'quick' && !isValidContentType(cleanContentType)) {
      throw new GenerationValidationError('Unsupported content type');
    }
  } catch (err) {
    if (err instanceof GenerationValidationError || err.code === 'CUSTOM_TONE_TOO_LONG') {
      const statusCode = err.statusCode || 400;
      const code = err.code === 'CUSTOM_TONE_TOO_LONG' ? 'GENERATION_TONE_INVALID' : 'GENERATION_REQUEST_INVALID';
      logGenerationFailure(req, 'dashboard_generation_rejected', code, statusCode);
      if (isAjax) return res.status(statusCode).json({ error: 'Invalid generation request' });
      return res.status(statusCode).render('dashboard', {
        title: 'Dashboard - CopyQuick',
        contentTypes: getContentTypes(),
        tones: getTones(),
        ...loadDashboardSnapshot(db, user),
        results: null,
        error: 'Please check your generation request and try again.',
        input: { productDescription: cleanProductDescription || '', targetAudience: cleanTargetAudience || '', contentType: cleanContentType || 'sales_message', tone: cleanTone || 'professional' }
      });
    }
    throw err;
  }

  const usageSnapshot = getCurrentUsageSnapshot(db, user);
  if (usageSnapshot.isOverLimit) {
    if (isAjax) return res.status(403).json({ error: 'Monthly limit reached' });
    return res.render('dashboard', {
      title: 'Dashboard - CopyQuick',
      contentTypes: getContentTypes(),
      tones: getTones(),
      ...loadDashboardSnapshot(db, user, { aiCredits: formatAiCredits(usageSnapshot, user) }),
      results: null,
      error: 'Monthly generation limit reached.',
      errorAction: { href: '/pricing', label: 'Upgrade your plan to continue.' },
      input: { productDescription: '', targetAudience: '', contentType: 'subject_line', tone: 'professional' }
    });
  }

  try {
    generationRequest = beginGenerationRequest(db, {
      userId: user.id,
      operation: 'dashboard_generation',
      key: req.get('Idempotency-Key') || req.body.idempotencyKey,
      request: {
        productDescription: cleanProductDescription,
        targetAudience: cleanTargetAudience,
        contentType: cleanContentType,
        tone: cleanTone,
        customToneGuidance,
        generationType: genType,
        assets: selectedBundleAssets.map(asset => asset.assetId)
      }
    });
    if (generationRequest.replay) {
      const existing = loadReplayGeneration(db, { userId: user.id, generationId: generationRequest.generationId });
      if (!isAjax) return res.redirect(`/generation/${existing.id}`);
      const replayResults = parseStoredGenerationResults(existing.results);
      if (!replayResults) return res.status(409).json({ error: 'Stored generation unavailable' });
      const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      return res.set('Idempotency-Replayed', 'true').json({
        results: replayResults,
        genId: existing.id,
        generationsUsed: updatedUser.generations_used,
        monthlyLimit: updatedUser.monthly_limit,
        totalGenerations: db.prepare('SELECT COUNT(*) AS count FROM generations WHERE user_id = ? AND is_deleted = 0').get(user.id).count,
        favorites: db.prepare('SELECT COUNT(*) AS count FROM generations WHERE user_id = ? AND favorite = 1 AND is_deleted = 0').get(user.id).count,
        thisMonth: db.prepare("SELECT COUNT(*) AS count FROM generations WHERE user_id = ? AND is_deleted = 0 AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')").get(user.id).count,
        idempotentReplay: true
      });
    }
  } catch (err) {
    if (err instanceof GenerationRequestError) {
      if (isAjax) return res.status(err.statusCode).json({ error: err.message, code: err.code });
      return res.status(err.statusCode).send('This generation request could not be processed safely.');
    }
    throw err;
  }

  try {
    let results = [];
    let wordCount = 0;
    let title = cleanProductDescription.length > 60 ? cleanProductDescription.substring(0, 60) + '...' : cleanProductDescription;

    if (genType === 'quick') {
      results = generateCopy({ productDescription: cleanProductDescription, targetAudience: cleanTargetAudience, contentType: cleanContentType, tone: cleanTone, customToneGuidance });
      wordCount = results.reduce((sum, r) => sum + r.text.split(/\s+/).filter(Boolean).length, 0);
    } else if (genType === 'bundle') {
      // Generate for each selected asset
      selectedBundleAssets.forEach(asset => {
        const assetResults = generateCopy({ productDescription: cleanProductDescription, targetAudience: cleanTargetAudience, contentType: asset.contentType, tone: cleanTone, customToneGuidance });
        results.push(...assetResults.map(r => ({ ...r, assetLabel: asset.label, assetType: asset.assetId, contentType: asset.contentType })));
      });
      wordCount = results.reduce((sum, r) => sum + r.text.split(/\s+/).filter(Boolean).length, 0);
      if (results.length === 0) {
        // Generate a default set if no assets selected
        results = generateCopy({ productDescription: cleanProductDescription, targetAudience: cleanTargetAudience, contentType: 'sales_message', tone: cleanTone, customToneGuidance });
        wordCount = results.reduce((sum, r) => sum + r.text.split(/\s+/).filter(Boolean).length, 0);
      }
    }

    const resultsJson = JSON.stringify(results);
    const contentTypeVal = genType === 'quick' ? (cleanContentType || 'sales_message') : genType;

    const persisted = persistGenerationUsageTransaction(db, {
      userId: user.id,
      usagePeriodId: usageSnapshot.usagePeriod.id,
      eventType: 'generation',
      sourceRoute: 'POST /dashboard/generate',
      metadata: { generationType: genType, contentType: contentTypeVal },
      persistGeneration: (txDb) => {
        const stmt = txDb.prepare(`
          INSERT INTO generations (user_id, title, input_text, content_type, tone, results, word_count, goal, generation_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(user.id, title, cleanProductDescription, contentTypeVal, cleanTone || 'professional', resultsJson, wordCount, '', genType);
        return result.lastInsertRowid;
      },
      finalizeGeneration: (txDb, resource) => {
        if (generationRequest.enabled) completeGenerationRequest(txDb, generationRequest.requestId, resource.generationId);
      }
    });
    const genId = persisted.generationId;

    if (isAjax) {
      const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      res.json({
        results,
        genId,
        generationsUsed: updatedUser.generations_used,
        monthlyLimit: updatedUser.monthly_limit,
        totalGenerations: db.prepare('SELECT COUNT(*) as count FROM generations WHERE user_id = ? AND is_deleted = 0').get(user.id).count,
        favorites: db.prepare('SELECT COUNT(*) as count FROM generations WHERE user_id = ? AND favorite = 1 AND is_deleted = 0').get(user.id).count,
        thisMonth: db.prepare("SELECT COUNT(*) as count FROM generations WHERE user_id = ? AND is_deleted = 0 AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')").get(user.id).count
      });
      return;
    }

    const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    res.locals.user = updatedUser;
    const updatedUsageSnapshot = getCurrentUsageSnapshot(db, updatedUser);
    res.render('dashboard', {
      title: 'Dashboard - CopyQuick',
      contentTypes: getContentTypes(), tones: getTones(),
      ...loadDashboardSnapshot(db, updatedUser, { aiCredits: formatAiCredits(updatedUsageSnapshot, updatedUser) }),
      results,
      input: { productDescription: cleanProductDescription, targetAudience: cleanTargetAudience, contentType: cleanContentType, tone: cleanTone },
      genId,
      genMode: genType
    });
  } catch (err) {
    if (generationRequest.enabled && !generationRequest.replay) {
      failGenerationRequest(db, generationRequest.requestId, err.code || 'GENERATION_FAILED');
    }
    let failureCode = 'GENERATION_FAILED';
    let failureStatus = 500;
    if (err instanceof GenerationValidationError) {
      failureCode = 'GENERATION_REQUEST_INVALID';
      failureStatus = err.statusCode;
    } else if (err.code === 'CUSTOM_TONE_TOO_LONG') {
      failureCode = 'GENERATION_TONE_INVALID';
      failureStatus = 400;
    } else if (err instanceof UsageLimitExceededError) {
      failureCode = 'GENERATION_LIMIT_REACHED';
      failureStatus = 403;
    } else if (err.message && err.message.includes('Invalid content type')) {
      failureCode = 'GENERATION_CONTENT_TYPE_INVALID';
    } else if (err.message && err.message.includes('Invalid tone')) {
      failureCode = 'GENERATION_TONE_INVALID';
    }
    logGenerationFailure(req, 'dashboard_generation_failed', failureCode, failureStatus);
    if (isAjax && (err instanceof GenerationValidationError || err.code === 'CUSTOM_TONE_TOO_LONG')) {
      return res.status(failureStatus).json({ error: 'Invalid generation request' });
    }
    if (err instanceof UsageLimitExceededError) {
      if (isAjax) return res.status(403).json({
        error: 'Monthly limit reached',
        retryWithNewRequestKey: generationRequest.enabled
      });

      const latestUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) || user;
      const latestUsageSnapshot = getCurrentUsageSnapshot(db, latestUser);
      return res.status(403).render('dashboard', {
        title: 'Dashboard - CopyQuick',
        contentTypes: getContentTypes(),
        tones: getTones(),
        ...loadDashboardSnapshot(db, latestUser, { aiCredits: formatAiCredits(latestUsageSnapshot, latestUser) }),
        results: null,
        error: 'Monthly generation limit reached.',
        errorAction: { href: '/pricing', label: 'Upgrade your plan to continue.' },
        input: { productDescription: '', targetAudience: '', contentType: 'subject_line', tone: 'professional' }
      });
    }
    if (isAjax) return res.status(500).json({
      error: 'Generation failed',
      retryWithNewRequestKey: generationRequest.enabled
    });
    res.status(failureStatus).render('dashboard', {
      title: 'Dashboard - CopyQuick',
      contentTypes: getContentTypes(), tones: getTones(),
      ...loadDashboardSnapshot(db, user, { aiCredits: null }),
      results: null, error: 'An error occurred',
    });
  }
});

// ====== History ======
router.get('/history', requireAuth, (req, res) => {
  const db = getDb();
  const userId = res.locals.user.id;
  const requestedPage = parseHistoryPage(req.query.page);
  const perPage = 20;
  const search = boundedQueryText(req.query.search);
  const type = boundedQueryText(req.query.type, 80);
  const sort = boundedQueryText(req.query.sort, 20) || 'newest';
  const favorite = boundedQueryText(req.query.favorite, 2);
  const language = boundedQueryText(req.query.language, 80);

  let where = 'WHERE user_id = ? AND is_deleted = 0';
  let params = [userId];

  if (search) {
    where += ` AND (title LIKE ? OR input_text LIKE ? OR tags LIKE ?)`;
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (type) {
    where += ` AND content_type = ?`;
    params.push(type);
  }
  if (favorite === '1') {
    where += ` AND favorite = 1`;
  }
  if (language) {
    where += ` AND language = ?`;
    params.push(language);
  }

  let orderBy = 'ORDER BY created_at DESC';
  if (sort === 'oldest') orderBy = 'ORDER BY created_at ASC';
  if (sort === 'title') orderBy = 'ORDER BY title ASC';
  if (sort === 'words_desc') orderBy = 'ORDER BY word_count DESC';
  if (sort === 'words_asc') orderBy = 'ORDER BY word_count ASC';

  const total = db.prepare(`SELECT COUNT(*) as count FROM generations ${where}`).get(...params).count;
  const totalPages = Math.ceil(total / perPage);
  const page = Math.min(requestedPage, Math.max(1, totalPages));
  const offset = (page - 1) * perPage;

  const generations = db.prepare(`SELECT * FROM generations ${where} ${orderBy} LIMIT ? OFFSET ?`).all(...params, perPage, offset);

  res.render('history', {
    title: 'History - CopyQuick',
    generations,
    page,
    totalPages,
    paginationPages: buildPaginationPages(totalPages, page),
    total,
    search,
    type,
    sort,
    favorite,
    language,
    contentTypes: getContentTypes(),
    tones: getTones(),
    currentPage: 'history'
  });
});

// ====== Favorites ======
router.get('/favorites', requireAuth, (req, res) => {
  const db = getDb();
  const userId = res.locals.user.id;
  const requestedPage = parseHistoryPage(req.query.page);
  const perPage = 20;
  const total = db.prepare('SELECT COUNT(*) AS count FROM generations WHERE user_id = ? AND favorite = 1 AND is_deleted = 0').get(userId).count;
  const totalPages = Math.ceil(total / perPage);
  const page = Math.min(requestedPage, Math.max(1, totalPages));
  const offset = (page - 1) * perPage;

  const generations = db.prepare(`
    SELECT * FROM generations
    WHERE user_id = ? AND favorite = 1 AND is_deleted = 0
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(userId, perPage, offset);

  res.render('favorites', {
    title: 'Favorites - CopyQuick',
    generations,
    contentTypes: getContentTypes(),
    total,
    page,
    totalPages,
    paginationPages: buildPaginationPages(totalPages, page),
    currentPage: 'favorites'
  });
});

// ====== Generation Detail ======
router.get('/generation/:id', requireAuth, (req, res) => {
  const db = getDb();
  const userId = res.locals.user.id;
  const genId = req.params.id;

  const gen = db.prepare('SELECT * FROM generations WHERE id = ? AND user_id = ? AND is_deleted = 0').get(genId, userId);
  if (!gen) return res.status(404).render('error', { title: 'Not Found - CopyQuick', message: 'Generation not found.' });

  const results = gen.generation_type === 'production' ? [] : parseStoredGenerationResults(gen.results);
  if (!results) {
    return res.status(409).render('error', {
      errorStatus: 409,
      title: 'Generation Unavailable - CopyQuick',
      message: 'This saved generation is unavailable. You can return to History and create a new version.'
    });
  }
  let productionDeliverable = null;
  if (gen.generation_type === 'production' && gen.production_job_id) {
    const production = db.prepare(`
      SELECT production_runs.id AS run_id, production_jobs.title AS job_title,
             production_jobs.production_run_id, usage_events.metadata AS usage_metadata
      FROM production_jobs JOIN production_runs ON production_runs.id = production_jobs.production_run_id
      LEFT JOIN usage_events ON usage_events.id = production_runs.usage_event_id
      WHERE production_jobs.id = ? AND production_jobs.generation_id = ? AND production_runs.user_id = ?
    `).get(gen.production_job_id, gen.id, userId);
    const contract = getProductionContract(gen.deliverable_id);
    let output = null;
    try { output = JSON.parse(gen.structured_result || 'null'); } catch (err) { output = null; }
    const quality = validateCustomerReadyOutput(output, contract);
    const legacySections = gen.deliverable_id === 'outreach_sequence'
      && output && typeof output.summary === 'string' && Array.isArray(output.content)
      ? [
          { key: 'summary', label: 'Legacy Overview', value: output.summary, isList: false },
          { key: 'content', label: 'Legacy Outreach Outline', value: output.content, isList: true }
        ]
      : [];
    const providerStatus = productionProviderStatus();
    let readyAssetBilling = false;
    try {
      readyAssetBilling = JSON.parse(production?.usage_metadata || '{}').costingModel === 'ready_to_use_asset_unit';
    } catch (_) { readyAssetBilling = false; }
    const nextDeliverable = gen.deliverable_id === 'campaign_brief' && production?.production_run_id
      ? db.prepare(`
          SELECT generations.id, production_jobs.title
          FROM production_jobs
          JOIN generations ON generations.id = production_jobs.generation_id
          WHERE production_jobs.production_run_id = ?
            AND production_jobs.deliverable_id = 'outreach_sequence'
            AND production_jobs.status = 'completed'
            AND generations.user_id = ?
            AND generations.is_deleted = 0
          LIMIT 1
        `).get(production.production_run_id, userId)
      : null;
    productionDeliverable = {
      runId: production?.run_id || null,
      title: production?.job_title || gen.title,
      customerReady: quality.valid,
      source: storedProductionSource(gen.ai_model),
      generationMethod: 'Structured Production Engine',
      canRegenerateWithAi: providerStatus.live,
      providerStatus,
      displayType: contract?.displayType || gen.content_type.replace(/_/g, ' '),
      artifactRole: contract?.artifactRole || 'ready_to_use_asset',
      purposeNotice: contract?.artifactRole === 'planning_foundation'
        ? readyAssetBilling
          ? 'This is internal foundation work that guides later execution. It is not customer-facing or publishable copy, and it did not consume a production credit.'
          : 'This is internal foundation work, not customer-facing or publishable copy. This historical run used the earlier per-step billing model; future runs include planning foundation at no credit cost.'
        : null,
      nextDeliverable: nextDeliverable
        ? { id: nextDeliverable.id, title: nextDeliverable.title }
        : null,
      sections: quality.valid ? contract.presentationSections(output) : legacySections
    };
  }

  res.render('generation', {
    title: `${gen.title || 'Generation'} - CopyQuick`,
    gen,
    results,
    contentTypes: getContentTypes(),
    currentPage: 'history',
    productionDeliverable
  });
});

// ====== Regenerate Production Deliverable with configured AI ======
router.post('/generation/:id/regenerate-production', requireAuth, requireGenerationAvailable, generationActionRateLimit, async (req, res) => {
  const db = getDb();
  const userId = res.locals.user.id;
  const genId = req.generationResourceId;
  const gen = db.prepare(`
    SELECT * FROM generations
    WHERE id = ? AND user_id = ? AND is_deleted = 0 AND generation_type = 'production'
  `).get(genId, userId);
  if (!gen?.production_job_id) return res.status(404).json({ error: 'Production deliverable not found.' });

  const sourceStatus = productionProviderStatus();
  if (!sourceStatus.live) {
    return res.status(409).json({
      error: 'OpenAI production AI is not configured. Add the server API settings and restart CopyQuick.'
    });
  }

  const usageSnapshot = getCurrentUsageSnapshot(db, res.locals.user);
  if (usageSnapshot.isOverLimit) return res.status(403).json({ error: 'Monthly limit reached' });

  let generationRequest = { enabled: false };
  try {
    generationRequest = beginGenerationRequest(db, {
      userId,
      operation: `production-regenerate:${genId}`,
      key: req.get('Idempotency-Key') || req.body?.idempotencyKey,
      request: { generationId: Number(genId), deliverableId: gen.deliverable_id, model: sourceStatus.model }
    });
    if (generationRequest.replay) {
      return res.set('Idempotency-Replayed', 'true').json({ success: true, idempotentReplay: true });
    }
  } catch (error) {
    if (error instanceof GenerationRequestError) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    throw error;
  }

  try {
    const rawJob = db.prepare('SELECT * FROM production_jobs WHERE id = ? AND generation_id = ?').get(gen.production_job_id, genId);
    if (!rawJob) {
      const error = new Error('Production job not found');
      error.code = 'GENERATION_NOT_FOUND';
      throw error;
    }
    const job = parseJob(rawJob);
    if (job.stateError) throw job.stateError;
    const rawRun = db.prepare('SELECT * FROM production_runs WHERE id = ? AND user_id = ?').get(job.production_run_id, userId);
    if (!rawRun) {
      const error = new Error('Production run not found');
      error.code = 'GENERATION_NOT_FOUND';
      throw error;
    }
    const brand = db.prepare(`
      SELECT business_name, brand_voice, brand_voice_custom, unique_value, key_messages
      FROM brand_brain WHERE user_id = ?
    `).get(userId);
    const brandContext = brand ? {
      businessName: String(brand.business_name || '').slice(0, 200),
      voice: String(brand.brand_voice === 'custom' ? brand.brand_voice_custom : brand.brand_voice || '').slice(0, 300),
      uniqueValue: String(brand.unique_value || '').slice(0, 1000),
      keyMessages: String(brand.key_messages || '').slice(0, 1000)
    } : null;
    const handler = getProductionContract(job.deliverable_id);
    const generated = await generateDeliverable({
      job,
      productionRun: {
        ...rawRun,
        strategySnapshot: parseStrategySnapshot(rawRun.strategy_snapshot, 'run_strategy_snapshot'),
        brandContext
      },
      dependencyOutputs: loadDependencyOutputs(db, job),
      handler,
      generatorApi: configuredProductionProvider()
    });

    persistGenerationUsageTransaction(db, {
      userId,
      usagePeriodId: usageSnapshot.usagePeriod.id,
      eventType: 'production_regeneration',
      sourceRoute: 'POST /generation/:id/regenerate-production',
      metadata: { deliverableId: gen.deliverable_id, provider: generated.provider, model: generated.aiModel },
      persistGeneration: (txDb) => {
        const updated = txDb.prepare(`
          UPDATE generations
          SET input_text = ?, content_type = ?, tone = ?, ai_model = ?, results = ?, word_count = ?,
              contract_version = ?, structured_result = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ? AND production_job_id = ? AND is_deleted = 0
        `).run(
          generated.inputText, generated.contentType, generated.tone, generated.aiModel,
          JSON.stringify(generated.results), generated.wordCount, generated.contractVersion,
          JSON.stringify(generated.structuredOutput), genId, userId, job.id
        );
        if (updated.changes !== 1) {
          const error = new Error('Generation not found during production regeneration');
          error.code = 'GENERATION_NOT_FOUND';
          throw error;
        }
        txDb.prepare('UPDATE production_jobs SET contract_version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(generated.contractVersion, job.id);
        return genId;
      },
      finalizeGeneration: (txDb, resource) => {
        if (generationRequest.enabled) completeGenerationRequest(txDb, generationRequest.requestId, resource.generationId);
      }
    });
    return res.json({ success: true, generationId: genId, model: generated.aiModel });
  } catch (error) {
    if (generationRequest.enabled && !generationRequest.replay) {
      failGenerationRequest(db, generationRequest.requestId, error.code || 'PRODUCTION_REGENERATION_FAILED');
    }
    const status = error instanceof UsageLimitExceededError ? 403
      : error.code === 'GENERATION_NOT_FOUND' ? 404
        : error.code === 'OPENAI_API_KEY_REQUIRED' ? 409 : 502;
    logGenerationFailure(req, 'production_generation_regeneration_failed', error.code || 'PRODUCTION_REGENERATION_FAILED', status);
    return res.status(status).json({
      error: status === 403 ? 'Monthly limit reached'
        : status === 404 ? 'Production deliverable not found.'
          : 'The AI version could not be created. No CopyQuick generation credit was used.',
      retryWithNewRequestKey: generationRequest.enabled
    });
  }
});

// ====== Toggle Favorite ======
router.post('/generation/:id/favorite', requireAuth, (req, res) => {
  const db = getDb();
  const userId = res.locals.user.id;
  const genId = req.params.id;

  const gen = db.prepare('SELECT * FROM generations WHERE id = ? AND user_id = ? AND is_deleted = 0').get(genId, userId);
  if (!gen) return res.status(404).json({ error: 'Not found' });
  const newVal = gen.favorite ? 0 : 1;
  db.prepare('UPDATE generations SET favorite = ? WHERE id = ? AND user_id = ? AND is_deleted = 0').run(newVal, genId, userId);

  res.json({ favorite: newVal === 1 });
});

// ====== Soft Delete ======
router.post('/generation/:id/delete', requireAuth, (req, res) => {
  const db = getDb();
  const userId = res.locals.user.id;

  db.prepare("UPDATE generations SET is_deleted = 1, deleted_at = datetime('now') WHERE id = ? AND user_id = ? AND is_deleted = 0").run(req.params.id, userId);
  res.json({ success: true });
});

// ====== Restore ======
router.post('/generation/:id/restore', requireAuth, (req, res) => {
  const db = getDb();
  const userId = res.locals.user.id;

  db.prepare('UPDATE generations SET is_deleted = 0, deleted_at = NULL WHERE id = ? AND user_id = ?').run(req.params.id, userId);
  res.json({ success: true });
});

// ====== Update Tags ======
router.post('/generation/:id/tags', requireAuth, (req, res) => {
  const db = getDb();
  const userId = res.locals.user.id;
  const { tags } = req.body;
  const validated = validateOptionalText(tags, GENERATION_METADATA_LIMITS.tags);
  if (!validated.valid) return res.status(400).json({ error: 'Invalid tags.' });

  const result = db.prepare('UPDATE generations SET tags = ? WHERE id = ? AND user_id = ? AND is_deleted = 0').run(validated.value, req.params.id, userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// ====== Update Title ======
router.post('/generation/:id/title', requireAuth, (req, res) => {
  const db = getDb();
  const userId = res.locals.user.id;
  const { title } = req.body;
  const validated = validateOptionalText(title, GENERATION_METADATA_LIMITS.title);
  if (!validated.valid) return res.status(400).json({ error: 'Invalid title.' });

  const result = db.prepare("UPDATE generations SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND is_deleted = 0").run(validated.value, req.params.id, userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true, title: validated.value });
});

// ====== Regenerate ======
router.post('/generation/:id/regenerate', requireAuth, requireGenerationAvailable, generationActionRateLimit, (req, res) => {
  const db = getDb();
  const userId = res.locals.user.id;
  const genId = req.params.id;

  const gen = db.prepare('SELECT * FROM generations WHERE id = ? AND user_id = ? AND is_deleted = 0').get(genId, userId);
  if (!gen) return res.status(404).json({ error: 'Not found' });
  if (gen.generation_type === 'production') return res.status(409).json({ error: 'Production deliverables are regenerated through Production Studio.' });

  const user = res.locals.user;
  const usageSnapshot = getCurrentUsageSnapshot(db, user);
  if (usageSnapshot.isOverLimit) {
    return res.status(403).json({ error: 'Monthly limit reached' });
  }

  let generationRequest = { enabled: false };
  try {
    generationRequest = beginGenerationRequest(db, {
      userId,
      operation: `regenerate:${genId}`,
      key: req.get('Idempotency-Key') || req.body?.idempotencyKey,
      request: { generationId: Number(genId), contentType: gen.content_type, tone: gen.tone }
    });
    if (generationRequest.replay) {
      const existing = loadReplayGeneration(db, { userId, generationId: generationRequest.generationId });
      const replayResults = parseStoredGenerationResults(existing.results);
      if (!replayResults) return res.status(409).json({ error: 'Stored generation unavailable' });
      return res.set('Idempotency-Replayed', 'true').json({
        results: replayResults,
        idempotentReplay: true
      });
    }
  } catch (err) {
    if (err instanceof GenerationRequestError) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    throw err;
  }

  try {
    const newResults = generateCopy({
      productDescription: gen.input_text,
      targetAudience: '',
      contentType: gen.content_type,
      tone: gen.tone
    });

    const newJson = JSON.stringify(newResults);
    const wordCount = newResults.reduce((sum, r) => sum + r.text.split(/\s+/).filter(Boolean).length, 0);

    persistGenerationUsageTransaction(db, {
      userId,
      usagePeriodId: usageSnapshot.usagePeriod.id,
      eventType: 'regeneration',
      sourceRoute: 'POST /generation/:id/regenerate',
      metadata: { contentType: gen.content_type },
      persistGeneration: (txDb) => {
        const updateResult = txDb.prepare(`
          UPDATE generations
          SET results = ?, word_count = ?, updated_at = datetime('now')
          WHERE id = ? AND user_id = ? AND is_deleted = 0
        `).run(newJson, wordCount, genId, userId);
        if (updateResult.changes === 0) {
          const notFoundError = new Error('Generation not found during regeneration persistence');
          notFoundError.code = 'GENERATION_NOT_FOUND';
          throw notFoundError;
        }
        return genId;
      },
      finalizeGeneration: (txDb, resource) => {
        if (generationRequest.enabled) completeGenerationRequest(txDb, generationRequest.requestId, resource.generationId);
      }
    });

    res.json({ results: newResults });
  } catch (err) {
    if (generationRequest.enabled && !generationRequest.replay) {
      failGenerationRequest(db, generationRequest.requestId, err.code || 'GENERATION_FAILED');
    }
    const failureStatus = err instanceof UsageLimitExceededError ? 403 : err.code === 'GENERATION_NOT_FOUND' ? 404 : 500;
    const failureCode = err instanceof UsageLimitExceededError
      ? 'GENERATION_LIMIT_REACHED'
      : err.code === 'GENERATION_NOT_FOUND' ? 'GENERATION_NOT_FOUND' : 'REGENERATION_FAILED';
    logGenerationFailure(req, 'generation_regeneration_failed', failureCode, failureStatus);
    if (err instanceof UsageLimitExceededError) {
      return res.status(403).json({ error: 'Monthly limit reached', retryWithNewRequestKey: generationRequest.enabled });
    }
    if (err.code === 'GENERATION_NOT_FOUND') {
      return res.status(404).json({ error: 'Not found' });
    }
    res.status(500).json({ error: 'Generation failed', retryWithNewRequestKey: generationRequest.enabled });
  }
});

// ====== Export ======
router.get('/generation/:id/export', requireAuth, (req, res) => {
  const db = getDb();
  const userId = res.locals.user.id;
  const format = req.query.format || 'txt';

  const gen = db.prepare('SELECT * FROM generations WHERE id = ? AND user_id = ? AND is_deleted = 0').get(req.params.id, userId);
  if (!gen) return res.status(404).send('Not found');

  let content = '';
  if (gen.generation_type === 'production') {
    const contract = getProductionContract(gen.deliverable_id);
    let output = null;
    try { output = JSON.parse(gen.structured_result || 'null'); } catch (err) { output = null; }
    if (!validateCustomerReadyOutput(output, contract).valid) return res.status(409).send('This deliverable needs review before export.');
    const sections = contract.presentationSections(output);
    if (format === 'txt') content = sections.map(section => `${section.label}\n${section.isList ? section.value.map(item => `- ${item}`).join('\n') : section.value}`).join('\n\n');
    else if (format === 'md') content = `# ${gen.title}\n\n` + sections.map(section => `## ${section.label}\n\n${section.isList ? section.value.map(item => `- ${item}`).join('\n') : section.value}`).join('\n\n');
    else return res.status(400).send('Unsupported format');
    res.setHeader('Content-Type', format === 'md' ? 'text/markdown' : 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="copyquick-deliverable-${gen.id}.${format}"`);
    return res.send(content);
  }

  const results = parseStoredGenerationResults(gen.results);
  if (!results) return res.status(409).send('This saved generation is unavailable.');

  if (format === 'txt') {
    content = results.map((r, i) => `--- Variation ${i + 1} (${r.tone}) ---\n${r.text}`).join('\n\n');
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="copyquick-${gen.id}.txt"`);
  } else if (format === 'md') {
    content = `# ${gen.title}\n\n**Type:** ${gen.content_type} | **Tone:** ${gen.tone}\n\n**Prompt:** ${gen.input_text}\n\n---\n\n`;
    content += results.map((r, i) => `### Variation ${i + 1} (${r.tone})\n\n${r.text}\n`).join('\n');
    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="copyquick-${gen.id}.md"`);
  } else {
    return res.status(400).send('Unsupported format');
  }

  res.send(content);
});

// ====== API: Search ======
router.get('/api/search', requireAuth, (req, res) => {
  const db = getDb();
  const userId = res.locals.user.id;
  const q = boundedQueryText(req.query.q);

  if (!q || q.length < 2) return res.json([]);

  const gens = db.prepare(`
    SELECT id, title, input_text, content_type, tags, created_at 
    FROM generations 
    WHERE user_id = ? AND is_deleted = 0 
      AND (title LIKE ? OR input_text LIKE ? OR tags LIKE ?)
    ORDER BY created_at DESC LIMIT 20
  `).all(userId, `%${q}%`, `%${q}%`, `%${q}%`);

  res.json(gens);
});

// ====== Profile ======
router.get('/profile', requireAuth, (req, res) => {
  const db = getDb();
  const user = res.locals.user;
  res.render('profile', {
    title: 'My Profile - CopyQuick',
    currentPage: 'profile',
    aiCredits: getAiCredits(db, user)
  });
});

module.exports = router;
