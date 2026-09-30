const { minimumProductionDependencies } = require('./productionDependencyPolicy');
const { getProductionArtifactPolicy } = require('./productionArtifactPolicy');
const { buildEvidenceLedger, renderEvidenceLedger } = require('./productionEvidence');
const { claimMatchesEvidence, isConditionalGuidance, isGeneralGuidance, publicClaimUnits } = require('./productionClaims');
const { blockPromptInstruction, compileOrganicBlocks, organicProviderSchema, qualifyAsGuidance } = require('./productionContentBlocks');
const { buildOrganicCompositionBrief, renderCompositionBrief } = require('./productionComposition');
const { profileForDeliverable } = require('./productionValidationProfiles');
const { decisionValue, decisionValues } = require('./productionDependencySynthesis');
const { generateSearchArticle, providerSchemaV2: searchArticleProviderSchemaV2 } = require('./productionSearchEditorial');
const { compileArticleCitations } = require('./productionResearchEvidence');

const DEFINITIONS = {
  acquisition_snapshot: { contentType: 'sales_message', schema: { summary: 'string', content: 'array' }, labels: ['Overview', 'Acquisition Snapshot'] },
  acquisition_channel_strategy: { contentType: 'sales_message', schema: { summary: 'string', content: 'array' }, labels: ['Overview', 'Channel Strategy'] },
  campaign_brief: {
    contentType: 'sales_message',
    displayType: 'Campaign Brief',
    schema: {
      summary: 'string', content: 'array', campaignObjective: 'string', primaryAudience: 'string', offer: 'string',
      campaignAngle: 'string', callToAction: 'string', customerObjections: 'array', proofConstraints: 'array',
      channelRoles: 'array', measurementGoal: 'string', unresolvedQuestions: 'array'
    },
    labels: ['Overview', 'Campaign Brief', 'Campaign Objective', 'Primary Audience', 'Offer', 'Campaign Angle', 'Call to Action', 'Customer Objections', 'Proof Constraints', 'Channel Roles', 'Measurement Goal', 'Unresolved Questions']
  },
  outreach_sequence: {
    contentType: 'email_campaign',
    displayType: 'Email Campaign',
    schema: {
      campaignOverview: 'string',
      email1Subject: 'string', email1Preview: 'string', email1Body: 'string', email1CallToAction: 'string',
      email2Subject: 'string', email2Preview: 'string', email2Body: 'string', email2CallToAction: 'string',
      email3Subject: 'string', email3Preview: 'string', email3Body: 'string', email3CallToAction: 'string',
      sendPlan: 'array', personalizationChecklist: 'array', complianceChecklist: 'array'
    },
    labels: [
      'Campaign Overview',
      'Email 1 — Subject', 'Email 1 — Preview Text', 'Email 1 — Body', 'Email 1 — Call to Action',
      'Email 2 — Subject', 'Email 2 — Preview Text', 'Email 2 — Body', 'Email 2 — Call to Action',
      'Email 3 — Subject', 'Email 3 — Preview Text', 'Email 3 — Body', 'Email 3 — Call to Action',
      'Recommended Send Plan', 'Personalize Before Sending', 'Compliance Check Before Sending'
    ]
  },
  referral_campaign_kit: {
    contentType: 'sales_message',
    displayType: 'Referral Campaign Kit',
    schema: {
      campaignOverview: 'string', customerReferralEmail: 'string', customerReferralSms: 'string',
      partnerReferralEmail: 'string', introductionRequest: 'string', followUpMessage: 'string',
      personalizationChecklist: 'array', complianceChecklist: 'array'
    },
    labels: ['Campaign Overview', 'Customer Referral Email', 'Customer Referral SMS', 'Partner Referral Email', 'Introduction Request', 'Follow-Up Message', 'Personalize Before Sending', 'Compliance Check']
  },
  paid_ad_copy_set: {
    contentType: 'social_post',
    displayType: 'Paid Ad Copy Set',
    schema: {
      campaignOverview: 'string', ad1Headline: 'string', ad1PrimaryText: 'string', ad1Description: 'string',
      ad2Headline: 'string', ad2PrimaryText: 'string', ad2Description: 'string',
      ad3Headline: 'string', ad3PrimaryText: 'string', ad3Description: 'string',
      callToAction: 'string', testingPlan: 'array', complianceChecklist: 'array'
    },
    labels: ['Campaign Overview', 'Ad 1 — Headline', 'Ad 1 — Primary Text', 'Ad 1 — Description', 'Ad 2 — Headline', 'Ad 2 — Primary Text', 'Ad 2 — Description', 'Ad 3 — Headline', 'Ad 3 — Primary Text', 'Ad 3 — Description', 'Call to Action', 'Testing Plan', 'Compliance Check']
  },
  social_lead_campaign: {
    contentType: 'social_post',
    displayType: 'Social Lead Campaign',
    schema: {
      campaignOverview: 'string', posts: 'array', directMessage: 'string', commentReply: 'string',
      callsToAction: 'array', postingPlan: 'array', complianceChecklist: 'array'
    },
    labels: ['Campaign Overview', 'Social Posts', 'Direct Message', 'Comment Reply', 'Calls to Action', 'Posting Plan', 'Compliance Check']
  },
  organic_content_campaign: {
    contentType: 'blog_intro',
    displayType: 'Organic Content Campaign',
    schema: {
      campaignOverview: 'string', pillarTitle: 'string', searchIntent: 'string', outline: 'array',
      introduction: 'string', callToAction: 'string', distributionPosts: 'array', publishingChecklist: 'array', claimSupport: 'array'
    },
    labels: ['Campaign Overview', 'Pillar Title', 'Search Intent', 'Content Outline', 'Pillar Article Draft', 'Call to Action', 'Distribution Posts', 'Publishing Checklist', 'Claim Support Map']
  },
  lead_capture_page: {
    contentType: 'sales_message',
    displayType: 'Lead Capture Page',
    schema: {
      pageGoal: 'string', eyebrow: 'string', headline: 'string', subheadline: 'string', problemSection: 'string',
      offerSection: 'string', processSteps: 'array', proofSection: 'string', primaryCallToAction: 'string',
      faq: 'array', publishingChecklist: 'array'
    },
    labels: ['Page Goal', 'Eyebrow', 'Headline', 'Subheadline', 'Problem Section', 'Offer Section', 'How It Works', 'Proof Section', 'Primary Call to Action', 'Frequently Asked Questions', 'Publishing Checklist']
  },
  sales_call_script: {
    contentType: 'sales_message',
    displayType: 'Sales Call Script',
    schema: {
      callObjective: 'string', opening: 'string', discoveryQuestions: 'array', relevanceBridge: 'string',
      objectionResponses: 'array', close: 'string', followUpMessage: 'string', preparationChecklist: 'array'
    },
    labels: ['Call Objective', 'Opening', 'Discovery Questions', 'Relevance Bridge', 'Objection Responses', 'Close', 'Follow-Up Message', 'Preparation Checklist']
  },
  multi_channel_campaign_kit: {
    contentType: 'sales_message',
    displayType: 'Multi-Channel Campaign Kit',
    schema: {
      campaignOverview: 'string', coreMessage: 'string', emailMessage: 'string', socialPost: 'string',
      directMessage: 'string', referralRequest: 'string', paidAd: 'string', landingPageCallToAction: 'string',
      channelSequence: 'array', testingChecklist: 'array'
    },
    labels: ['Campaign Overview', 'Core Message', 'Email Message', 'Social Post', 'Direct Message', 'Referral Request', 'Paid Ad', 'Landing Page Call to Action', 'Channel Sequence', 'Testing Checklist']
  },
  conversion_path_brief: { contentType: 'sales_message', schema: { summary: 'string', content: 'array' }, labels: ['Overview', 'Conversion Path'] },
  acquisition_measurement_plan: { contentType: 'sales_message', schema: { summary: 'string', content: 'array' }, labels: ['Overview', 'Measurement Plan'] },
  acquisition_experiment_backlog: { contentType: 'sales_message', schema: { summary: 'string', content: 'array' }, labels: ['Overview', 'Experiment Backlog'] },
  conversion_diagnostic_brief: { contentType: 'sales_message', schema: { summary: 'string', content: 'array' }, labels: ['Overview', 'Conversion Diagnosis'] },
  consultation_conversion_brief: {
    contentType: 'sales_message', displayType: 'Consultation Conversion Brief',
    schema: { summary: 'string', primaryAudience: 'string', offer: 'string', conversionAction: 'string', pageAngle: 'string', trustApproach: 'string', contentScope: 'string', proofConstraints: 'array', unresolvedQuestions: 'array' },
    labels: ['Overview', 'Primary Audience', 'Offer', 'Conversion Action', 'Page Angle', 'Trust Approach', 'Content Scope', 'Proof Constraints', 'Unresolved Questions']
  },
  consultation_conversion_page_copy: {
    contentType: 'sales_message', displayType: 'Consultation Conversion Page Copy',
    schema: {
      heroHeadline: 'string', heroSupportingCopy: 'string', primaryCallToAction: 'string', serviceFit: 'string',
      servicesSection: 'string', trustSection: 'string', processSteps: 'array', proofSection: 'string', faq: 'array',
      formMicrocopy: 'string', finalCallToAction: 'string', editorialReviewNotes: 'array'
    },
    labels: ['Hero Headline', 'Hero Supporting Copy', 'Primary Call to Action', 'Who This Is For', 'Service Overview', 'Why Start With a Conversation', 'What Happens Next', 'Project Examples', 'Frequently Asked Questions', 'Form Microcopy', 'Final Call to Action', 'Editorial Review']
  },
  conversion_page_brief: { contentType: 'sales_message', schema: { summary: 'string', content: 'array' }, labels: ['Overview', 'Product-Page Hypotheses'] },
  conversion_measurement_plan: { contentType: 'sales_message', schema: { summary: 'string', content: 'array' }, labels: ['Overview', 'Conversion Measurement Plan'] },
  search_evidence_snapshot: { contentType: 'sales_message', schema: { summary: 'string', content: 'array', evidenceStatus: 'string', topicContext: 'array', evidenceConstraints: 'array', unresolvedQuestions: 'array' }, labels: ['Overview', 'Search Evidence', 'Evidence Status', 'Topic Context', 'Evidence Constraints', 'Unresolved Questions'] },
  search_strategy: { contentType: 'sales_message', schema: { summary: 'string', content: 'array', authorityDirection: 'string', topicTerritory: 'array', searchIntentHypotheses: 'array', evidenceConstraints: 'array', measurementDirection: 'string', unresolvedQuestions: 'array' }, labels: ['Overview', 'Search Strategy', 'Authority Direction', 'Topic Territory', 'Search Intent Hypotheses', 'Evidence Constraints', 'Measurement Direction', 'Unresolved Questions'] },
  priority_content_brief: { contentType: 'sales_message', schema: { summary: 'string', content: 'array', specificTopic: 'string', readerQuestion: 'string', searchIntentHypothesis: 'string', contentAngle: 'string', scope: 'string', callToActionStatus: 'string', evidenceLimits: 'array' }, labels: ['Overview', 'Priority Content Brief', 'Specific Topic', 'Reader Question', 'Search Intent Hypothesis', 'Content Angle', 'Scope', 'Call to Action Status', 'Evidence Limits'] },
  research_evidence_pack: {
    contentType: 'sales_message', displayType: 'Research Evidence Pack',
    schema: {
      researchSummary: 'string', researchQuestions: 'optional_array', sourcesUsed: 'optional_array', supportedFindings: 'optional_array',
      unsupportedQuestions: 'optional_array', conflicts: 'optional_array', freshnessNotes: 'array', sources: 'object_array',
      evidenceItems: 'object_array', claimMappings: 'object_array', rejectedSources: 'object_array', researchTrace: 'object_array',
      providerSummary: 'object', researchAvailabilityStatus: 'string',
      researchOperations: 'object', researchStatus: 'string', questionsChecked: 'number', supportedQuestionCount: 'number', questionsNeedingEvidence: 'number', sourcesUsedCount: 'number', lastCheckedAt: 'string', limitationNote: 'optional_string',
      noExternalEvidenceRequired: 'boolean', essentialEvidenceMissing: 'boolean'
    },
    labels: ['Research Summary', 'Research Questions', 'Sources Used', 'What the Evidence Supports', 'What Remains Unsupported', 'Evidence Conflicts', 'Freshness & Review Notes', 'Sources', 'Evidence Items', 'Claim Mappings', 'Rejected Sources', 'Research Trace', 'Provider Summary', 'Research Availability Status', 'Research Operations', 'Research Status', 'Questions Checked', 'Supported Questions', 'Questions Needing More Evidence', 'Sources Used Count', 'Last Checked', 'Research Limitation', 'No External Evidence Required', 'Essential Evidence Missing']
  },
  priority_search_article: {
    contentType: 'blog_intro', displayType: 'Priority Search Article',
    schema: {
      title: 'string', summary: 'string', articleBlocks: 'blocks', practicalTakeaways: 'array', conclusion: 'string', callToAction: 'optional_string',
      evidenceOpportunities: 'array', claimsToVerify: 'array', productFactsUsed: 'optional_array', editorialReviewNotes: 'array', sources: 'object_array'
    },
    labels: ['Title', 'Summary', 'Article', 'Practical Takeaways', 'Conclusion', 'Next Step', 'Evidence Opportunities', 'Claims to Verify', 'Product Facts Used', 'Editorial Review Notes', 'Sources']
  },
  search_measurement_plan: { contentType: 'sales_message', schema: { summary: 'string', content: 'array' }, labels: ['Overview', 'Search Measurement Plan'] },
  customer_profile: { contentType: 'sales_message', schema: { summary: 'string', primaryCustomer: 'string', needs: 'array', motivations: 'array', objections: 'array', buyingTriggers: 'array', languageStyle: 'string' }, labels: ['Profile Summary', 'Primary Customer', 'Needs', 'Motivations', 'Objections', 'Buying Triggers', 'Language & Communication Style'] },
  product_concept_brief: { contentType: 'sales_message', schema: { conceptSummary: 'string', directionsToExplore: 'array', customerAndNeed: 'string', openDecisions: 'array', evidenceBoundaries: 'array', nextDefinitionSteps: 'array' }, labels: ['Working Concept', 'Directions to Explore', 'Customer & Need', 'Open Decisions', 'Evidence Boundaries', 'Next Definition Steps'] },
  product_specification_brief: { contentType: 'sales_message', schema: { summary: 'string', knownContext: 'array', openSpecificationDecisions: 'array', validationMethods: 'array', evidenceNeeded: 'array', readinessCriteria: 'array', downstreamUnlocks: 'array' }, labels: ['Specification Summary', 'Known Context', 'Open Specification Decisions', 'How to Validate', 'Evidence Needed', 'Readiness Criteria', 'What This Unlocks'] },
  product_positioning: { contentType: 'sales_message', schema: { positioningStatement: 'string', marketPosition: 'string', differentiation: 'string', proofPoints: 'array', positioningPillars: 'array', messagingImplications: 'array' }, labels: ['Positioning Statement', 'Market Position', 'Core Differentiation', 'Evidence to Establish', 'Positioning Pillars', 'Messaging Implications'] },
  value_proposition: { contentType: 'sales_message', schema: { primaryValueProposition: 'string', customerProblemOrDesire: 'string', promisedOutcome: 'string', reasonsToBelieve: 'array', differentiators: 'array', supportingMessages: 'array' }, labels: ['Primary Value Proposition', 'Customer Problem or Desire', 'Promised Outcome', 'Evidence to Establish', 'Differentiators', 'Supporting Messages'] },
  validation_plan: { contentType: 'sales_message', schema: { validationObjective: 'string', hypotheses: 'array', customerQuestions: 'array', conceptTests: 'array', evidenceToCollect: 'array', decisionCriteria: 'array', nextActions: 'array' }, labels: ['Validation Objective', 'Hypotheses to Test', 'Customer Questions', 'Concept Tests', 'Evidence to Collect', 'Decision Criteria', 'Next Actions'] },
  prototype_sample_validation_plan: { contentType: 'sales_message', schema: { summary: 'string', knownContext: 'array', openDecisions: 'array', nextActions: 'array', evidenceNeeded: 'array', readinessCriteria: 'array', downstreamUnlocks: 'array' }, labels: ['Prototype & Sample Summary', 'Known Context', 'Open Decisions', 'Next Actions', 'Evidence Needed', 'Readiness Criteria', 'What This Unlocks'] },
  sourcing_manufacturer_brief: { contentType: 'sales_message', schema: { summary: 'string', knownContext: 'array', openDecisions: 'array', nextActions: 'array', evidenceNeeded: 'array', readinessCriteria: 'array', downstreamUnlocks: 'array' }, labels: ['Sourcing Summary', 'Known Context', 'Open Decisions', 'RFQ & Supplier Actions', 'Evidence Needed', 'Readiness Criteria', 'What This Unlocks'] },
  compliance_evidence_checklist: { contentType: 'sales_message', schema: { summary: 'string', knownContext: 'array', openDecisions: 'array', nextActions: 'array', evidenceNeeded: 'array', readinessCriteria: 'array', downstreamUnlocks: 'array' }, labels: ['Compliance Summary', 'Known Context', 'Questions for Qualified Review', 'Next Actions', 'Evidence Needed', 'Readiness Criteria', 'What This Unlocks'] },
  unit_economics_pricing_model: { contentType: 'sales_message', schema: { summary: 'string', knownContext: 'array', requiredInputs: 'array', modelCalculations: 'array', nextActions: 'array', readinessCriteria: 'array', downstreamUnlocks: 'array' }, labels: ['Economics Summary', 'Known Context', 'Required Inputs', 'Model Calculations', 'Next Actions', 'Readiness Criteria', 'What This Unlocks'] },
  packaging_shipping_requirements: { contentType: 'sales_message', schema: { summary: 'string', knownContext: 'array', openDecisions: 'array', nextActions: 'array', evidenceNeeded: 'array', readinessCriteria: 'array', downstreamUnlocks: 'array' }, labels: ['Packaging & Shipping Summary', 'Known Context', 'Open Decisions', 'Next Actions', 'Evidence Needed', 'Readiness Criteria', 'What This Unlocks'] },
  inventory_fulfillment_plan: { contentType: 'sales_message', schema: { summary: 'string', knownContext: 'array', openDecisions: 'array', nextActions: 'array', evidenceNeeded: 'array', readinessCriteria: 'array', downstreamUnlocks: 'array' }, labels: ['Inventory & Fulfillment Summary', 'Known Context', 'Open Decisions', 'Next Actions', 'Evidence Needed', 'Readiness Criteria', 'What This Unlocks'] },
  core_messaging: { contentType: 'sales_message', schema: { coreMessage: 'string', messagePillars: 'array', supportingPoints: 'array', toneGuidance: 'string', proofThemes: 'array', callsToAction: 'array' }, labels: ['Core Message', 'Message Pillars', 'Supporting Points', 'Tone Guidance', 'Proof Themes', 'Calls to Action'] },
  product_image_guidance: { contentType: 'sales_message', schema: { creativeDirection: 'string', visualConcepts: 'array', requiredShots: 'array', compositionGuidance: 'array', lightingAndColor: 'string', productionNotes: 'array', avoidances: 'array' }, labels: ['Creative Direction', 'Visual Concepts', 'Required Shots', 'Composition Guidance', 'Lighting & Color', 'Production Notes', 'What to Avoid'] },
  launch_announcement: { contentType: 'email_campaign', schema: { subjectLine: 'string', previewText: 'string', headline: 'string', body: 'string', keyBenefits: 'array', callToAction: 'string' }, labels: ['Subject Line', 'Preview Text', 'Headline', 'Announcement', 'Key Benefits', 'Call to Action'] },
  educational_content: { contentType: 'blog_intro', schema: { title: 'string', learningObjective: 'string', introduction: 'string', keyLessons: 'array', practicalTakeaways: 'array', conclusion: 'string', callToAction: 'string' }, labels: ['Title', 'Learning Objective', 'Introduction', 'Key Lessons', 'Practical Takeaways', 'Conclusion', 'Next Step'] },
  social_launch_campaign: { contentType: 'social_post', schema: { campaignTheme: 'string', campaignObjective: 'string', posts: 'array', hashtags: 'array', visualDirections: 'array', postingSequence: 'array' }, labels: ['Campaign Theme', 'Campaign Objective', 'Social Posts', 'Hashtags', 'Visual Direction', 'Posting Sequence'] }
};

const OTHER_CONTENT_TYPES = {
  amazon_listing: 'product_description', amazon_bullet_points: 'product_description', amazon_keyword_guidance: 'blog_intro', amazon_a_plus: 'product_description',
  ecommerce_product_page: 'product_description', ecommerce_trust_faq: 'blog_intro', ecommerce_conversion_copy: 'cta', abandoned_cart_email: 'email_campaign',
  google_business_profile: 'sales_message', service_page: 'sales_message', software_product_demo: 'sales_message', saas_trial_emails: 'email_campaign'
};
const ACQUISITION_DELIVERABLES = new Set([
  'acquisition_snapshot',
  'acquisition_channel_strategy',
  'campaign_brief',
  'outreach_sequence',
  'referral_campaign_kit',
  'paid_ad_copy_set',
  'social_lead_campaign',
  'organic_content_campaign',
  'lead_capture_page',
  'sales_call_script',
  'multi_channel_campaign_kit',
  'conversion_path_brief',
  'acquisition_measurement_plan',
  'acquisition_experiment_backlog'
  ,'conversion_diagnostic_brief','consultation_conversion_brief','consultation_conversion_page_copy','conversion_page_brief','conversion_measurement_plan'
  ,'search_evidence_snapshot','search_strategy','priority_content_brief','research_evidence_pack','priority_search_article','search_measurement_plan'
]);
const COPY_READY_ACQUISITION_ASSETS = new Set([
  'consultation_conversion_page_copy',
  'outreach_sequence',
  'referral_campaign_kit',
  'paid_ad_copy_set',
  'social_lead_campaign',
  'organic_content_campaign',
  'lead_capture_page',
  'sales_call_script',
  'multi_channel_campaign_kit'
]);
const PLACEHOLDER_FREE_DELIVERABLES = new Set([
  'consultation_conversion_page_copy',
  'priority_search_article',
  'acquisition_snapshot',
  'acquisition_channel_strategy',
  'campaign_brief',
  'outreach_sequence',
  'referral_campaign_kit',
  'paid_ad_copy_set',
  'social_lead_campaign',
  'organic_content_campaign',
  'lead_capture_page',
  'sales_call_script',
  'multi_channel_campaign_kit',
  'conversion_path_brief',
  'acquisition_measurement_plan',
  'acquisition_experiment_backlog',
  'amazon_listing',
  'amazon_bullet_points',
  'customer_profile',
  'product_concept_brief',
  'product_specification_brief',
  'product_positioning',
  'value_proposition',
  'validation_plan',
  'prototype_sample_validation_plan',
  'sourcing_manufacturer_brief',
  'compliance_evidence_checklist',
  'unit_economics_pricing_model',
  'packaging_shipping_requirements',
  'inventory_fulfillment_plan',
  'core_messaging',
  'amazon_keyword_guidance',
  'product_image_guidance',
  'launch_announcement',
  'educational_content',
  'social_launch_campaign'
]);
const INTERNAL_SECTION_KEYS = Object.freeze(Object.fromEntries(Object.entries({
  outreach_sequence: ['campaignOverview', 'sendPlan', 'personalizationChecklist', 'complianceChecklist'],
  referral_campaign_kit: ['campaignOverview', 'personalizationChecklist', 'complianceChecklist'],
  paid_ad_copy_set: ['campaignOverview', 'testingPlan', 'complianceChecklist'],
  social_lead_campaign: ['campaignOverview', 'postingPlan', 'complianceChecklist'],
  organic_content_campaign: ['campaignOverview', 'searchIntent', 'outline', 'publishingChecklist', 'claimSupport'],
  priority_search_article: ['evidenceOpportunities', 'claimsToVerify', 'productFactsUsed', 'editorialReviewNotes', 'sources'],
  consultation_conversion_page_copy: ['editorialReviewNotes'],
  lead_capture_page: ['pageGoal', 'publishingChecklist'],
  sales_call_script: ['callObjective', 'preparationChecklist'],
  multi_channel_campaign_kit: ['campaignOverview', 'channelSequence', 'testingChecklist'],
  educational_content: ['learningObjective'],
  social_launch_campaign: ['campaignObjective', 'visualDirections', 'postingSequence'],
  amazon_listing: ['summary'],
  amazon_bullet_points: ['summary'],
  amazon_a_plus: ['summary'],
  ecommerce_product_page: ['summary'],
  ecommerce_trust_faq: ['summary'],
  ecommerce_conversion_copy: ['summary'],
  abandoned_cart_email: ['summary'],
  google_business_profile: ['summary'],
  service_page: ['summary'],
  software_product_demo: ['summary'],
  saas_trial_emails: ['summary']
}).map(([id, keys]) => [id, new Set(keys)])));
const CTA_FIELD_KEYS = Object.freeze({
  outreach_sequence: ['email1CallToAction', 'email2CallToAction', 'email3CallToAction'],
  referral_campaign_kit: ['introductionRequest', 'followUpMessage'],
  paid_ad_copy_set: ['callToAction'],
  social_lead_campaign: ['callsToAction'],
  organic_content_campaign: ['callToAction'],
  lead_capture_page: ['primaryCallToAction'],
  consultation_conversion_page_copy: ['primaryCallToAction', 'finalCallToAction'],
  sales_call_script: ['close'],
  multi_channel_campaign_kit: ['landingPageCallToAction'],
  launch_announcement: ['callToAction'],
  educational_content: ['callToAction']
});
const MARKDOWN_FIELD_KEYS = Object.freeze({ organic_content_campaign: new Set(['introduction']), priority_search_article: new Set(['articleBlocks']) });
Object.keys(OTHER_CONTENT_TYPES).forEach(id => PLACEHOLDER_FREE_DELIVERABLES.add(id));
const MEASURED_EVIDENCE_FREE_DELIVERABLES = new Set([
  'product_concept_brief',
  'validation_plan',
  'product_specification_brief',
  'prototype_sample_validation_plan',
  'sourcing_manufacturer_brief',
  'compliance_evidence_checklist',
  'unit_economics_pricing_model',
  'packaging_shipping_requirements',
  'inventory_fulfillment_plan',
  'amazon_keyword_guidance'
]);
Object.entries(OTHER_CONTENT_TYPES).forEach(([id, contentType]) => {
  DEFINITIONS[id] = { contentType, schema: { summary: 'string', content: 'array' }, labels: ['Overview', 'Deliverable'] };
});

function nonEmptyString(value) { return typeof value === 'string' && Boolean(value.trim()); }
function validateSchema(output, schema) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return false;
  return Object.entries(schema).every(([key, type]) => {
    if (type === 'string') return nonEmptyString(output[key]);
    if (type === 'optional_string') return output[key] === undefined || typeof output[key] === 'string';
    if (type === 'optional_array') return output[key] === undefined || (Array.isArray(output[key]) && output[key].every(nonEmptyString));
    if (type === 'object_array') return Array.isArray(output[key]) && output[key].every(item => item && typeof item === 'object' && !Array.isArray(item));
    if (type === 'object') return output[key] && typeof output[key] === 'object' && !Array.isArray(output[key]);
    if (type === 'number') return Number.isFinite(output[key]) && output[key] >= 0;
    if (type === 'boolean') return typeof output[key] === 'boolean';
    if (type === 'article_blocks_v2') return Array.isArray(output[key]) && output[key].length >= 5 && output[key].every(block => nonEmptyString(block?.heading) && Array.isArray(block?.claims) && block.claims.length && block.claims.every(claim => nonEmptyString(claim?.claimKey) && nonEmptyString(claim?.text) && typeof claim.evidenceRequired === 'boolean' && Array.isArray(claim.evidenceKeys) && claim.evidenceKeys.every(nonEmptyString)));
    if (type === 'blocks') return Array.isArray(output[key]) && output[key].length >= 5 && output[key].every(block => nonEmptyString(block?.heading) && nonEmptyString(block?.body));
    return Array.isArray(output[key]) && output[key].length > 0 && output[key].every(nonEmptyString);
  });
}
function rawTexts(results) { return Array.isArray(results) ? results.map(item => item?.text).filter(nonEmptyString) : []; }
function humanLabel(key) { return key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase()); }
function wordCount(value) { return String(value || '').trim().split(/\s+/).filter(Boolean).length; }
function strategyValue(context, key, fallback = 'To be confirmed') {
  const value = context?.strategySnapshot?.[key]?.value;
  return nonEmptyString(value) && value !== 'Unknown' ? value : fallback;
}

function defaultPillarArticle({ customer, motivation, offer, composition }) {
  const dimensions = composition?.decisionDimensions || [];
  const supporting = composition?.supportingTopics || [];
  return [
    `## Start with ${motivation.toLowerCase()}\n\nFor ${customer}, evaluating ${motivation.toLowerCase()} may involve several practical decisions rather than one universal answer. Begin by writing down the result you need, the deadline that matters, the people involved, and the constraints you cannot ignore. This creates a useful frame for comparing options without relying on broad promises. It also makes a first conversation more productive because you can describe the situation in concrete terms.`,
    `## Describe the current situation clearly\n\nDocument what is happening today before choosing a solution. Note the process you use, where information comes from, which steps require manual work, and where delays or uncertainty appear. Separate facts you can observe from assumptions that still need checking. A concise description of the present state helps you identify whether the real need concerns capacity, clarity, consistency, expertise, or a combination of those factors.`,
    `## Define what a useful outcome looks like\n\nTranslate ${motivation.toLowerCase()} into observable signs of progress. Avoid selecting a target simply because it sounds impressive. Instead, decide what you would need to see, who would verify it, and when you would review it. A useful outcome can be described in plain language and connected to an actual business decision. If no baseline exists yet, establish one before drawing conclusions about improvement.`,
    `## Evaluate the factors that shape the choice\n\nConsider ${dimensions.slice(0, 3).join(', ') || 'the current situation, scope, and practical constraints'}. Record what you already know and identify what still needs confirmation. If ${supporting[0] || 'a related service consideration'} affects the decision, address it as a distinct factor rather than treating it as another name for ${motivation.toLowerCase()}.`,
    `## Ask specific questions about scope\n\nBefore moving forward, confirm what is included, what remains your responsibility, how information will be exchanged, and how changes are handled. Ask about ${dimensions.slice(3).join(' and ') || 'timing, responsibilities, and review points'}. Clear scope reduces avoidable misunderstandings. It also helps you compare proposals on the same basis instead of relying on labels that may mean different things to different providers.`,
    `## Review evidence without assuming results\n\nUse evidence that is relevant to the decision in front of you. Confirm the source, date, and context of any example or performance statement. Distinguish a documented result from a recommendation, estimate, or hypothesis. When evidence is unavailable, keep the open question visible and decide how you will investigate it. This approach supports a careful decision without turning uncertainty into a claim.`,
    `## Plan the transition and working process\n\nA suitable option still needs a workable implementation path. Identify the information required to begin, the people who need access, the order of the first steps, and the cadence for review. Consider how existing work will be transferred and how urgent questions will be handled. Consider whether a clear transition plan would make it easier to evaluate the practical fit of ${offer} alongside its stated scope.`,
    `## Connect the decision to the next step\n\nChoose a next step that is proportional to what you know. That may be gathering missing information, reviewing a service page, preparing questions, or holding an initial conversation. The next step should help you reduce an important uncertainty rather than create activity for its own sake. Record what you expect to learn so you can judge whether the step was useful afterward.`,
    `## Measure what happens after you act\n\nOnce work begins, review actual records rather than relying on impressions. Select a small set of measures tied to the desired outcome, define how they will be collected, and agree on a review cadence. Include qualitative observations when they explain why a process is or is not working. Use the results to continue, adjust, or stop an approach instead of treating the original plan as fixed.`,
    `## Decide based on fit\n\nA sound choice brings together the confirmed need, practical constraints, service scope, evidence, and working relationship. Revisit the questions that mattered at the beginning and identify any uncertainty that remains material. If ${offer} appears relevant, use a focused conversation to confirm the details and responsibilities. If it does not fit, the same evaluation will still clarify what kind of alternative to consider next.`
  ].join('\n\n');
}
function strategyRole(context, key) { return context?.strategySnapshot?.[key]?.semanticRole || null; }
function dependencyValue(context, id, key, fallback = 'To be confirmed') {
  const value = context?.dependencyOutputs?.find(item => item.deliverableId === id)?.output?.[key];
  if (nonEmptyString(value)) return value;
  if (Array.isArray(value) && value.length) return value[0];
  return fallback;
}

function dependencyValues(context, id, key) {
  const value = context?.dependencyOutputs?.find(item => item.deliverableId === id)?.output?.[key];
  if (Array.isArray(value)) return value.filter(nonEmptyString);
  return nonEmptyString(value) ? [value] : [];
}

function groundedValue(context, key) {
  const item = context?.strategySnapshot?.[key];
  return nonEmptyString(item?.value) && item.value !== 'Unknown' ? item.value : null;
}

function explorationDirections(context) {
  const match = String(context?.strategicDirection || '').match(/Exploration intent:\s*([^·]+)/i);
  if (!match) return [];
  const value = match[1].trim().replace(/[.]$/, '');
  if (!value || /remains open/i.test(value)) return [];
  return value.split(/\s*;\s*/).map(item => item.trim()).filter(nonEmptyString);
}

function conceptComparison(direction) {
  const normalized = String(direction || '').toLowerCase();
  if (normalized.includes('microbiome')) {
    return `${direction} — Investigate customers building a consistent gut-wellness routine; test whether the microbiome framing is understandable and relevant; product format, formulation, and substantiation remain open.`;
  }
  if (normalized.includes('bloating') || normalized.includes('comfort') || normalized.includes('discomfort')) {
    return `${direction} — Investigate how customers describe occasional digestive comfort needs in non-medical language; test whether this situation is specific enough to guide a concept; benefit wording and evidence requirements remain open.`;
  }
  if (normalized.includes('enzyme')) {
    return `${direction} — Investigate when customers consider food-specific digestion support; test whether an enzyme-oriented concept is credible and distinct; ingredient, formulation, suitability, and substantiation decisions remain open.`;
  }
  if (normalized.includes('fiber')) {
    return `${direction} — Investigate the routines and tradeoffs customers associate with fiber support; test relevance and comprehension; format, formulation, tolerance, and evidence requirements remain open.`;
  }
  return `${direction} — Investigate the customer situation, language, and relevance of this direction before making product, benefit, or differentiation decisions.`;
}

function amazonSeedTerms(direction, motivation) {
  const normalized = String(direction || '').toLowerCase();
  if (normalized.includes('microbiome')) return ['microbiome support supplement', 'gut microbiome support', 'daily microbiome support'];
  if (normalized.includes('bloating') || normalized.includes('comfort')) return ['digestive comfort supplement', 'daily digestive comfort', 'digestive wellness support'];
  if (normalized.includes('enzyme')) return ['digestive enzyme support', 'food digestion support', 'digestive enzyme supplement'];
  if (normalized.includes('fiber')) return ['fiber support supplement', 'daily fiber support', 'digestive fiber supplement'];
  return [`${String(direction || motivation).toLowerCase()} supplement`];
}

function builderProductContext(context) {
  const match = String(context?.strategicDirection || '').match(/Builder-provided product context:\s*(.+?)\.\s*Treat this as unverified context/i);
  return match?.[1]?.trim() || null;
}

function builderOfferContext(context) {
  const match = String(context?.strategicDirection || '').match(/Builder-provided offer description:\s*(.+?)\.\s*Treat this as unverified context/i);
  return match?.[1]?.trim() || null;
}

function sentenceFragment(value) {
  return String(value || '').trim().replace(/[.!?]+$/, '');
}

function genericDraftOutput(id, context) {
  const offer = sentenceFragment(decisionValue(context, 'offer'))
    || sentenceFragment(builderOfferContext(context))
    || sentenceFragment(groundedValue(context, 'confirmedOffer'))
    || (ACQUISITION_DELIVERABLES.has(id) ? 'the confirmed offer described in the approved acquisition plan' : '');
  if (!offer) return { summary: 'To be confirmed', content: ['To be confirmed'] };
  const customer = sentenceFragment(decisionValue(context, 'primary_audience')) || sentenceFragment(groundedValue(context, 'primaryCustomer')) || 'the confirmed audience';
  const motivation = sentenceFragment(decisionValue(context, 'campaign_angle')) || sentenceFragment(groundedValue(context, 'customerMotivation')) || 'the confirmed customer priority';
  const campaignCta = sentenceFragment(decisionValue(context, 'customer_facing_cta'));
  const proofBoundary = decisionValues(context, 'proof_constraint')[0];
  const boundary = proofBoundary || 'Verify every offer fact, proof point, price, policy, and required disclosure before publishing.';
  if (id === 'conversion_diagnostic_brief') {
    const serviceConsultation = context?.strategySnapshot?.conversionMode === 'SERVICE_CONSULTATION';
    return {
      summary: 'A diagnostic brief for determining why visitors leave before completing the conversion action. Unresolved inputs remain questions to investigate, not assumed causes.',
      content: serviceConsultation ? [
        'Known context: use the approved service, audience, page, traffic-source, and consultation action where established; mark every other input as not established.',
        'Map the path from service-page visit through consultation interest, form or scheduling start, and completed booking, then identify the step with the largest observed loss.',
        'Check service fit, scope clarity, trust and proof, consultation expectations, CTA clarity or visibility, form or scheduling friction, mobile usability, and material objections as hypotheses—not established causes.',
        'Treat each category as a hypothesis until analytics, usability observation, customer feedback, or controlled testing supports it.',
        'Record the evidence needed, the owner, and the decision each finding will inform before recommending final copy or experience changes.'
      ] : [
        'Known context: use the approved offer, audience, page, traffic-source, and conversion-action facts where established; mark every other input as not established.',
        'Map the funnel from product-page session through add to cart, checkout start, and purchase completion, then identify the step with the largest observed loss.',
        'Check whether value clarity, trust and proof, product comprehension, price perception, shipping, returns, CTA clarity or visibility, mobile usability, checkout friction, comparison difficulty, or offer mismatch contributes to abandonment.',
        'Treat each category as a hypothesis until analytics, usability observation, customer feedback, or controlled testing supports it.',
        'Record the evidence needed, the owner, and the decision each finding will inform before recommending final copy or design changes.'
      ]
    };
  }
  if (id === 'consultation_conversion_brief') {
    return {
      summary: `A consultation-focused page brief for ${offer}, written for ${customer}.`,
      primaryAudience: customer,
      offer,
      conversionAction: sentenceFragment(groundedValue(context, 'confirmedPrimaryCta')) || sentenceFragment(groundedValue(context, 'confirmedConversionAction')) || 'Book a consultation',
      pageAngle: 'Help qualified visitors understand service fit, prepare for a useful first conversation, and choose the appropriate next step.',
      trustApproach: 'Build trust through clear scope, process transparency, and examples of work only where those facts or assets are confirmed.',
      contentScope: 'Explain service fit, project context to share, the consultation process, practical questions, and the next step without assuming an unverified concern or project condition.',
      proofConstraints: ['Do not invent project counts, ratings, awards, certifications, licenses, testimonials, warranties, pricing, financing, response times, service areas, timelines, or guarantees.'],
      unresolvedQuestions: ['Confirm any specific service scope, portfolio examples, operating area, pricing process, or scheduling detail before publishing it.']
    };
  }
  if (id === 'consultation_conversion_page_copy') {
    const cta = sentenceFragment(groundedValue(context, 'confirmedPrimaryCta')) || 'Book a consultation';
    const remodeling = /\b(?:remodel|renovat|design-build)\w*/i.test(offer);
    const subject = remodeling ? 'remodeling project' : 'service needs';
    const examples = remodeling ? 'examples of relevant remodeling work' : 'relevant examples of the service';
    return {
      heroHeadline: remodeling ? 'Plan your remodeling project with a clearer first conversation' : `Start a clearer conversation about ${offer.toLowerCase()}`,
      heroSupportingCopy: `${offer} for ${customer}. Start with a consultation to discuss your ${subject}, priorities, and questions that will shape the next step.`,
      primaryCallToAction: cta,
      serviceFit: `This service is for ${customer} who are preparing to discuss their ${subject} and want to clarify fit, scope, and next steps before moving forward.`,
      servicesSection: remodeling ? 'Use the consultation to describe the rooms or areas involved, the changes you are considering, and the priorities that matter most. The conversation creates a shared starting point without presuming that every project needs the same solution.' : `Use the consultation to describe what you need, the outcome you are considering, and the priorities that matter most. The conversation creates a shared starting point without presuming that every customer needs the same solution.`,
      trustSection: 'A useful first conversation should make the service scope and next steps easier to understand. Bring your priorities and open questions so both sides can decide whether it makes sense to continue.',
      processSteps: [
        'Share the space, project priorities, and the outcome you are considering.',
        'Discuss fit, relevant constraints, and the questions that need answers before a scope can be defined.',
        'Agree on the appropriate next step based on what is established during the consultation.'
      ],
      proofSection: `Review ${examples} to understand the kinds of decisions and needs the service can help address.`,
      faq: [
        'What should I prepare? Bring a short description of the space, your priorities, and any questions you want to cover.',
        'Is the consultation a final project quote? The first conversation is a way to discuss fit and determine what information is needed for a responsible next step.',
        'What happens afterward? You will leave with a clearer understanding of whether to continue and what the next conversation or planning step should cover.'
      ],
      formMicrocopy: remodeling ? 'Tell us briefly about the space, the changes you are considering, and the best way to continue the conversation.' : 'Tell us briefly what you would like to discuss and the best way to continue the conversation.',
      finalCallToAction: cta,
      editorialReviewNotes: [
        'Confirm the precise service scope and consultation process before publishing.',
        'Add portfolio examples or verified credentials only when the business has approved them.',
        'No pricing, timeline, service-area, licensing, warranty, financing, response-time, or performance claim was assumed.'
      ]
    };
  }
  if (id === 'conversion_page_brief') {
    return {
      summary: 'Planning guidance for inspecting the current product page before writing final execution copy.',
      content: [
        'Document the current page promise, product explanation, proof, price and shipping context, return information, CTA, and checkout transition only where they are established.',
        'If the CTA or page experience is not established, confirm it from the live customer path before proposing replacement copy.',
        'Prioritize page elements for review using observed funnel loss and customer evidence rather than assuming the headline, discount, shipping, or trust is the cause.',
        'For each proposed change, state the hypothesis, evidence needed, success measure, and what would disconfirm it.',
        'Keep this artifact as planning guidance until the required offer, CTA, availability, and proof facts are confirmed.'
      ]
    };
  }
  if (id === 'conversion_measurement_plan') {
    if ((groundedValue(context, 'confirmedConversionAction') || '').match(/call|appointment|consultation/i)) {
      return {
        summary: 'A consultation-funnel measurement plan that defines what to collect without inventing baselines or targets.',
        content: [
          'Track consultation CTA clicks, form starts, form completions, and confirmed booking completions where instrumentation permits.',
          'Separate inquiries from scheduled consultations and define a customer-approved qualified-inquiry signal before reporting lead quality.',
          'Review abandonment by step and device without assuming the cause from the event count alone.',
          'Record current values as unknown until measured from an identified source and date.',
          'Choose test thresholds only after establishing normal traffic and booking variability.'
        ]
      };
    }
    return {
      summary: 'A measurement plan that defines what to collect without inventing current baselines or numeric targets.',
      content: [
        'Collect product-page sessions, add-to-cart rate, checkout-start rate, purchase completion, and abandonment by step.',
        'Segment the observations by device and traffic source once those dimensions are available.',
        'Track interactions with shipping, returns, product details, comparison information, proof, and the primary CTA where instrumentation permits.',
        'Record current values as unknown until measured from an identified source and date; do not substitute estimates for baselines.',
        'Choose test thresholds and sample requirements only after establishing normal traffic and conversion variability.'
      ]
    };
  }
  if (id === 'outreach_sequence') {
    const replyAction = campaignCta || 'Reply with a convenient time for a brief conversation.';
    return {
      campaignOverview: `A three-email outreach sequence for ${customer}, centered on ${motivation}. Replace the bracketed details and verify the offer before sending.`,
      email1Subject: `A quick question about ${motivation.toLowerCase()}`,
      email1Preview: 'A short introduction and a simple next step.',
      email1Body: `Hi [First Name],\n\nI’m reaching out from [Business Name]. We work with ${customer} who are focused on ${motivation.toLowerCase()}.\n\nOur current offer is ${offer}. If that is relevant to what you are working on, I would be glad to share the details and learn whether there is a fit.\n\nWould you be open to a brief conversation next week?\n\nBest,\n[Sender Name]`,
      email1CallToAction: `${replyAction} to explore fit.`,
      email2Subject: `A practical way to evaluate ${motivation.toLowerCase()}`,
      email2Preview: 'A useful follow-up with no pressure.',
      email2Body: `Hi [First Name],\n\nI wanted to follow up in case ${motivation.toLowerCase()} is still a priority. A useful first step is to compare your current approach, the result you need, and the support that would make the biggest difference.\n\nIf helpful, I can walk you through how ${offer} could fit that evaluation. I will keep the conversation focused on your situation and the facts we can verify.\n\nWould a short call be useful?\n\nBest,\n[Sender Name]`,
      email2CallToAction: `${replyAction} if the offer is relevant to your current priority.`,
      email3Subject: 'Should I close the loop?',
      email3Preview: 'A final, respectful follow-up.',
      email3Body: `Hi [First Name],\n\nI have not heard back, so I will make this my last note. If ${motivation.toLowerCase()} becomes a priority, I would be happy to discuss whether ${offer} is relevant.\n\nIf now is not the right time, no reply is needed. You can also tell me not to contact you again and I will update my records.\n\nBest,\n[Sender Name]`,
      email3CallToAction: `${replyAction} if you would like to continue; otherwise no reply is needed.`,
      sendPlan: ['Email 1: Day 1.', 'Email 2: 3–4 business days later if there is no reply.', 'Email 3: 5–7 business days after Email 2, then stop.'],
      personalizationChecklist: ['Replace [First Name], [Business Name], [Sender Name], and [Booking Link].', 'Adapt the first sentence to the recipient’s known and appropriate business context.', 'Confirm the offer description and desired reply path.'],
      complianceChecklist: ['Send only where you have a lawful basis and follow the rules for the recipient’s location and channel.', 'Include required sender identity, postal address, and unsubscribe method.', boundary]
    };
  }
  if (id === 'referral_campaign_kit') {
    return {
      campaignOverview: `A copy-ready referral campaign for reaching ${customer} around ${motivation}. Use the customer language after a successful interaction and the partner language with people who already understand the offer.`,
      customerReferralEmail: `Subject: A quick introduction request\n\nHi [Customer First Name],\n\nThank you for working with [Business Name]. We are looking to meet more ${customer} who are focused on ${motivation.toLowerCase()}. If someone comes to mind and you believe a conversation would be useful, would you be comfortable introducing us?\n\nYou can forward the short introduction below or connect us by email. There is no pressure, and we will treat any introduction respectfully.\n\nThank you,\n[Sender Name]`,
      customerReferralSms: `Hi [Customer First Name]—thank you again for working with [Business Name]. If you know a ${customer} who may want to discuss ${motivation.toLowerCase()}, would you feel comfortable making an introduction? No pressure at all. —[Sender Name]`,
      partnerReferralEmail: `Subject: Could we help someone in your network?\n\nHi [Partner First Name],\n\nI’m reaching out because [Business Name] works with ${customer} who are focused on ${motivation.toLowerCase()}. Our offer is ${offer}.\n\nIf you meet someone for whom that sounds relevant, I would appreciate a simple introduction. I am also happy to explain our process so you can decide when a referral is appropriate.\n\nWould a brief conversation next week be useful?\n\nBest,\n[Sender Name]`,
      introductionRequest: `Hi [Prospect First Name] and [Sender First Name]—I’m connecting you because [Prospect First Name] is exploring ${motivation.toLowerCase()}, and [Sender First Name] at [Business Name] may be able to help. I’ll let you take it from here.`,
      followUpMessage: `Hi [Prospect First Name], thank you to [Referrer First Name] for connecting us. I’d like to learn what you need and see whether ${offer} is relevant. Would you be open to a short conversation? You can reply here or choose a time at [Booking Link].`,
      personalizationChecklist: ['Replace every bracketed field and confirm the relationship before sending.', 'Reference only an actual customer experience or partner relationship.', 'Match the request to the confirmed next step and keep the introduction optional.'],
      complianceChecklist: ['Ask for introductions without requesting sensitive information about another person.', 'Contact referred prospects only with an appropriate basis and honor opt-out requests.', boundary]
    };
  }
  if (id === 'paid_ad_copy_set') {
    return {
      campaignOverview: `Three test-ready ad concepts for ${customer}, centered on ${motivation}. Each concept uses a different relevance angle while avoiding unsupported performance claims.`,
      ad1Headline: `A clearer path to ${motivation}`,
      ad1PrimaryText: `${customer} can evaluate ${offer} through a focused conversation about current needs, fit, and the next practical step.`,
      ad1Description: 'Start with a straightforward conversation about fit.',
      ad2Headline: `Is ${motivation.toLowerCase()} a priority?`,
      ad2PrimaryText: `If ${motivation.toLowerCase()} is on your agenda, learn how ${offer} may fit your current approach. Review the details and decide whether a conversation is worthwhile.`,
      ad2Description: 'Explore the offer without unsupported promises.',
      ad3Headline: `Built for ${customer}`,
      ad3PrimaryText: `${offer} is intended for ${customer}. See the confirmed offer details and choose the next step that fits your situation.`,
      ad3Description: 'Review the details and take a low-friction next step.',
      callToAction: campaignCta || 'Learn More or Book a Conversation, according to the confirmed conversion path.',
      testingPlan: ['Run each concept against the same audience and destination.', 'Change one major message angle at a time.', 'Measure qualified actions and downstream outcomes from actual platform and sales records before scaling.'],
      complianceChecklist: ['Confirm platform policy, targeting, disclosures, destination-page consistency, and consent requirements.', 'Remove any claim, proof point, price, urgency, or customer result that is not verified.', boundary]
    };
  }
  if (id === 'social_lead_campaign') {
    return {
      campaignOverview: `A practical social campaign for starting relevant conversations with ${customer} around ${motivation}.`,
      posts: [
        `${customer}: what makes ${motivation.toLowerCase()} difficult today? We are listening for the obstacles that matter before recommending a next step. Share your perspective or message [Business Name].`,
        `${offer}. If that is relevant to your current priorities, [Business Name] can walk through the confirmed details and help you evaluate fit. [Link]`,
        `A good next step does not need to be complicated. If you are a ${customer} focused on ${motivation.toLowerCase()}, book a short conversation with [Business Name] at [Booking Link].`
      ],
      directMessage: `Hi [First Name]—I saw your interest in [relevant topic]. [Business Name] works with ${customer} focused on ${motivation.toLowerCase()}. If it is appropriate, I can send a brief overview of ${offer}; no pressure if it is not relevant.`,
      commentReply: `Thanks for the question. The best next step is to review the confirmed offer details at [Link]. If you want to discuss your situation, you can message us or book a conversation at [Booking Link].`,
      callsToAction: ['Comment with a question.', 'Send a direct message for the overview.', 'Visit [Link] or book at [Booking Link].'],
      postingPlan: ['Publish the customer-problem post first and record substantive responses.', 'Publish the offer-context post after the initial discussion.', 'Publish the direct next-step post, then review qualified conversations before repeating or scaling.'],
      complianceChecklist: ['Use only verified offer facts and permissioned customer material.', 'Follow platform rules for outreach, targeting, disclosures, and direct messages.', boundary]
    };
  }
  if (id === 'organic_content_campaign') {
    const composition = context?.compositionBrief || buildOrganicCompositionBrief(context);
    const confirmedCta = groundedValue(context, 'confirmedPrimaryCta');
    const confirmedGoal = groundedValue(context, 'customerMotivation') || 'the current priority';
    const organicMotivation = composition.primaryTopic || confirmedGoal;
    const organicOffer = sentenceFragment(groundedValue(context, 'confirmedOffer')) || 'relevant professional support';
    const result = {
      campaignOverview: `A search-led educational content package for ${customer} researching ${organicMotivation}. Supporting topics are used only where they clarify a distinct reader decision. Validate the exact query language before optimizing or making traffic projections.`,
      pillarTitle: `A practical guide to ${organicMotivation.toLowerCase()}`,
      searchIntent: `${customer} looking for useful, non-promotional guidance about ${organicMotivation.toLowerCase()} and the decisions that shape an appropriate next step.`,
      outline: composition.sectionPlan,
      introduction: defaultPillarArticle({ customer, motivation: organicMotivation, offer: organicOffer, composition }),
      callToAction: confirmedCta || `If you want to evaluate whether ${organicOffer} fits your situation, review the service details and choose the next step presented there.`,
      distributionPosts: [`How can ${customer} evaluate ${organicMotivation.toLowerCase()} without skipping the important questions? This practical guide explains the decisions and tradeoffs to review.`, `If ${confirmedGoal.toLowerCase()} is the priority, use this framework to evaluate how ${organicMotivation.toLowerCase()} fits the next decision.`, `Before choosing an approach to ${organicMotivation.toLowerCase()}, clarify ${composition.decisionDimensions.slice(0, 3).join(', ')} and the next step.`],
      publishingChecklist: ['Validate the target query and customer wording with real search and customer evidence.', 'Add only verified examples, proof, credentials, and links.', 'Review title, metadata, headings, internal links, accessibility, and conversion tracking before publication.', boundary],
      claimSupport: []
    };
    const ledger = context?.evidenceLedger || buildEvidenceLedger({
      strategySnapshot: context?.strategySnapshot,
      brandContext: context?.brandContext,
      dependencyOutputs: context?.dependencyOutputs
    });
    const publicEvidence = ledger.filter(entry => entry.permittedUse === 'public_claim');
    const publicKeys = ['pillarTitle', 'introduction', 'callToAction', 'distributionPosts'];
    publicClaimUnits(result, { publicFieldKeys: publicKeys }).forEach(unit => {
      const supported = publicEvidence.some(entry => claimMatchesEvidence(unit.text, entry))
        || isConditionalGuidance(unit.text) || isGeneralGuidance(unit.text);
      if (supported) return;
      const qualified = qualifyAsGuidance(unit.text, context);
      publicKeys.forEach(key => {
        if (Array.isArray(result[key])) result[key] = result[key].map(value => String(value).replace(unit.text, qualified));
        else result[key] = String(result[key] || '').replace(unit.text, qualified);
      });
    });
    result.claimSupport = publicClaimUnits(result, { publicFieldKeys: ['pillarTitle', 'introduction', 'callToAction', 'distributionPosts'] }).map(unit => {
      const evidence = publicEvidence.find(entry => claimMatchesEvidence(unit.text, entry));
      const source = evidence?.id || (isConditionalGuidance(unit.text) ? 'conditional_guidance'
        : isGeneralGuidance(unit.text) ? 'general_guidance' : 'conditional_guidance');
      return `${source} :: ${unit.text}`;
    });
    return result;
  }
  if (id === 'lead_capture_page') {
    const confirmedCta = campaignCta || groundedValue(context, 'confirmedPrimaryCta') || 'Book a Conversation';
    return {
      pageGoal: `Turn qualified interest from ${customer} into the confirmed sales action without making unsupported promises.`,
      eyebrow: `For ${customer}`,
      headline: `A practical next step toward ${motivation}`,
      subheadline: `Explore whether ${offer} fits your current needs through a clear, low-pressure next step.`,
      problemSection: `${customer} often need a straightforward way to evaluate options related to ${motivation.toLowerCase()}. The first step is to clarify the current situation, desired outcome, and evidence required for a sound decision.`,
      offerSection: `[Business Name] offers ${offer}. Review the scope, process, timing, price, and policies, then choose whether this next step fits your needs.`,
      processSteps: ['Share the essential context through the form or booking page.', 'Review the confirmed offer details and discuss fit.', 'Agree on an appropriate next step only if the offer matches the customer’s needs.'],
      proofSection: `Review the confirmed service scope and use the consultation to decide whether [Business Name] fits your needs.`,
      primaryCallToAction: confirmedCta,
      faq: [`Who is this for? — This offer is designed for ${customer}.`, 'What is included? — [Verified Offer Scope].', 'What happens next? — After you submit the form or book, [Verified Response and Scheduling Process].', 'What does it cost? — [Verified Price or Pricing Process].'],
      publishingChecklist: ['Replace every bracketed field and verify the offer, price, process, policies, proof, and contact details.', 'Connect the form or booking flow and test confirmation, consent, analytics, and mobile behavior.', boundary]
    };
  }
  if (id === 'sales_call_script') {
    return {
      callObjective: `Determine whether ${offer} is relevant to the prospect’s needs around ${motivation}, then agree on the right next step without pressuring the prospect.`,
      opening: `Thank you for making time. I’d like to understand what prompted the conversation, what you need, and how you are handling it today. Then I can explain the confirmed parts of our offer and we can decide whether a next step makes sense.`,
      discoveryQuestions: [`What made ${motivation.toLowerCase()} a priority now?`, 'How are you handling this today?', 'What is working, and where is the friction?', 'What would a useful outcome look like?', 'Who else is involved in the decision?', 'What timing or constraints should we understand?'],
      relevanceBridge: `Based on what you shared, the relevant part of ${offer} may be [verified aspect of the offer]. Let me explain the actual scope and process, then you can decide whether it addresses the priority you described.`,
      objectionResponses: ['“I need to think about it.” — Of course. What information would make the evaluation easier?', '“We already have an approach.” — That makes sense. What works well today, and is there anything you would still like to improve?', '“What does it cost?” — Share only the current verified price and scope, then confirm whether that range fits before continuing.'],
      close: `It sounds like the appropriate next step is [confirmed next step]. Does that match what you need? If so, we can schedule it now; if not, I am happy to close the loop.`,
      followUpMessage: `Hi [First Name], thank you for the conversation. You identified [confirmed priority] as the main focus. We agreed that [next step] is appropriate. Here are the verified details and timing: [details]. Please reply if I misunderstood anything.`,
      preparationChecklist: ['Review the prospect’s permissioned context and the confirmed offer facts.', 'Prepare verified scope, process, price, policies, and proof.', 'Do not infer needs, promise results, or manufacture urgency.', boundary]
    };
  }
  if (id === 'multi_channel_campaign_kit') {
    return {
      campaignOverview: `A coordinated starter campaign for testing how ${customer} respond to ${offer} across several channels, without assuming that any channel already performs.`,
      coreMessage: `${customer} focused on ${motivation.toLowerCase()} can review ${offer} and choose a clear next step based on fit.`,
      emailMessage: `Subject: A practical question about ${motivation.toLowerCase()}\n\nHi [First Name],\n\n[Business Name] works with ${customer} focused on ${motivation.toLowerCase()}. Our offer is ${offer}. If that is relevant, I can share the confirmed details and learn whether a conversation makes sense.\n\nWould you like the overview?\n\nBest,\n[Sender Name]`,
      socialPost: `${customer}: if ${motivation.toLowerCase()} is a current priority, [Business Name] can share a practical overview of ${offer}. Review the details at [Link].`,
      directMessage: `Hi [First Name]—if ${motivation.toLowerCase()} is relevant to your work, I can send a brief overview of ${offer}. No pressure if it is not a current priority.`,
      referralRequest: `If you know a ${customer} who is exploring ${motivation.toLowerCase()}, would you be comfortable introducing us? We will keep the first conversation useful and low pressure.`,
      paidAd: `${motivation} for ${customer}. Review ${offer} and decide whether the next step fits your situation. [Link]`,
      landingPageCallToAction: 'Review the Confirmed Details at [Link] or Book a Conversation at [Booking Link].',
      channelSequence: ['Test one audience and message through one channel first.', 'Keep the offer and destination consistent while comparing qualified actions.', 'Use observed lead quality and conversion evidence to choose the next channel.'],
      testingChecklist: ['Define the audience, channel, message, destination, budget or effort limit, owner, duration, and decision rule.', 'Track actual qualified actions and downstream outcomes rather than surface activity alone.', boundary]
    };
  }
  const contentById = {
    acquisition_snapshot: [
      `Offer context: ${offer}.`, `Priority customer: ${customer}.`, `Growth goal: ${motivation}.`,
      'Record the current acquisition source, sales step, capacity constraint, and baseline evidence separately from assumptions.', boundary
    ],
    acquisition_channel_strategy: [
      `Channel hypothesis: use the approved acquisition direction to reach ${customer}.`,
      `Message hypothesis: connect ${offer} to ${motivation} without claiming unverified performance.`,
      'Define audience, entry point, conversion action, owner, test duration, budget limit, and stop/continue criteria before launch.', boundary
    ],
    campaign_brief: [
      `Campaign objective: attract qualified ${customer} prospects for ${offer}.`,
      `Core relevance: connect the offer to ${motivation}.`,
      'Specify the audience, promise boundary, proof required, creative angle, destination, call to action, and qualification signal.', boundary
    ],
    conversion_path_brief: [
      'Map awareness → qualified interest → confirmed sales action → follow-up.',
      `Keep the path focused on ${customer} and ${motivation}.`,
      'For each step, define the customer question, message, evidence, action, owner, and measurable event.', boundary
    ],
    acquisition_measurement_plan: [
      'Capture a dated baseline before the test begins.',
      'Measure reach, response or click, qualified interest, completed sales action, customer outcome, and cost only from actual records.',
      'Define minimum sample, review cadence, data owner, and continue/change/stop thresholds before results are available.', boundary
    ],
    acquisition_experiment_backlog: [
      'Prioritize one-variable tests for customer segment, channel, message, offer framing, proof, call to action, and follow-up.',
      'For every experiment record the hypothesis, evidence gap, primary metric, guardrail, duration, effort, owner, and decision rule.',
      'Run the smallest decision-useful test first; do not label activity as validation without observed evidence.', boundary
    ],
    amazon_a_plus: [
      `Meet ${offer}.`,
      `Created for ${customer}, with clear information to help you consider whether it fits your priorities around ${motivation.toLowerCase()}.`,
      'Explore the confirmed product details, intended use, and care information shown here.',
      'Review the current specifications and policies before deciding.'
    ],
    ecommerce_product_page: [
      `${offer}`,
      `A clear offer for ${customer} considering ${motivation.toLowerCase()}.`,
      'Review the confirmed features, scope, usage information, and current policies on this page.',
      'Compare the available details with your needs and choose the next step that fits.',
      'Review the offer details.'
    ],
    ecommerce_trust_faq: [
      `What is the offer? ${offer}.`,
      `Who is it for? It is intended for ${customer}.`,
      'What should I review before deciding? Review the scope, specifications, usage information, delivery details, support, and policies shown with the offer.',
      'What happens next? Choose the next step shown on the page if the confirmed details fit your needs.'
    ],
    ecommerce_conversion_copy: [
      `Review ${offer}`,
      `${customer} can explore the confirmed offer details and decide whether the next step fits.`,
      'See the current scope, specifications, policies, and support information.'
    ],
    abandoned_cart_email: [
      `Subject: Still considering ${offer}?`,
      `Hi [First Name], you can return to review ${offer} and decide whether the confirmed details fit your needs.`,
      'If you have a question about the offer, reply to this message or use the support option shown on the page.',
      'Review your selection at [Cart Link].'
    ],
    google_business_profile: [
      `${offer}.`,
      `We serve ${customer} who are considering support related to ${motivation.toLowerCase()}.`,
      'Visit our website or contact us to review the current service scope, availability, and next steps.'
    ],
    service_page: [
      `${offer}`,
      `For ${customer}.`,
      `If ${motivation.toLowerCase()} is a current priority, review the confirmed service scope and process to decide whether this offer fits your situation.`,
      'Start with a focused conversation about your needs, the available service details, and an appropriate next step.',
      'Contact [Business Name] at [Contact Link] to discuss fit.'
    ],
    software_product_demo: [
      `Welcome. This demonstration introduces ${offer} for ${customer}.`,
      `We will look at the implemented workflow related to ${motivation.toLowerCase()} and show where to find the available controls.`,
      'Follow along with the steps shown in the product, then compare the workflow with your current process.',
      'At the end, use the provided trial or contact option if you want to evaluate fit in your own environment.'
    ],
    saas_trial_emails: [
      `Subject: Welcome to your ${offer} trial\n\nHi [First Name], your trial is ready. Start with the first step shown at [Trial Link], and use [Help Link] if you need assistance.`,
      `Subject: Continue exploring ${offer}\n\nHi [First Name], return to [Trial Link] to review the available workflow and compare it with your current process.`,
      `Subject: Decide whether ${offer} fits\n\nHi [First Name], review the features you explored and choose the plan or contact option shown in your account if you want to continue.`
    ]
  };
  return {
    summary: `Working ${humanLabel(id)} draft based on builder-provided offer context. This is a reviewable starting point, not independently verified or ready to publish without confirmation.`,
    content: contentById[id] || [boundary]
  };
}

function physicalPlanningOutput(id, context) {
  const offer = builderOfferContext(context) || 'the proposed physical product';
  const customer = groundedValue(context, 'primaryCustomer') || 'the intended customer';
  const motivation = groundedValue(context, 'customerMotivation') || 'the intended customer priority';
  const isFoodContainer = /lunch|food|container/i.test(offer);
  const knownContext = [
    `Builder-confirmed direction: ${offer}.`,
    `Current customer hypothesis: ${customer}.`,
    `Current motivation: ${motivation}; customer relevance still requires evidence.`
  ];
  const common = {
    prototype_sample_validation_plan: {
      summary: 'A working plan for comparing prototypes and supplier samples with the approved specification. No prototype performance or supplier capability is assumed.',
      knownContext,
      openDecisions: ['Prototype method and sample sequence.', 'Pass/fail thresholds for fit, function, durability, cleaning, and user experience.', 'Who will conduct technical review and representative customer-use testing.'],
      nextActions: ['Create a scored test sheet from the specification brief.', 'Request comparable samples only after suppliers receive the same written requirements.', 'Record failures, revisions, and evidence separately for each prototype or sample.'],
      evidenceNeeded: ['Measured test results against each requirement.', 'Observed user comprehension, handling, cleaning, and use issues.', 'Supplier documentation and corrective-action responses.'],
      readinessCriteria: ['Critical requirements have objective pass/fail methods.', 'A sample passes the agreed tests without undocumented exceptions.', 'Remaining tradeoffs and revision ownership are documented.'],
      downstreamUnlocks: ['Supplier selection and commercial negotiation.', 'Packaging validation and responsible product imagery.', 'A documented decision to revise, proceed, or stop.']
    },
    sourcing_manufacturer_brief: {
      summary: 'A supplier-evaluation and RFQ brief. It does not name or endorse manufacturers and does not assume costs, minimum orders, lead times, certifications, or capacity.',
      knownContext,
      openDecisions: ['Make-versus-source approach and supplier geography.', 'Required processes, quality controls, documentation, minimum order, tooling, and lead-time limits.', 'Ownership of tooling, specifications, test records, defects, and corrective actions.'],
      nextActions: ['Send the same specification, forecast range, and RFQ questions to multiple qualified candidates.', 'Request itemized quotes for tooling, samples, unit cost, packaging, testing, freight terms, and change charges.', 'Score suppliers on capability evidence, quality systems, responsiveness, commercial terms, and risk—not price alone.'],
      evidenceNeeded: ['Comparable written quotations and assumptions.', 'Relevant process, quality, traceability, and test documentation.', 'Verified sample results and references appropriate to the product category.'],
      readinessCriteria: ['At least two comparable supplier responses can be evaluated.', 'Critical capabilities and documentation are verified rather than asserted.', 'Commercial, quality, delivery, and change-control responsibilities are written.'],
      downstreamUnlocks: ['Reliable landed-cost inputs.', 'Prototype/sample ordering.', 'Initial inventory and replenishment planning.']
    },
    compliance_evidence_checklist: {
      summary: 'A scoping checklist for qualified compliance review. It is not legal advice and does not claim that any material, label, test, or product is compliant.',
      knownContext,
      openDecisions: isFoodContainer
        ? ['Applicable food-contact material requirements and migration/testing documentation.', 'Required labeling, warnings, care instructions, age/use limitations, and traceability.', 'Which claims—such as insulation, leak resistance, durability, or material safety—require defined test evidence.']
        : ['Applicable product, material, labeling, safety, environmental, and destination-market requirements.', 'Required warnings, care instructions, age/use limitations, and traceability.', 'Which performance or safety statements require defined test evidence.'],
      nextActions: ['Have a qualified specialist identify applicable requirements for the product and sales destinations.', 'Create a requirement-to-document owner matrix covering supplier declarations, test reports, labels, and records.', 'Review every proposed claim against an evidence file before publication.'],
      evidenceNeeded: ['Current applicable-requirement assessment from qualified reviewers.', 'Traceable material, component, test, labeling, and supplier documentation.', 'Approved claim wording linked to specific supporting evidence.'],
      readinessCriteria: ['Applicable requirements and responsible reviewers are documented.', 'Required evidence is complete, current, traceable, and reviewed.', 'Labels, instructions, and claims match the reviewed product configuration.'],
      downstreamUnlocks: ['Final packaging and labeling.', 'Supported product claims and sales content.', 'Channel and destination-market readiness review.']
    },
    packaging_shipping_requirements: {
      summary: 'A working packaging and shipping requirements plan based on unresolved product facts. No package dimensions, weights, materials, rates, or carrier performance are assumed.',
      knownContext,
      openDecisions: ['Primary packaging, protection, labeling, instructions, tamper or hygiene needs, and unboxing priorities.', 'Packed dimensions and weight, parcel configuration, shipping zones, damage tolerance, and return handling.', 'Packaging validation methods and sustainability tradeoffs.'],
      nextActions: ['Derive packaging requirements from the approved product specification and compliance checklist.', 'Build packed prototypes and test protection, labeling, handling, storage, and return scenarios.', 'Obtain shipping-rate comparisons only after measured packed dimensions and weight exist.'],
      evidenceNeeded: ['Measured packed dimensions and weight.', 'Documented handling, drop, compression, leakage, temperature, or other applicable test results.', 'Verified label, instruction, and carrier/channel requirements.'],
      readinessCriteria: ['Packaging protects the approved product through defined distribution tests.', 'Required labels and instructions are reviewed and legible.', 'Shipping cost inputs use the measured sellable configuration.'],
      downstreamUnlocks: ['Final landed and fulfillment economics.', 'Fulfillment setup and shipping policies.', 'Accurate product-page shipping information.']
    },
    inventory_fulfillment_plan: {
      summary: 'An inventory and fulfillment decision plan. It does not invent demand, order quantities, storage needs, service levels, return rates, or replenishment timing.',
      knownContext,
      openDecisions: ['Initial order logic, demand scenarios, safety stock, reorder point, and cash exposure.', 'Receiving inspection, storage conditions, lot or batch traceability, pick/pack, shipping, and returns.', 'In-house versus third-party fulfillment responsibilities and service expectations.'],
      nextActions: ['Model conservative, base, and upside demand scenarios separately from evidence.', 'Compare fulfillment options using measured product/package data and written service terms.', 'Define receiving, defect, inventory-count, replenishment, return, and recall/escalation procedures.'],
      evidenceNeeded: ['Supplier minimums, lead times, defect terms, and replenishment constraints.', 'Measured storage and shipping configuration plus fulfillment quotations.', 'Validated demand evidence and documented working-capital limits.'],
      readinessCriteria: ['Order quantity follows an explicit scenario and cash-risk decision.', 'Receiving, storage, fulfillment, returns, and exception owners are assigned.', 'Reorder and stop conditions are measurable.'],
      downstreamUnlocks: ['Purchase-order approval.', 'Fulfillment onboarding.', 'Operational launch-readiness decision.']
    }
  };
  if (id === 'unit_economics_pricing_model') {
    return {
      summary: 'A unit-economics model structure. All monetary values remain inputs to collect; no price, cost, margin, demand, or acquisition performance is assumed.',
      knownContext,
      requiredInputs: ['Target retail price and discount/tax treatment.', 'Manufacturing, tooling allocation, inspection, packaging, and inbound freight.', 'Warehousing, pick/pack, outbound shipping subsidy, payment/platform fees, and returns.', 'Customer-acquisition allowance, support cost, defect reserve, and contribution-margin target.'],
      modelCalculations: ['Landed unit cost = manufacturing + allocated tooling/inspection + packaging + inbound freight.', 'Variable selling cost = fulfillment + shipping subsidy + payment/platform fees + returns/defect allowance.', 'Contribution margin = net revenue − landed unit cost − variable selling cost − acquisition allowance.', 'Break-even units = fixed launch costs ÷ contribution per unit, only when contribution is positive.'],
      nextActions: ['Collect comparable supplier and fulfillment quotations with assumptions.', 'Model conservative, base, and upside cases without treating any case as forecast evidence.', 'Test price acceptability with customers and alternatives before finalizing the commercial position.'],
      readinessCriteria: ['Every input has a named source, date, owner, and confidence level.', 'Margin remains acceptable under documented downside assumptions.', 'Price, minimum order, cash exposure, and replenishment logic are approved together.'],
      downstreamUnlocks: ['Supplier negotiation and order-quantity decisions.', 'Pricing position and promotional limits.', 'Inventory and launch investment approval.']
    };
  }
  return common[id] || null;
}

function defaultStructuredOutput(id, context, texts) {
  const safe = texts.filter(text => !/create the approved|completed prerequisite outputs|approved source context/i.test(text));
  const at = index => safe[index % Math.max(1, safe.length)] || 'To be confirmed';
  const physicalOutput = physicalPlanningOutput(id, context);
  if (physicalOutput) return physicalOutput;
  if (id === 'customer_profile') {
    const customer = groundedValue(context, 'primaryCustomer') || 'The priority customer segment';
    const motivation = groundedValue(context, 'customerMotivation') || 'the intended customer outcome';
    const style = groundedValue(context, 'communicationStyle') || 'Clear, credible, and reassuring';
    const inferred = strategyRole(context, 'primaryCustomer') === 'inferred_fact';
    if (['build_brand', 'promote_service', 'validate_idea'].includes(context?.objective)) {
      const subject = context?.objective === 'build_brand' ? 'brand direction' : context?.objective === 'promote_service' ? 'service offer' : 'idea hypothesis';
      return {
        summary: `${customer} is the current ${inferred ? 'inferred' : 'builder-established'} audience for this ${subject}. Validate the priorities below with real customers before relying on them for investment or performance decisions.`,
        primaryCustomer: `${customer}${inferred ? ' — inferred and requiring validation' : ''}`,
        needs: [`A credible way to address or evaluate ${motivation} without unsupported promises.`, 'Clear information about fit, process, tradeoffs, and the evidence supporting important statements.'],
        motivations: [`${motivation} is the current priority to validate in the customer’s own language.`, 'Confidence that the next step is relevant, transparent, and proportionate to their situation.'],
        objections: ['Unclear fit, proof, scope, or expected next steps may reduce trust.', 'The audience and priority may be too broad until repeated customer evidence establishes a sharper pattern.'],
        buyingTriggers: [`A clear connection between the ${subject} and ${motivation}, without implying a guaranteed result.`, 'Relevant proof, transparent limitations, and a practical low-risk next step.'],
        languageStyle: `${style}. Explain evidence and uncertainty plainly; avoid inflated, guaranteed, or unsubstantiated language.`
      };
    }
    return {
      summary: `${customer} is the current ${inferred ? 'inferred' : 'established'} audience for a product direction centered on ${motivation}. Treat this as a working customer hypothesis and validate the priorities below before launch investment.`,
      primaryCustomer: `${customer}${inferred ? ' — inferred from the product description and requiring validation' : ''}`,
      needs: [
        `A credible, easy-to-understand way to pursue ${motivation} without unsupported promises.`,
        'Clear information about intended use, product quality, and the evidence supporting any benefit statement.'
      ],
      motivations: [
        `${motivation} is the confirmed product direction; validate how strongly it motivates this audience.`,
        'Confidence that the product is transparent, appropriate, and supported by trustworthy information.'
      ],
      objections: [
        'Unclear product evidence, quality standards, or substantiation may reduce trust.',
        'A broad audience definition may feel generic until a more specific use context is validated.'
      ],
      buyingTriggers: [
        `A clear explanation of how the product direction relates to ${motivation}, without implying a certain outcome.`,
        'Transparent quality information, credible proof, and language that makes limitations clear.'
      ],
      languageStyle: `${style}. Explain evidence and uncertainty plainly; avoid inflated efficacy or medical language.`
    };
  }
  if (id === 'product_concept_brief') {
    const customer = groundedValue(context, 'primaryCustomer')
      || dependencyValue(context, 'customer_profile', 'primaryCustomer', 'the current priority customer');
    const motivation = groundedValue(context, 'customerMotivation') || 'the intended customer outcome';
    const directions = explorationDirections(context);
    const workingDirections = directions.length
      ? directions.map(conceptComparison)
      : ['Define the customer situation and product direction with prospective customers before selecting a concept.'];
    if (context?.objective === 'validate_idea') {
      return {
        conceptSummary: `A working idea for ${customer}, centered on the problem hypothesis (${motivation}). This is an assumptions map, not evidence that the problem, solution, or demand is validated.`,
        directionsToExplore: ['Problem: confirm frequency, severity, current workarounds, and who experiences it.', 'Solution: test comprehension, relevance, and required behavior before building.', 'Demand: test meaningful action or commitment rather than stated enthusiasm.'],
        customerAndNeed: `Interview people matching ${customer} and ask about recent behavior related to ${motivation} before describing the proposed solution.`,
        openDecisions: ['Which customer segment experiences the problem often enough to act.', 'Which current alternative is most important to compare.', 'What evidence threshold would justify building, revising, or stopping.'],
        evidenceBoundaries: ['Customer, problem, solution, and demand statements remain hypotheses.', 'AI plausibility, compliments, and unsourced opinions do not validate demand.'],
        nextDefinitionSteps: ['Rank assumptions by uncertainty and consequence.', 'Test the riskiest assumption with neutral questions or observable behavior.', 'Record source, sample, result, and decision against a pre-defined threshold.']
      };
    }
    return {
      conceptSummary: `A working product concept for the current audience (${customer}), centered on the intended outcome (${motivation}). This brief defines directions to explore; it does not establish a finished formula, efficacy, or product claim.`,
      directionsToExplore: workingDirections,
      customerAndNeed: `Validate how people in the current audience (${customer}) describe and prioritize the intended outcome (${motivation}), using their language rather than assuming a medical need or promised result.`,
      openDecisions: [
        'Product format, formulation, and ingredients remain open unless separately established.',
        'Competitive differentiation and customer-facing price position still require validation.',
        'Any benefit statement requires appropriate evidence before it can become a product claim.'
      ],
      evidenceBoundaries: [
        'Exploration choices are preferences to investigate, not confirmed product characteristics.',
        'No efficacy, clinical substantiation, certification, market demand, or competitive advantage is assumed.'
      ],
      nextDefinitionSteps: [
        'Interview prospective customers about the need, current alternatives, and decision criteria.',
        'Compare the selected concept directions for relevance, credibility, and responsible product-development feasibility.',
        'Document only the product facts and evidence that are actually established.'
      ]
    };
  }
  if (id === 'product_specification_brief') {
    const offer = builderOfferContext(context) || 'the proposed physical product';
    const customer = groundedValue(context, 'primaryCustomer') || 'the intended customer';
    const isFoodContainer = /lunch|food|container/i.test(offer);
    return {
      summary: `A working specification decision brief for ${offer}, intended for ${customer}. No material, dimension, capacity, construction, performance, safety, or compliance detail is established unless separately verified.`,
      knownContext: [`Builder-confirmed direction: ${offer}.`, `Current customer hypothesis: ${customer}.`, 'Current stage: idea validation; the specification remains open.'],
      openSpecificationDecisions: isFoodContainer
        ? ['Intended meal/use cases, capacity, exterior dimensions, weight, compartments, and portability.', 'Material system, insulation method, closures, seals, leak resistance, food-contact surfaces, and odor/stain behavior.', 'Cleaning method, durability, repairability, temperature-performance target, care instructions, and end-of-life considerations.']
        : ['Intended use cases, dimensions, weight, materials, components, interfaces, and variants.', 'Performance, durability, cleaning/maintenance, safety, accessibility, and environmental requirements.', 'Quality tolerances, packaging interface, instructions, warranty assumptions, and end-of-life considerations.'],
      validationMethods: ['Translate each important customer need into a measurable or observable requirement.', 'Compare concept alternatives and tradeoffs before selecting a specification.', 'Define prototype, sample, technical-review, and representative-use tests for every critical requirement.'],
      evidenceNeeded: ['Repeated customer use situations, constraints, and decision criteria.', 'Measured prototype or sample results with documented methods.', 'Qualified material, safety, compliance, manufacturing, and quality review where applicable.'],
      readinessCriteria: ['Every critical requirement has an owner, rationale, priority, and pass/fail method.', 'Unknowns and tradeoffs are explicit rather than silently assumed.', 'The approved revision can be issued consistently to prototype and supplier candidates.'],
      downstreamUnlocks: ['Comparable supplier RFQs and samples.', 'Prototype validation, compliance scoping, packaging, and cost modeling.', 'Responsible positioning and imagery based on verified product facts.']
    };
  }
  if (id === 'product_positioning') {
    const customer = decisionValue(context, 'primary_audience') || groundedValue(context, 'primaryCustomer')
      || dependencyValue(context, 'customer_profile', 'primaryCustomer', 'the priority customer');
    const market = groundedValue(context, 'marketPosition');
    const difference = groundedValue(context, 'competitiveApproach');
    const motivation = groundedValue(context, 'customerMotivation');
    const dependencyNeed = decisionValue(context, 'customer_need') || dependencyValue(context, 'customer_profile', 'needs', '');
    const need = motivation
      || (dependencyNeed && dependencyNeed !== 'To be confirmed' ? dependencyNeed.replace(/[.!?]+$/, '') : null)
      || 'the customer’s priority';
    const recommended = strategyRole(context, 'marketPosition') === 'strategic_recommendation';
    const nonProduct = ['build_brand', 'promote_service', 'validate_idea'].includes(context?.objective);
    const subject = context?.objective === 'build_brand' ? 'brand' : context?.objective === 'promote_service' ? 'service' : context?.objective === 'validate_idea' ? 'idea' : 'product';
    const objections = decisionValues(context, 'customer_objection');
    const explorations = decisionValues(context, 'exploration_direction');
    const constraints = decisionValues(context, 'proof_constraint');
    const conceptDirection = explorations[0];
    const positioningStatement = market
      ? `For ${customer} seeking ${motivation || need}, explore ${market} as ${recommended ? 'a recommended positioning direction' : 'the established market position'}. Anchor the story in ${need} and validate the direction before treating it as a customer claim.`
      : `For ${customer}, center the positioning hypothesis on their priority need: ${need}.${conceptDirection ? ` Use ${conceptDirection} only as a concept direction to test.` : ''} Confirm the market frame and competitive alternative before treating this direction as final.`;
    const differentiation = difference
      ? `${difference} is a strategic approach to validate; it is not established ${subject} proof.`
      : 'Competitive differentiation remains open and must be established through customer and market validation.';
    return {
      positioningStatement,
      marketPosition: market ? `${market}${recommended ? ' — recommended direction to validate' : ''}` : 'Open decision — market position requires validation',
      differentiation,
      proofPoints: [
        `Validate whether ${customer} prioritize ${need}.`,
        objections[0] ? `Determine what evidence would responsibly address this customer objection: ${objections[0]}.` : 'Identify the primary customer objection and the evidence needed to address it.',
        market ? `Test whether “${market}” is clear, relevant, and distinct to the intended customer.` : 'Compare credible market-position options before selecting one.',
        ...(constraints.length ? constraints.slice(0, 1) : [`Document substantiated ${subject} evidence before making benefit or performance claims.`])
      ].slice(0, 4),
      positioningPillars: [
        `Customer focus: ${customer}`,
        `Priority need: ${need}`,
        market ? `Market direction: ${market}` : 'Market direction: to be validated'
      ],
      messagingImplications: [
        `Lead with the customer priority—${need}—without implying an unverified outcome.`,
        difference ? `Use ${difference} as a credibility theme only after supporting evidence is established.` : 'Avoid uniqueness claims until a defensible difference is confirmed.',
        nonProduct ? `Keep ${subject} hypotheses, differentiation, proof, and outcome claims explicitly provisional until validated.` : 'Keep exploratory directions, formulation details, and efficacy claims explicitly provisional until validated.'
      ]
    };
  }
  if (id === 'value_proposition') {
    const customer = decisionValue(context, 'primary_audience') || groundedValue(context, 'primaryCustomer') || dependencyValue(context, 'customer_profile', 'primaryCustomer', 'the priority customer');
    const motivation = decisionValue(context, 'customer_need') || groundedValue(context, 'customerMotivation') || 'the intended customer outcome';
    const market = groundedValue(context, 'marketPosition');
    const position = decisionValue(context, 'positioning_direction') || dependencyValue(context, 'product_positioning', 'positioningStatement', 'the recommended positioning direction');
    const objection = decisionValues(context, 'customer_objection')[0];
    const difference = decisionValue(context, 'differentiation');
    const proof = decisionValues(context, 'proof_constraint');
    if (['build_brand', 'promote_service', 'validate_idea'].includes(context?.objective)) {
      const subject = context?.objective === 'build_brand' ? 'brand' : context?.objective === 'promote_service' ? 'service' : 'idea';
      return {
        primaryValueProposition: `For ${customer}, ${position} becomes a reason to investigate the ${subject} when it makes ${motivation} easier to evaluate than maintaining the status quo, with proof limited to what is established.`,
        customerProblemOrDesire: `${customer} may care about ${motivation}, but the relevance, priority, and preferred solution require customer evidence.`,
        promisedOutcome: `A clearer way to evaluate whether this ${subject} direction fits—not a guaranteed customer or business result.`,
        reasonsToBelieve: proof.length ? proof.slice(0, 3) : ['Verified expertise, offer facts, or operating evidence, once established.', 'Transparent explanation of scope, limitations, and the basis for important statements.', 'Customer evidence showing the direction is relevant and understandable.'],
        differentiators: [difference || (market ? `${market} is a recommended direction to test, not a confirmed competitive advantage.` : 'A distinct position must be validated before uniqueness can be claimed.'), objection ? `Address the status-quo concern without assuming it is universal: ${objection}` : 'Clarity and transparency become differentiators only when demonstrated consistently and supported by proof.'],
        supportingMessages: [`Built around ${motivation} for ${customer}, with evidence established before promotion.`, 'Clear about what is known, what remains a hypothesis, and what must be validated next.']
      };
    }
    return {
      primaryValueProposition: `For ${customer}, ${position} offers a clearer reason to investigate the product direction instead of keeping the current approach: it connects ${motivation} to transparent information, credible quality signals, and claims limited to established evidence.`,
      customerProblemOrDesire: `${customer} may want support related to ${motivation}, but need clarity and trust before deciding whether a product is relevant. Validate this problem framing with prospective customers.`,
      promisedOutcome: `A clearer, more confident way to evaluate a ${motivation} product direction—not a promise of a health result.`,
      reasonsToBelieve: proof.length ? proof.slice(0, 3) : [
        'Substantiated product and quality evidence, once established.',
        'Transparent explanation of intended use, limitations, and the basis for every benefit statement.',
        'Customer validation showing that the proposed direction is relevant and understandable.'
      ],
      differentiators: [difference || (market ? `${market} is the recommended market direction to test, not a confirmed competitive position.` : 'A market position must be validated before uniqueness can be claimed.'), objection ? `Investigate whether this objection shapes the choice against the status quo: ${objection}` : 'Credibility and transparency can become differentiators only when supported by real product proof.'],
      supportingMessages: [
        `Built around the customer interest in ${motivation}, with evidence established before promotion.`,
        'Clear about what is known, what remains a hypothesis, and what must be validated next.'
      ]
    };
  }
  if (id === 'validation_plan') {
    const customer = groundedValue(context, 'primaryCustomer')
      || dependencyValue(context, 'customer_profile', 'primaryCustomer', 'the current priority customer');
    const motivation = groundedValue(context, 'customerMotivation') || 'the intended customer outcome';
    const directions = dependencyValues(context, 'product_concept_brief', 'directionsToExplore');
    const concept = directions.length ? directions.join('; ') : 'the working product direction';
    if (context?.objective === 'validate_idea') {
      return {
        validationObjective: `Determine whether ${customer} experience and prioritize ${motivation}, use identifiable alternatives, and take a meaningful action when offered the proposed direction.`,
        hypotheses: [`Customer hypothesis: people matching ${customer} experience the problem often enough to seek a change.`, `Problem hypothesis: ${motivation} is important enough to influence behavior.`, 'Demand hypothesis: a defined share of qualified participants will take the pre-defined commitment action.'],
        customerQuestions: ['Tell me about the last time this problem occurred.', 'What did you do, what did it cost in time or money, and what was unsatisfactory?', 'What have you already tried or paid for?', 'What would need to be true for you to change your current approach?'],
        conceptTests: ['Run neutral problem interviews before presenting the idea.', 'Use a prototype or concept test to measure comprehension and next-step behavior.', 'When appropriate and ethical, run a clearly labeled smoke test with no false availability or fabricated proof.'],
        evidenceToCollect: ['Interview notes tied to participant fit and recent behavior.', 'Observed comprehension, objections, alternatives, and meaningful commitment actions.', 'Source, date, sample, result, and limitations for every test.'],
        decisionCriteria: ['Before testing, define the minimum repeated problem pattern and qualified sample.', 'Define the meaningful action threshold and time window; do not substitute compliments or clicks unless they are the chosen evidence.', 'Continue only if thresholds are met; revise when evidence isolates a changeable assumption; stop when the core problem or demand threshold fails.'],
        nextActions: ['Recruit participants who match the customer hypothesis without leading them.', 'Run the riskiest low-cost test and record disconfirming as well as supporting evidence.', 'Compare results with the pre-defined criteria and choose continue, revise, or stop.']
      };
    }
    return {
      validationObjective: `Determine whether people in the current audience (${customer}) recognize a meaningful need related to the intended outcome (${motivation}) and whether the working concept directions merit further product development.`,
      hypotheses: [
        `People in the current audience (${customer}) can describe a meaningful priority related to the intended outcome (${motivation}) in their own words.`,
        `At least one working direction—${concept}—is understandable and relevant enough to investigate further.`,
        'A credible position can be developed without relying on unsubstantiated claims or invented differentiation.'
      ],
      customerQuestions: [
        `How do you currently think about or address the intended outcome (${motivation})?`,
        'What makes an option in this category feel credible, relevant, or inappropriate?',
        'Which parts of this concept are clear, confusing, valuable, or unnecessary?'
      ],
      conceptTests: [
        'Present the directions as separate concept hypotheses and record customer language and preferences.',
        'Compare comprehension and relevance without presenting a finished product or promising an outcome.',
        'Test the provisional positioning and value language for clarity before producing launch assets.'
      ],
      evidenceToCollect: [
        'Repeated customer language, priorities, objections, and current alternatives.',
        'Concept comprehension and preference patterns from appropriately selected prospective customers.',
        'Product-development and substantiation requirements identified by qualified specialists.'
      ],
      decisionCriteria: [
        'A clearly described customer priority is repeated across credible conversations.',
        'One concept direction is consistently understood without unsupported prompting.',
        'The next product-development step can be stated without inventing formula, efficacy, demand, or differentiation.'
      ],
      nextActions: [
        'Recruit a small, relevant set of prospective customers for structured discovery conversations.',
        'Record evidence separately from assumptions and revise the concept brief only from validated learning.',
        'Defer listing, imagery, and launch campaigns until sufficient product facts and proof exist.'
      ]
    };
  }
  if (id === 'amazon_keyword_guidance') {
    const customer = groundedValue(context, 'primaryCustomer') || 'the intended customer';
    const motivation = groundedValue(context, 'customerMotivation') || 'the intended product outcome';
    const market = groundedValue(context, 'marketPosition') || 'the proposed market direction';
    const directions = explorationDirections(context);
    const seeds = Array.from(new Set((directions.length ? directions : [motivation])
      .flatMap(direction => amazonSeedTerms(direction, motivation))));
    return {
      summary: `Working Amazon search hypotheses for ${customer} around ${motivation}. These themes are starting points for marketplace research, not measured demand, competition, ranking, or search-volume evidence.`,
      content: [
        `Unmeasured seed terms to investigate: ${seeds.join('; ')}.`,
        `Core intent hypothesis: shoppers exploring ${motivation}; compare their wording with the seed terms before adoption.`,
        `Audience-language hypothesis: combine relevant seed terms with the non-medical language used by ${customer}.`,
        `Positioning hypothesis: phrases related to ${market}, tested for clarity before adoption.`,
        'Problem-language research: collect the exact non-medical words prospective customers use to describe their need or desired experience.',
        'Trust-language research: investigate quality, transparency, format, and evidence terms without implying certifications or proof that do not exist.',
        'Validation next step: review Amazon autocomplete, relevant listings, customer questions, and compliant category language before selecting keywords.'
      ]
    };
  }
  if (id === 'campaign_brief') {
    const audience = groundedValue(context, 'primaryCustomer') || 'Not established';
    const offer = groundedValue(context, 'confirmedOffer') || builderOfferContext(context) || 'Not established';
    const objective = groundedValue(context, 'businessObjective') || context?.strategicDirection || 'Establish a measurable customer-acquisition path.';
    const angle = groundedValue(context, 'marketingFocus') || groundedValue(context, 'competitiveApproach') || 'Lead with relevance, clarity, and a proportionate next step.';
    const cta = groundedValue(context, 'confirmedPrimaryCta') || 'Not established';
    const measurement = context?.semanticInsights?.measurementGoal?.value || 'Qualified customer action measured from actual records.';
    return {
      summary: `A coordinated campaign decision set for ${audience}. It preserves unresolved execution inputs rather than inventing them.`,
      content: [`Objective: ${objective}`, `Angle: ${angle}`, `Offer: ${offer}`, `Call to action: ${cta}`, 'Use only verified proof and measure actual qualified actions.'],
      campaignObjective: objective, primaryAudience: audience, offer, campaignAngle: angle, callToAction: cta,
      customerObjections: ['Clarify fit, scope, proof, process, and the next step before assuming a specific objection.'],
      proofConstraints: ['Use only confirmed offer facts and verified proof; do not invent outcomes, testimonials, urgency, prices, or performance.'],
      channelRoles: ['Landing page: explain fit and the conversion path.', 'Outreach: earn a reply through progressive relevance.', 'Paid ads: attract and qualify attention before the destination.'],
      measurementGoal: measurement,
      unresolvedQuestions: [cta === 'Not established' ? 'Which customer-facing call to action is appropriate?' : 'Which message angle produces the strongest qualified response?']
    };
  }
  if (id === 'search_evidence_snapshot') {
    const topic = groundedValue(context, 'topicTerritory') || groundedValue(context, 'marketingFocus') || 'the established topic territory';
    return {
      summary: 'A bounded snapshot of known search conditions and the measured evidence that remains unavailable.',
      content: [`Topic context: ${topic}.`, 'Current rankings, search volume, traffic, competitor performance, backlinks, and demand remain unknown unless supplied from dated records.'],
      evidenceStatus: 'Measured search performance is not established from the available information.',
      topicContext: String(topic).split(/\s*[,;]\s*/).filter(Boolean),
      evidenceConstraints: ['Do not invent keyword volume, rankings, traffic, backlinks, competition, or demand.', 'Treat supplied keywords and topics as hypotheses until reviewed against current evidence.'],
      unresolvedQuestions: ['Which queries currently produce qualified discovery?', 'Which existing pages earn impressions, visits, or conversions?', 'Where are the most important authority and content gaps?']
    };
  }
  if (id === 'search_strategy') {
    const topics = decisionValues(context, 'topic_territory');
    const territory = topics.length ? topics : ['the established topic territory'];
    const audience = decisionValue(context, 'primary_audience', groundedValue(context, 'primaryCustomer') || 'the intended reader');
    const evidenceStatus = decisionValue(context, 'search_evidence_status', 'Measured search evidence remains unresolved.');
    return {
      summary: `Build authority for ${audience} through a focused topic-and-intent system while measured performance remains explicit.`,
      content: [`Evidence boundary: ${evidenceStatus}`, `Authority direction: publish connected, decision-useful coverage of ${territory.join(', ')}.`, 'Validate query wording and performance before treating an intent or opportunity as measured.'],
      authorityDirection: `Build practical authority around ${territory.join(', ')} by answering connected decisions for ${audience}.`,
      topicTerritory: territory,
      searchIntentHypotheses: territory.map(topic => `${audience} seeking practical guidance about ${topic}`),
      evidenceConstraints: decisionValues(context, 'proof_constraint').length ? decisionValues(context, 'proof_constraint') : ['No search volume, ranking, traffic, competition, or demand claim is established.'],
      measurementDirection: 'Establish dated impressions, qualified visits, engagement, and content-assisted conversion before evaluating progress.',
      unresolvedQuestions: decisionValues(context, 'unresolved_question').length ? decisionValues(context, 'unresolved_question') : ['Which specific query and reader decision should receive first priority?']
    };
  }
  if (id === 'priority_content_brief') {
    const topics = decisionValues(context, 'topic_territory');
    const topic = topics[0] || 'the first validated topic opportunity';
    const intent = decisionValues(context, 'search_intent')[0] || `Readers seeking practical guidance about ${topic}`;
    const audience = decisionValue(context, 'primary_audience', groundedValue(context, 'primaryCustomer') || 'the intended reader');
    const authority = decisionValue(context, 'authority_direction', 'Build useful authority with decision-specific guidance.');
    const cta = groundedValue(context, 'confirmedPrimaryCta') || 'Not established';
    return {
      summary: `A focused content brief for one decision within ${topic}, derived from the approved search direction.`,
      content: [`Reader: ${audience}.`, `Question: How should ${audience} evaluate ${topic}?`, `Authority contribution: ${authority}`, `CTA status: ${cta}`],
      specificTopic: topic,
      readerQuestion: `How should ${audience} evaluate ${topic} and choose an appropriate next step?`,
      searchIntentHypothesis: intent,
      contentAngle: `A practical decision guide that explains tradeoffs, evidence to review, and next-step criteria for ${topic}.`,
      scope: `Cover the reader's decision, key considerations, evidence boundaries, and a proportionate next step; exclude unsupported search-performance claims.`,
      callToActionStatus: cta,
      evidenceLimits: decisionValues(context, 'proof_constraint').length ? decisionValues(context, 'proof_constraint') : ['Do not imply measured demand, rankings, traffic, or competitive advantage without dated evidence.']
    };
  }
  if (id === 'priority_search_article') return generateSearchArticle(context);
  if (id === 'amazon_listing') {
    const product = builderProductContext(context);
    if (!product) return { summary: 'To be confirmed', content: ['To be confirmed'] };
    const customer = groundedValue(context, 'primaryCustomer') || 'the confirmed audience';
    const motivation = groundedValue(context, 'customerMotivation') || 'the confirmed product purpose';
    const market = groundedValue(context, 'marketPosition');
    return {
      summary: `Working Amazon listing draft based on the builder-provided product context: ${product}. Verify every product fact and applicable marketplace requirement before publishing.`,
      content: [
        `${product}`,
        `Created for ${customer}, this product offers a straightforward way to explore ${motivation.toLowerCase()} based on the confirmed product details.`,
        market ? `${market}. Review the available details to decide whether this product fits your needs.` : 'Review the available product details to decide whether it fits your needs.',
        'See the confirmed product information, usage directions, quantity, warnings, and policies on this page before purchasing.'
      ]
    };
  }
  if (id === 'amazon_bullet_points') {
    const product = builderProductContext(context);
    if (!product) return { summary: 'To be confirmed', content: ['To be confirmed'] };
    const customer = groundedValue(context, 'primaryCustomer') || 'the confirmed audience';
    const motivation = groundedValue(context, 'customerMotivation') || 'the confirmed product purpose';
    return {
      summary: `Working Amazon bullet-point directions for ${product}. These drafts organize established context and must be verified before publication.`,
      content: [
        `PRODUCT — ${product}.`,
        `WHO IT IS FOR — Designed for ${customer}.`,
        `PURPOSE — A practical product direction for people considering ${motivation.toLowerCase()}.`,
        'CLEAR DETAILS — Review the confirmed format, quantity, materials, and usage information shown on this page.',
        'PURCHASE WITH CONTEXT — Check the current warnings, policies, and care information before deciding.'
      ]
    };
  }
  if (ACQUISITION_DELIVERABLES.has(id) || OTHER_CONTENT_TYPES[id]) {
    return genericDraftOutput(id, context);
  }
  if (id === 'core_messaging') {
    const customer = groundedValue(context, 'primaryCustomer')
      || dependencyValue(context, 'customer_profile', 'primaryCustomer', 'the intended customer');
    const motivation = groundedValue(context, 'customerMotivation') || 'the intended customer outcome';
    const market = groundedValue(context, 'marketPosition');
    const value = dependencyValue(context, 'value_proposition', 'primaryValueProposition', '');
    const position = dependencyValue(context, 'product_positioning', 'positioningStatement', '');
    const supportingMessages = dependencyValues(context, 'value_proposition', 'supportingMessages');
    const reasonsToBelieve = dependencyValues(context, 'value_proposition', 'reasonsToBelieve');
    const implications = dependencyValues(context, 'product_positioning', 'messagingImplications');
    const style = groundedValue(context, 'communicationStyle') || 'Clear, credible, and reassuring';
    if (['build_brand', 'promote_service'].includes(context?.objective)) {
      const subject = context?.objective === 'build_brand' ? 'brand' : 'service';
      return {
        coreMessage: value || position || `Help ${customer} evaluate whether this ${subject} is relevant to ${motivation} through clear information, appropriate proof, and an honest next step.`,
        messagePillars: [`Customer relevance: connect the ${subject} to ${motivation} for ${customer} without guaranteeing an outcome.`, market ? `Positioning: use ${market} as a direction to validate rather than a claim of superiority.` : 'Positioning: explain the intended role before claiming a distinct position.', 'Credibility: support expertise, differentiation, and outcome statements with verified evidence.'],
        supportingPoints: supportingMessages.length >= 2 ? supportingMessages : [`Explain how the ${subject} relates to ${motivation} in the customer’s language.`, 'Separate established facts from recommendations and hypotheses.', ...implications.slice(0, 1)],
        toneGuidance: `${style}. Keep the voice consistent, specific, and human; avoid hype, certainty, or unsupported superiority.`,
        proofThemes: reasonsToBelieve.length >= 2 ? reasonsToBelieve : ['Verified expertise and operating facts.', 'Transparent scope, process, limitations, and policies.', 'Permissioned customer evidence when it is genuinely available.'],
        callsToAction: ['Invite the customer to review the established details.', 'Offer a clear, proportionate next step without false urgency.']
      };
    }
    return {
      coreMessage: value || position || `Help ${customer} evaluate a product direction related to ${motivation} through clear information, credible evidence, and appropriately limited claims.`,
      messagePillars: [
        `Customer relevance: connect the message to ${motivation} for ${customer} without promising an outcome.`,
        market ? `Market direction: use ${market} as a positioning hypothesis until customer and competitive validation support it.` : 'Market clarity: explain the intended role of the product before claiming a distinct position.',
        'Credibility: support every benefit statement with confirmed product facts and substantiated evidence.'
      ],
      supportingPoints: supportingMessages.length >= 2 ? supportingMessages : [
        `Explain what the product is intended to help ${customer} evaluate or pursue regarding ${motivation}.`,
        'Separate established product facts from hypotheses, recommendations, and details still requiring validation.',
        ...implications.slice(0, 1)
      ],
      toneGuidance: `${style}. Be specific about what is known and avoid medical, efficacy, superiority, or certainty language unless it is substantiated.`,
      proofThemes: reasonsToBelieve.length >= 2 ? reasonsToBelieve : [
        'Confirmed product attributes and quality information.',
        'Transparent explanation of intended use, limitations, and evidence.',
        'Customer validation demonstrating that the message is relevant and understandable.'
      ],
      callsToAction: [
        'Invite the customer to review the confirmed product information.',
        'Use a low-commitment next step until the product definition, evidence, and offer are finalized.'
      ]
    };
  }
  if (id === 'product_image_guidance') {
    const product = builderProductContext(context) || builderOfferContext(context);
    if (!product) return { creativeDirection: 'To be confirmed', visualConcepts: ['To be confirmed'], requiredShots: ['To be confirmed'], compositionGuidance: ['To be confirmed'], lightingAndColor: 'To be confirmed', productionNotes: ['To be confirmed'], avoidances: ['To be confirmed'] };
    const positioning = dependencyValue(context, 'product_positioning', 'positioningStatement', 'Use the approved positioning direction as a hypothesis to validate.');
    return {
      creativeDirection: `Create a clear visual system for ${product}. Treat the builder description as unverified context and depict only product attributes confirmed before production.`,
      visualConcepts: [`Product-first concept grounded in the verified form and packaging of ${product}.`, `Context concept supporting this positioning direction without illustrating an unverified outcome: ${positioning}`],
      requiredShots: ['Primary product hero image with accurate scale and packaging.', 'Verified detail view and neutral context image.'],
      compositionGuidance: ['Keep the product and confirmed use context clear at a glance.', 'Leave room for copy without embedding unverified claims in the image.'],
      lightingAndColor: strategyValue(context, 'visualStyle', 'Use clear, brand-consistent lighting and color that preserves accurate product appearance.'),
      productionNotes: ['Confirm packaging, dimensions, materials, labels, required disclosures, and every depicted attribute before the shoot.'],
      avoidances: ['Avoid unsupported before-and-after implications, efficacy cues, certifications, ingredients, misleading scale, or unverified product features.']
    };
  }
  if (id === 'launch_announcement') {
    const message = dependencyValue(context, 'core_messaging', 'coreMessage', 'Introduce the confirmed offer clearly and without unsupported promises.');
    return { subjectLine: strategyValue(context, 'launchHeadline', 'A new solution, built around what matters'), previewText: message, headline: strategyValue(context, 'launchHeadline', 'Meet the new offer'), body: message, keyBenefits: [dependencyValue(context, 'core_messaging', 'supportingPoints', 'Review the confirmed offer details and supporting evidence.')], callToAction: dependencyValue(context, 'core_messaging', 'callsToAction', 'Learn more') };
  }
  if (id === 'educational_content') {
    const need = dependencyValue(context, 'customer_profile', 'needs', 'the customer’s priority');
    const lesson = dependencyValue(context, 'core_messaging', 'supportingPoints', at(0));
    return { title: `A practical guide to ${need}`, learningObjective: `Understand the key considerations surrounding ${need}.`, introduction: lesson, keyLessons: [lesson], practicalTakeaways: [`Evaluate options against confirmed needs and evidence.`], conclusion: `A clear decision starts with the customer need and credible proof.`, callToAction: 'Take the next appropriate step when ready.' };
  }
  if (id === 'social_launch_campaign') {
    const message = dependencyValue(context, 'core_messaging', 'coreMessage', at(0));
    const supportingPoint = dependencyValue(context, 'core_messaging', 'supportingPoints', 'Review the confirmed offer details, limitations, and supporting evidence before deciding.');
    const nextStep = dependencyValue(context, 'core_messaging', 'callsToAction', 'Review the available details and choose the next step that fits.');
    return { campaignTheme: strategyValue(context, 'launchApproach', 'Education before promotion'), campaignObjective: 'Introduce the offer clearly and build confidence through confirmed value.', posts: [message, supportingPoint, nextStep], hashtags: ['#Launch'], visualDirections: ['Use brand-consistent product imagery that supports the message.'], postingSequence: ['Introduce the customer need', 'Explain the value', 'Invite the next step'] };
  }
  return { summary: at(0), content: safe.length ? safe : ['Deliverable content to be confirmed.'] };
}

function violatesMarketplaceEvidenceSafety(output) {
  const text = JSON.stringify(output);
  return /\b(?:search volume|monthly searches|market size|competition (?:level|score)|demand (?:metric|score|volume)|ranking difficulty|keyword (?:opportunity )?score)\s*(?:is|of|:|=)?\s*\d/i.test(text)
    || /\b\d[\d,]*(?:\.\d+)?\s+(?:monthly\s+)?searches\b/i.test(text);
}
function formatContext(context) {
  if (Array.isArray(context?.evidenceLedger)) return renderEvidenceLedger(context.evidenceLedger);
  const lines = [];
  Object.entries(context.strategySnapshot || {}).forEach(([key, item]) => {
    const value = item?.value;
    if (value && value !== 'Unknown') {
      const prefix = item.semanticRole === 'strategic_recommendation' ? 'Recommended '
        : item.semanticRole === 'confirmed_fact' ? 'Confirmed '
          : item.semanticRole === 'inferred_fact' ? 'Inferred '
            : item.semanticRole === 'builder_provided_context' ? 'Builder-provided context (not observed evidence) '
              : item.semanticRole === 'unresolved' ? 'Unresolved '
                : item.semanticRole === 'derived_risk' ? 'Derived ' : '';
      lines.push(`${prefix}${humanLabel(key)}: ${Array.isArray(value) ? value.join('; ') : value}`);
    }
  });
  (context.dependencyOutputs || []).forEach(dependency => {
    const values = Object.entries(dependency.output || {}).slice(0, 8).map(([key, value]) => `${humanLabel(key)}: ${Array.isArray(value) ? value.join('; ') : value}`);
    lines.push(`${dependency.title}: ${values.join(' | ')}`);
  });
  if (context.brandContext) {
    const brand = context.brandContext;
    if (brand.businessName) lines.push(`Confirmed brand name: ${brand.businessName}`);
    if (brand.voice) lines.push(`Confirmed brand voice: ${brand.voice}`);
    if (brand.uniqueValue) lines.push(`Builder-provided value context: ${brand.uniqueValue}`);
    if (brand.keyMessages) lines.push(`Builder-provided key-message context: ${brand.keyMessages}`);
  }
  return lines.join('\n').slice(0, 8000);
}

function makeContract(id, definition) {
  const dependencies = minimumProductionDependencies(id);
  const artifactPolicy = getProductionArtifactPolicy(id);
  if (!artifactPolicy) throw new Error(`Production artifact policy is missing for ${id}.`);
  const labels = Object.fromEntries(Object.keys(definition.schema).map((key, index) => [key, definition.labels[index]]));
  const internalKeys = id === 'research_evidence_pack'
    ? new Set(['sources', 'evidenceItems', 'claimMappings', 'rejectedSources', 'researchTrace', 'providerSummary', 'researchOperations', 'researchAvailabilityStatus', 'noExternalEvidenceRequired', 'essentialEvidenceMissing'])
    : artifactPolicy.readyToUse ? (INTERNAL_SECTION_KEYS[id] || new Set()) : new Set(Object.keys(definition.schema));
  const sectionRoles = Object.freeze(Object.fromEntries(Object.keys(definition.schema).map(key => [
    key, internalKeys.has(key) ? 'internal_guidance' : 'public_copy'
  ])));
  const publicFieldKeys = Object.freeze(Object.keys(definition.schema).filter(key => sectionRoles[key] === 'public_copy'));
  const internalFieldKeys = Object.freeze(Object.keys(definition.schema).filter(key => sectionRoles[key] === 'internal_guidance'));
  const ctaFieldKeys = Object.freeze(CTA_FIELD_KEYS[id] || []);
  const synthesisVersion = {
    campaign_brief: 4, product_positioning: 4, value_proposition: 4,
    outreach_sequence: 5, lead_capture_page: 5, paid_ad_copy_set: 4,
    search_evidence_snapshot: 4, search_strategy: 4, priority_content_brief: 4,
    priority_search_article: 2, research_evidence_pack: 3
  }[id];
  const versionNumber = id === 'consultation_conversion_brief' || id === 'consultation_conversion_page_copy' ? 1
    : synthesisVersion || (id === 'organic_content_campaign' ? 16
    : ['outreach_sequence', 'lead_capture_page'].includes(id) ? 4 : 3);
  const version = `${id}:v${versionNumber}`;
  const compatibleVersions = Object.freeze(id === 'priority_search_article'
    ? ['priority_search_article:v1']
    : id === 'research_evidence_pack' ? ['research_evidence_pack:v1', 'research_evidence_pack:v2']
    : Array.from({ length: Math.max(0, versionNumber - 1) }, function(_, index) { return `${id}:v${index + 2}`; }));
  function validationFailures(output, context) {
    const failures = [];
    const candidateVersion = Number(String(context?.contractVersion || '').match(/:v(\d+)$/)?.[1]);
    const historicalGenericSchema = ['campaign_brief', 'search_evidence_snapshot', 'search_strategy', 'priority_content_brief'].includes(id)
      && candidateVersion && candidateVersion < 4;
    const candidateSchema = id === 'research_evidence_pack' && candidateVersion < 3
      ? Object.fromEntries(Object.entries(definition.schema).filter(([key]) => candidateVersion === 1 ? !['providerSummary', 'researchAvailabilityStatus', 'researchOperations', 'researchStatus', 'questionsChecked', 'supportedQuestionCount', 'questionsNeedingEvidence', 'sourcesUsedCount', 'lastCheckedAt', 'limitationNote'].includes(key) : !['researchOperations', 'researchStatus', 'questionsChecked', 'supportedQuestionCount', 'questionsNeedingEvidence', 'sourcesUsedCount', 'lastCheckedAt', 'limitationNote'].includes(key)))
      : id === 'priority_search_article'
      ? candidateVersion === 1
        ? Object.fromEntries(Object.entries({ ...definition.schema, articleBlocks: 'blocks' }).filter(([key]) => key !== 'sources'))
        : { ...definition.schema, articleBlocks: 'article_blocks_v2' }
      : historicalGenericSchema ? { summary: 'string', content: 'array' } : definition.schema;
    if (!validateSchema(output, candidateSchema)) failures.push('SCHEMA');
    if (id === 'outreach_sequence' && !(
      [output?.email1Body, output?.email2Body, output?.email3Body]
        .every(body => nonEmptyString(body) && body.trim().length >= 180 && /\n|\b(?:Hi|Hello)\b/i.test(body))
      && output?.sendPlan?.length >= 3
      && output?.personalizationChecklist?.length >= 2
      && output?.complianceChecklist?.length >= 2
    )) failures.push('OUTREACH_STRUCTURE');
    const requiredCta = groundedValue(context, 'confirmedPrimaryCta');
    if (requiredCta && ctaFieldKeys.length && !ctaFieldKeys.every(function(key) {
      const values = Array.isArray(output?.[key]) ? output[key] : [output?.[key]];
      return values.some(value => String(value || '').includes(requiredCta));
    })) failures.push('CTA_FIDELITY');
    if (id === 'organic_content_campaign') {
      const articleWords = wordCount(output?.introduction);
      const headingCount = (String(output?.introduction || '').match(/(?:^|\n)#{1,3}\s+\S/g) || []).length;
      if (articleWords < 650 || articleWords > 1800) failures.push('ORGANIC_LENGTH');
      if (headingCount < 4 || /^\s*#\s+/m.test(String(output?.introduction || ''))) failures.push('ORGANIC_HEADINGS');
      if (!Array.isArray(output?.outline) || output.outline.length < 5) failures.push('ORGANIC_OUTLINE');
      if (!Array.isArray(output?.distributionPosts) || output.distributionPosts.length < 2) failures.push('ORGANIC_DISTRIBUTION');
    }
    if (PLACEHOLDER_FREE_DELIVERABLES.has(id) && /\bTo be confirmed\b/i.test(JSON.stringify(output))) failures.push('PLACEHOLDER');
    if (MEASURED_EVIDENCE_FREE_DELIVERABLES.has(id) && violatesMarketplaceEvidenceSafety(output)) failures.push('MEASURED_EVIDENCE');
    return failures;
  }
  return Object.freeze({
    id, title: definition.displayType || humanLabel(id), version, compatibleVersions, contentType: definition.contentType,
    displayType: definition.displayType || (artifactPolicy.readyToUse ? humanLabel(id) : 'Planning Foundation'),
    artifactRole: artifactPolicy.role,
    billingUnits: artifactPolicy.billingUnits,
    readyToUse: artifactPolicy.readyToUse,
    artifactRoleLabel: artifactPolicy.label,
    validationProfile: profileForDeliverable(id, artifactPolicy.readyToUse),
    synthesisContract: require('./productionDependencySynthesis').CONSUMERS[id] || null,
    requiredContext: ['objective', 'strategySnapshot', 'strategicDirection'], requiredDependencies: dependencies,
    outputSchema: definition.schema,
    providerOutputSchema: id === 'organic_content_campaign' ? organicProviderSchema(definition.schema)
      : id === 'priority_search_article' ? searchArticleProviderSchemaV2() : definition.schema,
    sectionLabels: labels, sectionRoles, publicFieldKeys, internalFieldKeys, ctaFieldKeys,
    usefulnessContract: id === 'organic_content_campaign' ? Object.freeze({
      policy: 'decision_usefulness_v2', minimumDevelopedSections: 5, minimumConcreteActions: 8,
      minimumScopeBoundaries: 3, minimumTopicDimensions: 4, minimumConfirmedEvidenceReferences: 2
    }) : id === 'priority_search_article' ? Object.freeze({
      policy: 'search_editorial_usefulness_v2', minimumDevelopedSections: 5, minimumConcreteActions: 5
    }) : null,
    claimProvenanceContract: id === 'organic_content_campaign' ? Object.freeze({
      policy: 'claim_provenance_v1', supportField: 'claimSupport', minimumCoverage: 1,
      allowedSources: Object.freeze(['public_claim', 'conditional_guidance', 'general_guidance'])
    }) : null,
    acceptsVersion(candidate) { return candidate === version || compatibleVersions.includes(candidate); },
    buildPrompt(context) {
      const source = formatContext(context);
      const compositionBrief = id === 'organic_content_campaign'
        ? renderCompositionBrief(context?.compositionBrief || buildOrganicCompositionBrief(context))
        : '';
      const uncertaintyInstruction = PLACEHOLDER_FREE_DELIVERABLES.has(id)
        ? 'Do not use placeholder text such as “To be confirmed.” Express material uncertainty in complete customer-facing language (for example, explain that evidence or a decision still requires validation), and omit unsupported details that are not useful to the deliverable.'
        : 'Use only established facts. Mark genuinely unknown proof or details as “To be confirmed” instead of inventing them.';
      const leadCaptureSafety = id === 'lead_capture_page'
        ? [
            groundedValue(context, 'confirmedPrimaryCta')
              ? `CTA fidelity requirement: primaryCallToAction must be exactly "${groundedValue(context, 'confirmedPrimaryCta')}". Do not paraphrase, broaden, or replace it.`
              : '',
            'Treat builder-described page experience as supplied context, not proof of customer behavior. Do not convert plausible pain points, objections, operational conditions, or outcomes into facts unless the approved context explicitly identifies observed evidence.',
            'If observed conversion friction or proof is unresolved, omit the unsupported claim from public copy or use neutral customer-facing language. Never explain evidence policy, claim validation, editorial review, or what marketers should add later inside public page fields.',
            'The public Proof Section must be finished visitor-facing reassurance grounded in confirmed service scope, process transparency, or a concrete next step. When no verified proof exists, do not mention claims, evidence requirements, testimonials, performance promises, validation, approval, publishing, or future content.',
            'Every FAQ item must answer a genuine prospective-customer question about the offer, fit, scope, process, price, or next step. Never ask or answer questions about the page, copy, claims, evidence, compliance, publishing, marketing review, or performance promises.',
            'pageGoal and publishingChecklist are internal review fields. All other fields are public landing-page copy and must contain only words suitable for prospective customers.'
          ].filter(Boolean).join(' ')
        : '';
      const consultationSafety = id === 'consultation_conversion_page_copy'
        ? [
            'Create finished service-page copy for a consultation conversion path. Use the confirmed CTA exactly in both CTA fields.',
            'Do not use ecommerce language such as shopper, cart, shipping, returns, checkout, purchase behavior, or product comprehension.',
            'Do not invent years in business, project counts, ratings, awards, certifications, response times, warranties, service areas, pricing, financing, licenses, guarantees, testimonials, availability, or timelines.',
            'Keep editorialReviewNotes internal. Every other field must be complete visitor-facing copy rather than instructions to a marketer or publisher.'
          ].join(' ')
        : '';
      const roleInstruction = artifactPolicy.readyToUse
        ? [
            publicFieldKeys.length ? `Public-copy fields: ${(id === 'organic_content_campaign' ? ['pillarTitle', 'articleBlocks', 'callToAction', 'distributionPosts'] : publicFieldKeys).join(', ')}. These fields must contain only finished audience-facing copy that can be copied or published as written.` : '',
            internalFieldKeys.length ? `Internal-guidance fields: ${(id === 'organic_content_campaign' ? internalFieldKeys.filter(key => key !== 'claimSupport') : internalFieldKeys).join(', ')}. Put strategy, intent, outlines, validation notes, testing advice, publishing instructions, and checklists only in these fields.` : '',
            'Never place internal guidance, evidence-policy commentary, unconfirmed operational status, or instructions to the publisher inside a public-copy field.'
          ].filter(Boolean).join(' ')
        : 'Every field is internal planning guidance and must not be presented as customer-facing copy.';
      const organicContentSafety = id === 'organic_content_campaign'
        ? [
            blockPromptInstruction(),
            'The articleBlocks collectively form the complete pillar article draft. Write 800 to 1,600 substantive words across developed blocks that follow the internal outline. Block headings become H2 headings; do not repeat the pillar title as a heading.',
            'Keep each section distinct. Do not restate the same premise, audience description, service benefit, or next step across multiple sections merely to increase length.',
            'Perform an editorial pass before returning the asset. Remove malformed transitions, duplicated words, punctuation-spacing errors, sentence fragments, awkward keyword insertions, and unsupported absolutes. Preserve exact confirmed facts and CTA wording while using appropriately scoped language for guidance.',
            'Make the article operationally useful on its first draft: include at least eight concrete checks, decisions, or actions and begin action sentences with at least five distinct verbs (for example, compare, identify, confirm, document, ask, verify, choose, or review). Do not satisfy this by repeating generic advice.',
            'Do not describe missing SEO evidence, validation policy, content strategy, search intent, optimization work, or measurement instructions in the article draft or distribution posts.',
            'Do not invent audience beliefs, behaviors, challenges, or preferences, and do not present broad efficacy claims as facts. Avoid unsupported statements such as “owners often begin,” “they want,” “the challenge is often,” “good bookkeeping gives,” or “a clear process usually works.” Address the confirmed audience directly, describe the confirmed offer, or use genuinely conditional language.',
            'Distribution posts are drafts for future use. Do not call an article, guide, post, page, or content new, latest, newly published, or newly released, and do not claim it was published, launched, released, or updated unless that operational status is confirmed in source context. Describe the subject directly without implying that publication has happened. Do not use bracketed placeholders such as [link]; write standalone post copy that can be paired with the publishing platform’s link field.',
            'The backend constructs the internal claimSupport audit map from articleBlocks. Declare each block accurately; never output claimSupport yourself. Local, tax, legal, numeric, audience-behavior, and service-capability statements require a confirmed_fact block with matching confirmed ledger IDs or must be rewritten as properly scoped guidance.',
            groundedValue(context, 'confirmedPrimaryCta')
              ? `CTA fidelity requirement: callToAction must reproduce the confirmed CTA exactly: "${groundedValue(context, 'confirmedPrimaryCta')}". Supporting context may precede it, but the exact CTA text must appear unchanged.`
              : 'No CTA wording was confirmed. Use a neutral next step tied to the confirmed offer and do not invent a booking, trial, purchase, or contact action.'
          ].join(' ')
        : '';
      const searchEditorialSafety = id === 'priority_search_article'
        ? [
            'Create a search-informed article that answers the selected reader question early, develops distinct explanatory sections, and provides a practical framework, checklist, process, example, or decision criteria.',
            'Return structured articleBlocks with heading and claims fields. Every claim has a stable claimKey, text, evidenceRequired flag, and evidenceKeys selected only from approved external evidence. Citation numbers are system-owned.',
            'Use only confirmed product or service capabilities. Do not invent integrations, automation, AI features, security, compliance, pricing, certifications, results, citations, statistics, rankings, traffic, keyword metrics, or search performance.',
            'Do not use unsupported authority language such as research shows, studies prove, experts agree, or according to recent data. Clearly hypothetical examples and transparent arithmetic are allowed.',
            'If the CTA is unresolved, return an empty callToAction and finish with a useful conclusion. Never invent a trial, demo, booking, purchase, or contact action.',
            'For finance, accounting, legal, regulated, local-service, health, or supplement topics, stay within stable general education. Avoid current rules, deadlines, permits, costs, timelines, efficacy, treatment, dosage, interactions, and safety assurances unless verified evidence explicitly supports them.',
            'Use neutral professional language unless a confirmed brand voice is supplied. Do not promise ranking, optimization, traffic, or performance.'
          ].join(' ')
        : '';
      const safety = id === 'amazon_keyword_guidance'
        ? 'Present search directions, keyword themes, and marketplace terms only as hypotheses to investigate. Do not claim or invent search volume, market size, competition levels, demand metrics, ranking difficulty, keyword scores, or any measured Amazon evidence.'
        : id === 'product_positioning'
          ? 'Make the positioning decision-useful: identify the audience and priority need, frame the market position as established or as a hypothesis to validate, state the differentiation status, list concrete evidence to establish, and provide at least three actionable messaging implications. Do not return generic branding language or treat a recommendation as proven market fact.'
        : id === 'product_concept_brief'
          ? 'Treat product directions as exploration intent only. Do not convert them into ingredients, formulation facts, efficacy, certifications, substantiated claims, or a finished-product specification.'
          : id === 'validation_plan'
            ? 'Produce a plan for gathering evidence, not research findings. Do not invent interview results, demand, market size, search volume, competition metrics, efficacy, or substantiation.'
            : COPY_READY_ACQUISITION_ASSETS.has(id)
              ? (id === 'outreach_sequence'
                ? 'Write three distinct, complete, copy-ready emails—not an outline. Each body must include a greeting, multiple useful sentences, a clear low-friction next step, and a sign-off. Use bracketed placeholders only for recipient, sender, business, booking-link, and legally required footer details. Include subject lines, preview text, send timing, personalization steps, and a compliance checklist. Do not fabricate proof, results, pricing, urgency, testimonials, or recipient-specific facts.'
                : 'Write complete, copy-ready customer-acquisition material for every field in the contract. Do not return an outline, advice about what to write, or strategy presented as final copy. Put marketer, publisher, testing, and compliance instructions only in fields explicitly named as plans or checklists. Every headline, description, ad body, landing-page section, message, and FAQ must be finished copy addressed to the intended audience—not commentary about creating, testing, verifying, or publishing it. Use bracketed placeholders only where a real business, recipient, link, price, proof point, policy, or operational detail must be inserted. Include practical publishing, testing, personalization, or compliance checks required by the schema. Do not fabricate proof, results, pricing, urgency, testimonials, targeting facts, or recipient-specific facts.')
            : ['product_specification_brief', 'prototype_sample_validation_plan', 'sourcing_manufacturer_brief',
              'compliance_evidence_checklist', 'unit_economics_pricing_model',
              'packaging_shipping_requirements', 'inventory_fulfillment_plan'].includes(id)
              ? 'Produce a decision and evidence plan, not fabricated product facts or completed research. Do not invent specifications, materials, dimensions, performance, suppliers, quotations, costs, prices, margins, certifications, legal conclusions, demand, inventory quantities, shipping rates, or fulfillment capabilities.'
        : '';
      const outputInstruction = artifactPolicy.readyToUse
        ? `Produce the customer-ready ${context.title}.`
        : `Prepare the internal planning foundation titled ${context.title}.`;
      return [outputInstruction, 'Return the finished deliverable only; do not describe the task or quote instructions, schemas, contract metadata, or source context.', 'Use factual evidence according to its permitted-use boundaries. Confirmed facts may support public statements. Strategic dependency decisions may guide structure but must not be presented as observed facts. Omit unresolved claims.', roleInstruction, uncertaintyInstruction, safety, leadCaptureSafety, consultationSafety, organicContentSafety, searchEditorialSafety, compositionBrief ? `Intermediate composition brief:\n${compositionBrief}` : '', context.synthesisSummary || '', id === 'priority_search_article' && context.externalEvidenceSummary ? context.externalEvidenceSummary : '', `Purpose: ${context.strategicDirection}`, source ? `Approved source context:\nEvidence and provenance ledger\n${source}` : ''].filter(Boolean).join('\n\n');
    },
    normalizeOutput(results, context) {
      return results?.[0]?.structuredOutput !== undefined ? results[0].structuredOutput : defaultStructuredOutput(id, context, rawTexts(results));
    },
    normalizeProviderOutput(output, context) {
      if (id === 'organic_content_campaign' && Array.isArray(output?.articleBlocks)) return compileOrganicBlocks(output, context);
      if (id === 'priority_search_article' && Array.isArray(output?.articleBlocks)) {
        const usedEvidenceKeys = new Set(output.articleBlocks.flatMap(block => block.claims || []).flatMap(claim => claim.evidenceKeys || []));
        const usedSourceKeys = new Set((context?.externalEvidence?.propositions || []).filter(item => usedEvidenceKeys.has(item.evidenceKey)).map(item => item.sourceKey));
        const normalized = {
          ...output,
          articleBlocks: output.articleBlocks.map(block => ({
            ...block,
            body: (block.claims || []).map(claim => claim.text).join(' ')
          })),
          sources: (context?.externalEvidence?.sources || []).filter(source => usedSourceKeys.has(source.sourceKey)).map(source => ({
            ...source,
            evidenceKeys: (context?.externalEvidence?.propositions || []).filter(item => item.sourceKey === source.sourceKey && usedEvidenceKeys.has(item.evidenceKey)).map(item => item.evidenceKey)
          }))
        };
        const compiled = compileArticleCitations(normalized, context?.externalEvidence);
        return { ...normalized, articleBlocks: normalized.articleBlocks.map((block, index) => ({ ...block, body: compiled.blocks[index]?.body || block.body })) };
      }
      return output;
    },
    generateOutput(context) {
      return defaultStructuredOutput(id, context, []);
    },
    validateOutput(output, context) { return validationFailures(output, context).length === 0; },
    validationFailures(output, context) { return Object.freeze(validationFailures(output, context)); },
    presentOutput(output, rawResults) {
      const articleCompilation = id === 'priority_search_article'
        ? compileArticleCitations(output, { propositions: (output.articleBlocks || []).flatMap(block => block.claims || []).flatMap(claim => (claim.evidenceKeys || []).map(evidenceKey => ({ evidenceKey, sourceKey: (output.sources || []).find(source => source.sourceKey && evidenceKey.includes(source.sourceKey))?.sourceKey }))), sources: output.sources || [] })
        : null;
      const text = id === 'priority_search_article'
        ? [`# ${output.title}`, output.summary, ...(articleCompilation?.blocks || []).map(block => `## ${block.heading}\n\n${block.body}`), `## Practical Takeaways\n\n${(output.practicalTakeaways || []).map(item => `- ${item}`).join('\n')}`, output.conclusion, output.callToAction, ...(articleCompilation?.publicSources?.length ? [`## Sources\n\n${articleCompilation.publicSources.map(source => `[${source.number}] ${source.publisher} — ${source.title} — ${source.canonicalUrl}`).join('\n')}`] : [])].filter(Boolean).join('\n\n')
        : Object.entries(output).map(([key, value]) => `${labels[key] || humanLabel(key)}: ${Array.isArray(value) ? value.join('; ') : value}`).join('\n\n');
      return [{ text, tone: rawResults?.[0]?.tone || 'professional' }];
    },
    presentationSections(output) {
      const hiddenPresentationKeys = id === 'research_evidence_pack'
        ? new Set(['sources', 'evidenceItems', 'claimMappings', 'rejectedSources', 'researchTrace', 'providerSummary', 'researchOperations', 'researchAvailabilityStatus', 'noExternalEvidenceRequired', 'essentialEvidenceMissing'])
        : id === 'priority_search_article' ? new Set(['sources']) : new Set();
      const sections = Object.keys(definition.schema).filter(key => !hiddenPresentationKeys.has(key) && output?.[key] !== undefined && !(key === 'callToAction' && !String(output[key] || '').trim())).map(key => ({
        key,
        label: labels[key] || humanLabel(key),
        value: id === 'priority_search_article' && key === 'articleBlocks'
          ? output[key].map(block => `## ${String(block.heading).replace(/^#+\s*/, '')}\n\n${block.body || (block.claims || []).map(claim => claim.text).join(' ')}`).join('\n\n')
          : id === 'research_evidence_pack' && key === 'researchAvailabilityStatus'
            ? humanLabel(String(output[key]).replace(/_/g, ' '))
          : output[key],
        isList: Array.isArray(output[key]) && !(id === 'priority_search_article' && key === 'articleBlocks'),
        role: sectionRoles[key],
        internal: sectionRoles[key] === 'internal_guidance',
        format: MARKDOWN_FIELD_KEYS[id]?.has(key) ? 'markdown' : 'plain_text',
        guidanceLabel: sectionRoles[key] !== 'internal_guidance' ? null
          : /(?:searchIntent|outline)/i.test(key) ? 'Hypothesis'
            : /checklist/i.test(key) ? 'Checklist'
              : /(?:plan|sequence)/i.test(key) ? 'Recommended plan'
                : id === 'priority_search_article' ? 'Editorial review' : 'Strategy recommendation'
      }));
      if (id === 'priority_search_article' && Array.isArray(output?.sources) && output.sources.length) {
        sections.push({
          key: 'publicSources', label: 'Sources',
          value: output.sources.map((source, index) => `[${index + 1}] ${source.publisher} — ${source.title}${source.publicationDate ? ` (${source.publicationDate})` : ''} — ${source.canonicalUrl}`).join('\n'),
          isList: false, role: 'public_copy', internal: false, format: 'markdown', guidanceLabel: null
        });
      }
      return sections;
    }
  });
}

const contracts = Object.freeze(Object.fromEntries(Object.entries(DEFINITIONS).map(([id, definition]) => [id, makeContract(id, definition)])));
function getProductionContract(id) { return contracts[id] || null; }
function getProductionContractIds() { return Object.keys(contracts); }
module.exports = { getProductionContract, getProductionContractIds };
