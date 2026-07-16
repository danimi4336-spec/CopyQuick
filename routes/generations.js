const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireAuth } = require('./auth');
const generator = require('../lib/generator');
const { generateCopy, getContentTypes, getTones } = generator;
const { isValidContentType } = require('../lib/contentTypes');
const { bundleAssets, campaignSections, brandVoices, goals, audiencePresets } = require('../lib/generatorModes');
const { getGroupsWithJourneys, getJourney, getAllJourneys } = require('../lib/businessJourneys');
const {
  getCurrentUsageSnapshot,
  getCurrentUsageSnapshotReadOnly,
  persistGenerationUsageTransaction,
  UsageLimitExceededError
} = require('../lib/subscriptions');

const goalLabels = {
  launch_product: 'Launch a New Product',
  grow_business: 'Grow My Existing Business',
  start_store: 'Start an Online Store',
  promote_service: 'Promote My Service',
  build_brand: 'Build My Brand',
  campaigns: 'Generate Marketing Campaigns',
  other: 'Something Else'
};

class GenerationValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GenerationValidationError';
    this.statusCode = 400;
  }
}

const bundleAssetContentTypeByLabel = {
  'Email Campaign': 'email_campaign',
  'Facebook Post': 'social_post',
  'Facebook Ad': 'ad_headline',
  'Google Search Ad': 'ad_headline',
  'Product Description': 'product_description',
  'Amazon Listing': 'product_description',
  'SEO Package': 'blog_intro',
  'Blog Article': 'blog_intro',
  'Landing Page': 'cta',
  'Video Package': 'sales_message'
};

const bundleAssetContentTypeById = {
  email_campaign: 'email_campaign',
  facebook_post: 'social_post',
  social_post: 'social_post',
  facebook_ad: 'ad_headline',
  google_search_ad: 'ad_headline',
  ad_headline: 'ad_headline',
  subject_line: 'subject_line',
  product_description: 'product_description',
  amazon_listing: 'product_description',
  seo_package: 'blog_intro',
  blog_intro: 'blog_intro',
  blog_article: 'blog_intro',
  landing_page: 'cta',
  cta: 'cta',
  video_package: 'sales_message',
  sales_message: 'sales_message'
};

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
    const contentType = bundleAssetContentTypeByLabel[label] || bundleAssetContentTypeById[assetId];

    if (!assetId || !contentType) {
      throw new GenerationValidationError('Unsupported bundle asset');
    }

    const dedupeKey = `${assetId}:${label || contentType}`;
    if (seen.has(dedupeKey)) return null;
    seen.add(dedupeKey);

    return {
      assetId,
      label: label || assetId.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
      contentType
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

// ====== Dashboard ======
router.get('/dashboard', requireAuth, (req, res) => {
  console.log('📊 Dashboard route called.');
  try {
    const db = getDb();
    const user = res.locals.user;
    if (!user) { console.log('⛔ No user in locals, redirecting to login'); return res.redirect('/login'); }
    const userId = user.id;

    const safeVal = function(val, fallback) { return val !== null && val !== undefined ? val : fallback; };

    // Validate critical data before rendering
    const sections = campaignSections;
    if (!sections || !sections.length) { console.log('⚠️ campaignSections is empty!'); }
    if (!goalLabels) { console.log('⚠️ goalLabels is missing!'); }

    const totalGenerations = safeVal(db.prepare('SELECT COUNT(*) as count FROM generations WHERE user_id = ? AND is_deleted = 0').get(userId)?.count, 0);
    const favorites = safeVal(db.prepare('SELECT COUNT(*) as count FROM generations WHERE user_id = ? AND favorite = 1 AND is_deleted = 0').get(userId)?.count, 0);
    const thisMonth = safeVal(db.prepare("SELECT COUNT(*) as count FROM generations WHERE user_id = ? AND is_deleted = 0 AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')").get(userId)?.count, 0);
    const quickCount = safeVal(db.prepare("SELECT COUNT(*) as count FROM generations WHERE user_id = ? AND is_deleted = 0 AND generation_type = 'quick'").get(userId)?.count, 0);
    const bundleCount = safeVal(db.prepare("SELECT COUNT(*) as count FROM generations WHERE user_id = ? AND is_deleted = 0 AND generation_type = 'bundle'").get(userId)?.count, 0);
    const campaignCount = safeVal(db.prepare("SELECT COUNT(*) as count FROM generations WHERE user_id = ? AND is_deleted = 0 AND generation_type = 'campaign'").get(userId)?.count, 0);
    const recent = safeVal(db.prepare('SELECT id, title, input_text, content_type, tone, created_at, favorite, word_count, generation_type FROM generations WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 10').all(userId), []);
    const typeBreakdown = safeVal(db.prepare('SELECT content_type, COUNT(*) as count FROM generations WHERE user_id = ? AND is_deleted = 0 GROUP BY content_type ORDER BY count DESC').all(userId), []);
    const history = safeVal(db.prepare('SELECT * FROM generations WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 5').all(userId), []);
    const aiCredits = getAiCredits(db, user);

    // Brand Brain data for progress
    let brain = {};
    let brainFilled = 0;
    let brainPct = 0;
    try {
      const brainRow = db.prepare('SELECT * FROM brand_brain WHERE user_id = ?').get(userId);
      if (brainRow) {
        brain = brainRow;
        const brainFields = ['business_name','industry','target_audience','brand_voice','unique_value','competitors','goals','key_messages'];
        brainFilled = brainFields.filter(function(f){ return brainRow[f] && brainRow[f].trim(); }).length;
        brainPct = Math.round((brainFilled / brainFields.length) * 100);
      } else {
        console.log('ℹ️ No brand_brain row for dashboard user.');
      }
    } catch(e) {
      console.warn('Brand Brain query failed:', e.message);
    }

    const journey = {
      accountCreated: true, loggedIn: true,
      brandBrainStarted: brainFilled > 0,
      firstQuickGenerate: quickCount > 0,
      firstMarketingBundle: bundleCount > 0,
      firstCompleteCampaign: campaignCount > 0,
      firstFavorite: favorites > 0,
      firstDownload: false
    };

    console.log('✅ Rendering dashboard — stats:',
      'gens:', totalGenerations, 'fav:', favorites, 'month:', thisMonth,
      'quick:', quickCount, 'bundle:', bundleCount, 'campaign:', campaignCount);

    res.render('dashboard', {
      title: 'Dashboard - CopyQuick',
      contentTypes: getContentTypes(),
      tones: getTones(),
      history: history, results: null,
      totalGenerations: totalGenerations, favorites: favorites, thisMonth: thisMonth,
      quickCount: quickCount, bundleCount: bundleCount, campaignCount: campaignCount,
      recent: recent, typeBreakdown: typeBreakdown,
      bundleAssets: bundleAssets, campaignSections: campaignSections,
      brandVoices: brandVoices, goals: goals, audiencePresets: audiencePresets,
      brain: brain, brainPct: brainPct, brainFilled: brainFilled,
      journey: journey,
      goalLabels: goalLabels,
      journeyGroupsData: getGroupsWithJourneys(),
      journeysData: JSON.stringify(getAllJourneys()),
      aiCredits: aiCredits,
      builderGoal: safeVal(user.builder_goal, '') || '',
      currentPage: 'dashboard'
    });
  } catch(err) {
    console.error('❌ Dashboard route CRASHED:', err.message);
    console.error('   Stack:', err.stack?.split('\\n').slice(0,3).join('\\n   '));
    try {
      res.render('dashboard', {
        title: 'Dashboard - CopyQuick',
        contentTypes: getContentTypes(), tones: getTones(),
        history: [], results: null,
        totalGenerations: 0, favorites: 0, thisMonth: 0,
        quickCount: 0, bundleCount: 0, campaignCount: 0,
        recent: [], typeBreakdown: [],
        bundleAssets: bundleAssets, campaignSections: campaignSections,
        brandVoices: brandVoices, goals: goals, audiencePresets: audiencePresets,
        brain: {}, brainPct: 0, brainFilled: 0,
        journey: { accountCreated:true, loggedIn:true, brandBrainStarted:false,
                   firstQuickGenerate:false, firstMarketingBundle:false,
                   firstCompleteCampaign:false, firstFavorite:false, firstDownload:false },
        goalLabels: goalLabels,
        journeyGroupsData: getGroupsWithJourneys(),
        journeysData: JSON.stringify(getAllJourneys()),
        aiCredits: null,
        builderGoal: '',
        currentPage: 'dashboard'
      });
    } catch(e2) {
      console.error('💀 Even safe render failed:', e2.message);
      res.status(500).send('Dashboard error. Please check server logs.');
    }
  }
});

// ====== Update Builder Goal ======
router.post('/dashboard/update-goal', requireAuth, (req, res) => {
  const { goal, goalCustom } = req.body;
  if (goal) {
    const db = getDb();
    db.prepare('UPDATE users SET builder_goal = ? WHERE id = ?').run(goal, req.session.userId);
    // If it's AJAX (fetch), return success JSON
    const isAjax = req.xhr || req.headers.accept?.includes('json');
    if (isAjax) return res.json({ success: true, goal });
  }
  res.redirect('/dashboard');
});

// ====== Generate Copy ======
router.post('/dashboard/generate', requireAuth, (req, res) => {
  const { productDescription, targetAudience, contentType, tone, generationType, assets, goal, campaignSections: requestedCampaignSections } = req.body;
  const db = getDb();
  const user = res.locals.user;
  const isAjax = req.xhr || req.headers.accept?.includes('json');
  const genType = generationType || 'quick';
  const getDashboardCounts = function(currentUserId) {
    return {
      favorites: db.prepare('SELECT COUNT(*) as count FROM generations WHERE user_id = ? AND favorite = 1 AND is_deleted = 0').get(currentUserId)?.count || 0,
      quickCount: db.prepare("SELECT COUNT(*) as count FROM generations WHERE user_id = ? AND is_deleted = 0 AND generation_type = 'quick'").get(currentUserId)?.count || 0,
      bundleCount: db.prepare("SELECT COUNT(*) as count FROM generations WHERE user_id = ? AND is_deleted = 0 AND generation_type = 'bundle'").get(currentUserId)?.count || 0,
      campaignCount: db.prepare("SELECT COUNT(*) as count FROM generations WHERE user_id = ? AND is_deleted = 0 AND generation_type = 'campaign'").get(currentUserId)?.count || 0
    };
  };

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

    if (!cleanProductDescription) {
      throw new GenerationValidationError('Product description is required');
    }
    if (!['quick', 'bundle', 'campaign'].includes(genType)) {
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
      console.warn(err.code === 'CUSTOM_TONE_TOO_LONG' ? 'Dashboard generation tone validation failed.' : 'Dashboard generation validation failed.');
      const statusCode = err.statusCode || 400;
      if (isAjax) return res.status(statusCode).json({ error: 'Invalid generation request' });
      return res.status(statusCode).render('dashboard', {
        title: 'Dashboard - CopyQuick',
        contentTypes: getContentTypes(),
        tones: getTones(),
        history: db.prepare('SELECT * FROM generations WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 5').all(user.id),
        results: null,
        error: 'Please check your generation request and try again.',
        totalGenerations: 0, favorites: 0, thisMonth: 0,
        quickCount: 0, bundleCount: 0, campaignCount: 0,
        recent: [], typeBreakdown: [],
        bundleAssets, campaignSections, brandVoices, goals, audiencePresets,
        brain: db.prepare('SELECT * FROM brand_brain WHERE user_id = ?').get(user.id) || {},
        brainPct: 0, brainFilled: 0,
        journey: { accountCreated:true, loggedIn:true, brandBrainStarted:false, firstQuickGenerate:false, firstMarketingBundle:false, firstCompleteCampaign:false, firstFavorite:false, firstDownload:false },
        goalLabels,
        journeyGroupsData: getGroupsWithJourneys(),
        journeysData: JSON.stringify(getAllJourneys()),
        aiCredits: getAiCredits(db, user),
        builderGoal: user.builder_goal || '',
        input: { productDescription: cleanProductDescription || '', targetAudience: cleanTargetAudience || '', contentType: cleanContentType || 'sales_message', tone: cleanTone || 'professional' }
      });
    }
    throw err;
  }

  const usageSnapshot = getCurrentUsageSnapshot(db, user);
  if (usageSnapshot.isOverLimit) {
    if (isAjax) return res.status(403).json({ error: 'Monthly limit reached' });
    // Fetch brain + journey for safe render
    const { favorites, quickCount, bundleCount, campaignCount } = getDashboardCounts(user.id);
    const brainSafe = db.prepare('SELECT * FROM brand_brain WHERE user_id = ?').get(user.id) || {};
    const brainFields = ['business_name','industry','target_audience','brand_voice','unique_value','competitors','goals','key_messages'];
    const brainFilledSafe = brainFields.filter(f => brainSafe[f] && brainSafe[f].trim()).length;
    const brainPctSafe = Math.round((brainFilledSafe / brainFields.length) * 100);
    const journeySafe = { accountCreated:true, loggedIn:true, brandBrainStarted:brainFilledSafe > 0, firstQuickGenerate:quickCount > 0, firstMarketingBundle:bundleCount > 0, firstCompleteCampaign:campaignCount > 0, firstFavorite:favorites > 0, firstDownload:false };
    return res.render('dashboard', {
      title: 'Dashboard - CopyQuick',
      contentTypes: getContentTypes(),
      tones: getTones(),
      history: db.prepare('SELECT * FROM generations WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 5').all(user.id),
      results: null,
      error: 'Monthly generation limit reached. <a href=\"/pricing\">Upgrade your plan</a> to continue.',
      totalGenerations: 0, favorites: 0, thisMonth: 0,
      quickCount: 0, bundleCount: 0, campaignCount: 0,
      recent: [], typeBreakdown: [],
      bundleAssets, campaignSections, brandVoices, goals, audiencePresets,
      brain: brainSafe, brainPct: brainPctSafe, brainFilled: brainFilledSafe,
      journey: journeySafe,
      goalLabels,
      journeyGroupsData: getGroupsWithJourneys(),
      journeysData: JSON.stringify(getAllJourneys()),
      aiCredits: formatAiCredits(usageSnapshot, user),
      builderGoal: user.builder_goal || '',
      input: { productDescription: '', targetAudience: '', contentType: 'subject_line', tone: 'professional' }
    });
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
    } else if (genType === 'campaign') {
      // Generate campaign content based on selected sections
      const activeSections = requestedCampaignSections || 'email';
      const sectionList = activeSections.split(',');
      sectionList.forEach(sectionId => {
        const section = campaignSections.find(s => s.id === sectionId);
        if (section) {
          section.deliverables.forEach((deliverable, idx) => {
            results.push({
              text: `[${section.label}] ${deliverable}\n\nBased on your product "${cleanProductDescription}"${cleanTargetAudience ? ' targeting ' + cleanTargetAudience : ''} with goal: ${goal || 'Increase Sales'}.\n\nThis ${deliverable.toLowerCase()} for the ${section.label.toLowerCase()} channel will be generated in Build #3 when the full AI campaign engine goes live. Your Brand Brain data and campaign settings have been saved for a seamless transition.`,
              tone: cleanTone || 'professional',
              assetLabel: deliverable,
              assetType: sectionId
            });
          });
        }
      });
      wordCount = results.reduce((sum, r) => sum + r.text.split(/\s+/).filter(Boolean).length, 0);
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
        const result = stmt.run(user.id, title, cleanProductDescription, contentTypeVal, cleanTone || 'professional', resultsJson, wordCount, goal || '', genType);
        return result.lastInsertRowid;
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
    const { quickCount, bundleCount, campaignCount } = getDashboardCounts(user.id);
    const totalGenerations = db.prepare('SELECT COUNT(*) as count FROM generations WHERE user_id = ? AND is_deleted = 0').get(user.id).count;
    const favorites = db.prepare('SELECT COUNT(*) as count FROM generations WHERE user_id = ? AND favorite = 1 AND is_deleted = 0').get(user.id).count;
    const thisMonth = db.prepare("SELECT COUNT(*) as count FROM generations WHERE user_id = ? AND is_deleted = 0 AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')").get(user.id).count;
    const recent = db.prepare('SELECT id, title, input_text, content_type, tone, created_at, favorite, word_count FROM generations WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 10').all(user.id);
    const typeBreakdown = db.prepare('SELECT content_type, COUNT(*) as count FROM generations WHERE user_id = ? AND is_deleted = 0 GROUP BY content_type ORDER BY count DESC').all(user.id);
    const history = db.prepare('SELECT * FROM generations WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 5').all(user.id);
    // Safe brain + journey for render
    const brainSafe = db.prepare('SELECT * FROM brand_brain WHERE user_id = ?').get(user.id) || {};
    const brainFields = ['business_name','industry','target_audience','brand_voice','unique_value','competitors','goals','key_messages'];
    const brainFilledSafe = brainFields.filter(f => brainSafe[f] && brainSafe[f].trim()).length;
    const brainPctSafe = Math.round((brainFilledSafe / brainFields.length) * 100);
    const journeySafe = { accountCreated:true, loggedIn:true, brandBrainStarted:brainFilledSafe > 0, firstQuickGenerate:quickCount > 0, firstMarketingBundle:bundleCount > 0, firstCompleteCampaign:campaignCount > 0, firstFavorite:favorites > 0, firstDownload:false };
    res.render('dashboard', {
      title: 'Dashboard - CopyQuick',
      contentTypes: getContentTypes(), tones: getTones(),
      history, results,
      totalGenerations, favorites, thisMonth,
      quickCount, bundleCount, campaignCount,
      recent, typeBreakdown,
      bundleAssets, campaignSections, brandVoices, goals, audiencePresets,
      brain: brainSafe, brainPct: brainPctSafe, brainFilled: brainFilledSafe,
      journey: journeySafe,
      goalLabels,
      journeyGroupsData: getGroupsWithJourneys(),
      journeysData: JSON.stringify(getAllJourneys()),
      aiCredits: formatAiCredits(updatedUsageSnapshot, updatedUser),
      builderGoal: updatedUser.builder_goal || '',
      input: { productDescription: cleanProductDescription, targetAudience: cleanTargetAudience, contentType: cleanContentType, tone: cleanTone },
      genId,
      genMode: genType
    });
  } catch (err) {
    if (err instanceof GenerationValidationError) {
      console.warn('Dashboard generation validation failed.');
      if (isAjax) return res.status(err.statusCode).json({ error: 'Invalid generation request' });
    } else if (err.code === 'CUSTOM_TONE_TOO_LONG') {
      console.warn('Dashboard generation tone validation failed.');
      if (isAjax) return res.status(400).json({ error: 'Invalid generation request' });
    } else if (err instanceof UsageLimitExceededError) {
      console.warn('Dashboard generation limit rejected.');
    } else if (err.message && err.message.includes('Invalid content type')) {
      console.warn('Dashboard generation prompt mapping failed.');
    } else if (err.message && err.message.includes('Invalid tone')) {
      console.warn('Dashboard generation prompt tone failed.');
    } else {
      console.error('Dashboard generation failed.');
    }
    if (err instanceof UsageLimitExceededError) {
      if (isAjax) return res.status(403).json({ error: 'Monthly limit reached' });

      const latestUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) || user;
      const latestUsageSnapshot = getCurrentUsageSnapshot(db, latestUser);
      const { favorites, quickCount, bundleCount, campaignCount } = getDashboardCounts(user.id);
      const brainSafe = db.prepare('SELECT * FROM brand_brain WHERE user_id = ?').get(user.id) || {};
      const brainFields = ['business_name','industry','target_audience','brand_voice','unique_value','competitors','goals','key_messages'];
      const brainFilledSafe = brainFields.filter(f => brainSafe[f] && brainSafe[f].trim()).length;
      const brainPctSafe = Math.round((brainFilledSafe / brainFields.length) * 100);
      const journeySafe = { accountCreated:true, loggedIn:true, brandBrainStarted:brainFilledSafe > 0, firstQuickGenerate:quickCount > 0, firstMarketingBundle:bundleCount > 0, firstCompleteCampaign:campaignCount > 0, firstFavorite:favorites > 0, firstDownload:false };
      return res.status(403).render('dashboard', {
        title: 'Dashboard - CopyQuick',
        contentTypes: getContentTypes(),
        tones: getTones(),
        history: db.prepare('SELECT * FROM generations WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 5').all(user.id),
        results: null,
        error: 'Monthly generation limit reached. <a href=\"/pricing\">Upgrade your plan</a> to continue.',
        totalGenerations: 0, favorites: 0, thisMonth: 0,
        quickCount: 0, bundleCount: 0, campaignCount: 0,
        recent: [], typeBreakdown: [],
        bundleAssets, campaignSections, brandVoices, goals, audiencePresets,
        brain: brainSafe, brainPct: brainPctSafe, brainFilled: brainFilledSafe,
        journey: journeySafe,
        goalLabels,
        journeyGroupsData: getGroupsWithJourneys(),
        journeysData: JSON.stringify(getAllJourneys()),
        aiCredits: formatAiCredits(latestUsageSnapshot, latestUser),
        builderGoal: latestUser.builder_goal || '',
        input: { productDescription: '', targetAudience: '', contentType: 'subject_line', tone: 'professional' }
      });
    }
    if (isAjax) return res.status(500).json({ error: 'Generation failed' });
    const brainSafe = db.prepare('SELECT * FROM brand_brain WHERE user_id = ?').get(user.id) || {};
    const brainFields = ['business_name','industry','target_audience','brand_voice','unique_value','competitors','goals','key_messages'];
    const brainFilledSafe = brainFields.filter(f => brainSafe[f] && brainSafe[f].trim()).length;
    const brainPctSafe = Math.round((brainFilledSafe / brainFields.length) * 100);
    const journeySafe = { accountCreated:true, loggedIn:true, brandBrainStarted:brainFilledSafe > 0, firstQuickGenerate:0, firstMarketingBundle:0, firstCompleteCampaign:0, firstFavorite:0, firstDownload:false };
    res.render('dashboard', {
      title: 'Dashboard - CopyQuick',
      contentTypes: getContentTypes(), tones: getTones(),
      history: db.prepare('SELECT * FROM generations WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 5').all(user.id),
      results: null, error: 'An error occurred',
      totalGenerations: 0, favorites: 0, thisMonth: 0,
      quickCount: 0, bundleCount: 0, campaignCount: 0,
      recent: [], typeBreakdown: [],
      bundleAssets, campaignSections, brandVoices, goals, audiencePresets,
      brain: brainSafe, brainPct: brainPctSafe, brainFilled: brainFilledSafe,
      journey: journeySafe,
      goalLabels,
      journeyGroupsData: getGroupsWithJourneys(),
      journeysData: JSON.stringify(getAllJourneys()),
      aiCredits: null,
      builderGoal: user.builder_goal || ''
    });
  }
});

// ====== History ======
router.get('/history', requireAuth, (req, res) => {
  const db = getDb();
  const userId = res.locals.user.id;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = 20;
  const offset = (page - 1) * perPage;
  const search = req.query.search || '';
  const type = req.query.type || '';
  const sort = req.query.sort || 'newest';
  const favorite = req.query.favorite || '';
  const language = req.query.language || '';

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

  const generations = db.prepare(`SELECT * FROM generations ${where} ${orderBy} LIMIT ? OFFSET ?`).all(...params, perPage, offset);

  res.render('history', {
    title: 'History - CopyQuick',
    generations,
    page,
    totalPages,
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

  const generations = db.prepare('SELECT * FROM generations WHERE user_id = ? AND favorite = 1 AND is_deleted = 0 ORDER BY created_at DESC').all(userId);

  res.render('favorites', {
    title: 'Favorites - CopyQuick',
    generations,
    contentTypes: getContentTypes(),
    total: generations.length,
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

  const results = JSON.parse(gen.results);

  res.render('generation', {
    title: `${gen.title || 'Generation'} - CopyQuick`,
    gen,
    results,
    contentTypes: getContentTypes(),
    currentPage: 'history'
  });
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

  const result = db.prepare('UPDATE generations SET tags = ? WHERE id = ? AND user_id = ? AND is_deleted = 0').run(tags || '', req.params.id, userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// ====== Update Title ======
router.post('/generation/:id/title', requireAuth, (req, res) => {
  const db = getDb();
  const userId = res.locals.user.id;
  const { title } = req.body;

  const result = db.prepare("UPDATE generations SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ? AND is_deleted = 0").run(title || '', req.params.id, userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true, title });
});

// ====== Regenerate ======
router.post('/generation/:id/regenerate', requireAuth, (req, res) => {
  const db = getDb();
  const userId = res.locals.user.id;
  const genId = req.params.id;

  const gen = db.prepare('SELECT * FROM generations WHERE id = ? AND user_id = ? AND is_deleted = 0').get(genId, userId);
  if (!gen) return res.status(404).json({ error: 'Not found' });

  const user = res.locals.user;
  const usageSnapshot = getCurrentUsageSnapshot(db, user);
  if (usageSnapshot.isOverLimit) {
    return res.status(403).json({ error: 'Monthly limit reached' });
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
      }
    });

    res.json({ results: newResults });
  } catch (err) {
    console.error('Generation regeneration failed.');
    if (err instanceof UsageLimitExceededError) {
      return res.status(403).json({ error: 'Monthly limit reached' });
    }
    if (err.code === 'GENERATION_NOT_FOUND') {
      return res.status(404).json({ error: 'Not found' });
    }
    res.status(500).json({ error: 'Generation failed' });
  }
});

// ====== Export ======
router.get('/generation/:id/export', requireAuth, (req, res) => {
  const db = getDb();
  const userId = res.locals.user.id;
  const format = req.query.format || 'txt';

  const gen = db.prepare('SELECT * FROM generations WHERE id = ? AND user_id = ? AND is_deleted = 0').get(req.params.id, userId);
  if (!gen) return res.status(404).send('Not found');

  const results = JSON.parse(gen.results);
  let content = '';

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
  const q = req.query.q || '';

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
