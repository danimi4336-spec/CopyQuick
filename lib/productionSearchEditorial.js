const GENERIC_OPENING = /\b(?:in today['’]s (?:fast-paced )?(?:digital world|competitive landscape)|whether you(?:'re| are) a beginner or (?:a )?seasoned professional|unlock the power of|take your business to the next level)\b/i;
const UNSUPPORTED_AUTHORITY = /\b(?:research shows|studies (?:show|prove)|data (?:shows|demonstrates)|industry benchmarks show|experts agree|according to (?:recent data|google|the irs|a \d{4} study))\b/i;
const APPARENT_CITATION = /(?:\[\d+\]|\([A-Z][A-Za-z-]+(?: et al\.)?,?\s+20\d{2}\)|https?:\/\/\S+|\baccording to a 20\d{2} study\b)/i;
const SEARCH_PERFORMANCE_CLAIM = /\b(?:\d[\d,.]*\s+(?:monthly )?searches|keyword volume|search volume|rank(?:s|ed|ing)?\s+(?:#?\d+|first|top)|\d+(?:\.\d+)?%\s+(?:more )?(?:traffic|clicks|conversions)|(?:traffic|clicks|conversions).{0,24}\d+(?:\.\d+)?%|low competition|high-volume keyword|will rank|ranking-ready)/i;
const UNSUPPORTED_RESULT = /\b(?:customer|client|business)\s+(?:increased|reduced|improved|saved|grew).{0,80}\b\d+(?:\.\d+)?%/i;
const PRODUCT_CAPABILITY = /\b(?:integrates? with|integration with|AI-powered|automatically (?:reconciles|categorizes|creates)|SOC\s*2|HIPAA compliant|bank-grade security|plans? (?:start|starting) at \$)\b/i;
const FINANCE_RESTRICTED = /\b(?:must file|filing deadline|tax deadline|required by (?:law|GAAP|the IRS)|deductible|tax treatment|recognize revenue in tax year)\b/i;
const LOCAL_RESTRICTED = /\b(?:permit required|building code requires|licensed in every|costs? \$\d|takes? \d+ (?:days|weeks|months)|returns? \d+(?:\.\d+)?%|ROI of \d)/i;
const HEALTH_RESTRICTED = /\b(?:treats?|cures?|prevents?|diagnoses?|dose|dosage|safe for everyone|no side effects|interacts? with medication|clinically proven|reduces? (?:disease|symptoms?|inflammation)|boosts? immunity)\b/i;
const INTERNAL_TERM = /\b(?:synthesisTrace|sourceDeliverable|sourceField|permittedUses|SYNTHESIS_[A-Z_]+|production_job_id|deliverable_id|contract_version)\b/i;

function clean(value) { return String(value || '').trim().replace(/\s+/g, ' '); }
function words(value) { return clean(value).toLowerCase().match(/[a-z0-9]+/g) || []; }
function resolved(value) { return clean(value) && !/^(?:not established|unknown|unresolved|to be confirmed)$/i.test(clean(value)); }
function decision(context, concept, fallback = '') {
  return context?.synthesis?.decisions?.find(item => item.concept === concept && !item.unresolved)?.value || fallback;
}
function decisions(context, concept) {
  return (context?.synthesis?.decisions || []).filter(item => item.concept === concept && !item.unresolved).map(item => item.value);
}

function riskClassification(context) {
  const text = [decision(context, 'content_topic'), decision(context, 'reader_question'), decision(context, 'offer'), context?.strategyText].join(' ').toLowerCase();
  if (/\b(?:supplement|wellness|health|medical|disease|treatment|dosage|efficacy|interaction)\b/.test(text)) return 'claim_restricted';
  if (/\b(?:accounting|bookkeeping|invoice|cash flow|finance|tax|legal|permit|building code|remodel|contractor)\b/.test(text)) return 'review_sensitive';
  return 'standard';
}

function topicProfile(topic, question, audience) {
  const text = `${topic} ${question}`.toLowerCase();
  if (/\b(?:invoic\w*|receivable\w*|cash flow|bookkeep\w*|account\w*)\b/.test(text)) return {
    opening: `A useful way for ${audience} to approach ${topic} is to connect each invoice to a repeatable review of what has been billed, what has been received, and what is still outstanding. That distinction makes the records useful for decisions without turning the article into tax or accounting advice.`,
    blocks: [
      ['Start with the business question', `Define the decision the records need to support before changing a workflow. For ${audience}, that may mean seeing which invoices are open, when payment is expected, and which follow-up deserves attention. Keep invoiced amounts separate from cash actually received so the review answers the question clearly.`],
      ['Build a consistent invoice record', 'Record the customer, issue date, due date, amount, status, and payment date in the same way each time. Consistency makes it easier to compare open items and notice missing information. Review source documents when a value is unclear instead of filling the gap from memory.'],
      ['Review receivables on a practical cadence', 'Choose a review cadence that matches the pace of the business. During each review, identify newly issued invoices, confirm recorded payments, list overdue items, and note promised follow-up dates. The purpose is a current working view, not a prediction about future cash.'],
      ['Connect invoices to cash visibility', 'Compare expected incoming payments with cash already received and near-term obligations. An invoice is evidence that an amount was billed; it is not the same as money in the bank. Use that distinction to frame questions, prepare follow-up, and identify where better records are needed.'],
      ['Use a short review checklist', 'At each review, ask whether every issued invoice is recorded, every received payment is matched, every outstanding item has an owner, and every uncertain status has a follow-up date. Note exceptions separately. A short repeated checklist can make the working view easier to understand without implying that the records predict future results.'],
      ['Choose the next improvement', 'Look for one recurring source of uncertainty: missing due dates, inconsistent status labels, delayed payment recording, or unclear follow-up ownership. Improve that checkpoint first, document the new routine, and review whether it produces a clearer view before adding more process.']
    ]
  };
  if (/\b(?:remodel|renovation|kitchen|bathroom|contractor|home)\b/.test(text)) return {
    opening: `For ${audience}, evaluating ${topic} starts with a clear project scope, the decisions that must be made, and the evidence needed before work begins. A planning framework can improve the conversation without assuming local permit rules, exact costs, fixed timelines, or return on investment.`,
    blocks: [
      ['Define the outcome and boundaries', 'Write down which spaces are involved, what must change, what should remain, and which constraints matter to the household. Separate essential outcomes from preferences. This gives later conversations a stable scope without pretending that early assumptions are final specifications.'],
      ['Document existing conditions', 'Record dimensions, access constraints, visible damage, current layouts, and known household needs. Use photographs and notes as discussion aids, while leaving structural, code, permit, and hidden-condition conclusions to appropriately qualified local review.'],
      ['Compare approaches consistently', 'Ask each potential approach to address the same scope, responsibilities, exclusions, decision points, and change process. A consistent comparison makes differences easier to understand without relying on unsupported price ranges or universal schedule claims.'],
      ['Plan decision checkpoints', 'Identify when selections, approvals, access arrangements, and owner decisions need to occur. Clarify who records changes and how questions are resolved. These checkpoints make the process easier to follow even though the actual sequence depends on the project and local requirements.'],
      ['Ask for comparable explanations', 'Invite each professional to explain assumptions, exclusions, dependencies, and the process for handling changes. Record answers in the same categories rather than comparing isolated promises. When a question depends on local requirements or hidden conditions, identify the qualified review needed instead of treating a general article as the final answer.'],
      ['Prepare a useful next conversation', 'Bring the scope, condition notes, priorities, and open questions to the next discussion. Ask what needs professional or local verification. The result should be a better-defined decision, not a promise about cost, duration, permits, licensing, or financial return.']
    ]
  };
  return {
    opening: `For ${audience}, the practical answer to “${question}” is to define the decision, compare the available approaches against the same criteria, and verify any claim that depends on current or business-specific evidence. The framework below turns ${topic} into a usable next step without inventing performance or product facts.`,
    blocks: [
      ['Clarify the decision', `State what ${audience} needs to decide about ${topic}, what a useful outcome looks like, and which uncertainties could change the choice. A precise decision keeps the actual reader question at the center of the explanation.`],
      ['Map the current situation', 'List the information already known, the process currently used, and the points where confusion or delay appears. Separate confirmed observations from assumptions so the next step does not depend on unsupported claims.'],
      ['Compare practical options', 'Use the same criteria for each option: fit, effort, dependencies, limitations, evidence, and reversibility. Explain tradeoffs directly. Avoid treating a strategic hypothesis as proof that one approach will perform better.'],
      ['Test the smallest useful change', 'Choose a bounded action that can clarify the decision. Record what will be changed, what will be observed, and what result would justify continuing. Keep performance claims out of the explanation when supporting evidence is unavailable.'],
      ['Use a repeatable review', 'Create a short review that asks what changed, which assumption was confirmed, which uncertainty remains, and who owns the next action. Apply the same questions each time so the decision can improve without relying on a vague impression or unsupported performance language.'],
      ['Review and choose the next step', 'Compare the result with the original question, note remaining evidence gaps, and decide whether to continue, revise, or seek qualified input. This creates a practical progression while keeping unresolved facts visible.']
    ]
  };
}

function generateSearchArticle(context) {
  const audience = decision(context, 'primary_audience', 'the intended reader');
  const topic = decision(context, 'content_topic');
  const question = decision(context, 'reader_question');
  const angle = decision(context, 'content_angle', 'a practical decision guide');
  const scope = decision(context, 'content_scope', 'Explain the decision, practical considerations, and a proportionate next step.');
  const intent = decision(context, 'search_intent', 'Not established');
  const limits = decisions(context, 'evidence_limit');
  const cta = decision(context, 'customer_facing_cta');
  const profile = topicProfile(topic, question, audience);
  const articleBlocks = [
    { heading: 'A direct answer', body: profile.opening },
    ...profile.blocks.map(([heading, body]) => ({ heading, body }))
  ];
  const risk = riskClassification(context);
  return {
    title: `${clean(topic).replace(/^./, value => value.toUpperCase())}: a practical guide`,
    summary: `${angle} for ${audience}, focused on the question: ${question}`,
    articleBlocks,
    practicalTakeaways: [
      `Define the exact decision ${audience} needs to make about ${topic}.`,
      'Separate confirmed information from assumptions and evidence still needed.',
      'Use a consistent process or set of criteria, then review what the result clarifies.'
    ],
    conclusion: `The strongest next step is the one that answers “${question}” with a clearer decision and an honest view of what still requires verification. Use the framework above within this scope: ${scope}`,
    callToAction: resolved(cta) ? cta : '',
    evidenceOpportunities: limits.length ? limits : ['Add verified current or business-specific evidence where it would materially strengthen the explanation.'],
    claimsToVerify: risk === 'review_sensitive'
      ? ['Review any tax, legal, regulatory, local, or current professional requirement before publishing.']
      : risk === 'claim_restricted' ? ['Do not publish efficacy, treatment, dosage, interaction, or safety claims without adequate verified evidence.']
        : ['Verify any current, quantified, comparative, or product-specific claim before publishing.'],
    productFactsUsed: decisions(context, 'offer'),
    editorialReviewNotes: [`Ready for editorial review. Search intent remains a hypothesis: ${intent}`, `Topic risk: ${risk.replace('_', ' ')}.`]
  };
}

function articleText(output) {
  return [output?.title, output?.summary, ...(output?.articleBlocks || []).flatMap(block => [block?.heading, block?.body]), ...(output?.practicalTakeaways || []), output?.conclusion, output?.callToAction].filter(Boolean).join('\n');
}

function searchEditorialFailures(output, context = {}) {
  const failures = [];
  const text = articleText(output);
  const opening = output?.articleBlocks?.[0]?.body || '';
  const topic = decision(context, 'content_topic');
  const question = decision(context, 'reader_question');
  const angle = decision(context, 'content_angle');
  const risk = riskClassification(context);
  if (!topic || !question) failures.push({ rule: 'missing_editorial_decision' });
  if (GENERIC_OPENING.test(opening)) failures.push({ rule: 'generic_opening', field: 'articleBlocks[0]' });
  if (UNSUPPORTED_AUTHORITY.test(text)) failures.push({ rule: 'unsupported_authority_language' });
  if (APPARENT_CITATION.test(text)) failures.push({ rule: 'fabricated_citation' });
  if (SEARCH_PERFORMANCE_CLAIM.test(text)) failures.push({ rule: 'unsupported_search_performance' });
  if (UNSUPPORTED_RESULT.test(text)) failures.push({ rule: 'unsupported_customer_result' });
  if (PRODUCT_CAPABILITY.test(text)) failures.push({ rule: 'unsupported_product_capability' });
  if (FINANCE_RESTRICTED.test(text)) failures.push({ rule: 'unsupported_finance_requirement' });
  if (LOCAL_RESTRICTED.test(text)) failures.push({ rule: 'unsupported_local_service_claim' });
  if (HEALTH_RESTRICTED.test(text)) failures.push({ rule: 'restricted_health_claim' });
  if (INTERNAL_TERM.test(text)) failures.push({ rule: 'internal_metadata_leak' });
  if (!Array.isArray(output?.articleBlocks) || output.articleBlocks.length < 5 || output.articleBlocks.some(block => words(block?.body).length < 30)) failures.push({ rule: 'insufficient_domain_depth' });
  const normalizedBodies = (output?.articleBlocks || []).map(block => clean(block.body).toLowerCase());
  if (new Set(normalizedBodies).size !== normalizedBodies.length) failures.push({ rule: 'repetitive_sections' });
  const publicTokens = new Set(words(text));
  const anchors = [topic, question, angle].filter(Boolean).map(value => words(value).filter(token => token.length > 4));
  if (anchors.filter(tokens => tokens.some(token => publicTokens.has(token))).length < 2) failures.push({ rule: 'brief_drift' });
  const practical = (output?.practicalTakeaways || []).join(' ');
  if (!/\b(?:define|separate|use|review|compare|identify|record|choose|confirm|list|ask)\b/i.test(practical)) failures.push({ rule: 'insufficient_practical_value' });
  const cta = decision(context, 'customer_facing_cta');
  if (!resolved(cta) && clean(output?.callToAction)) failures.push({ rule: 'unresolved_cta_published' });
  if (resolved(cta) && clean(output?.callToAction) !== clean(cta)) failures.push({ rule: 'cta_mismatch' });
  if (risk === 'claim_restricted' && HEALTH_RESTRICTED.test(`${topic} ${question}`)) failures.push({ rule: 'claim_restricted_topic' });
  return failures;
}

function providerSchema() {
  return Object.freeze({
    title: 'string', summary: 'string',
    articleBlocks: { type: 'array', minItems: 5, items: { type: 'object', properties: { heading: { type: 'string' }, body: { type: 'string' } }, required: ['heading', 'body'], additionalProperties: false } },
    practicalTakeaways: 'array', conclusion: 'string', callToAction: { type: 'string' },
    evidenceOpportunities: 'array', claimsToVerify: 'array',
    productFactsUsed: { type: 'array', items: { type: 'string' } }, editorialReviewNotes: 'array'
  });
}

module.exports = {
  articleText, generateSearchArticle, providerSchema, riskClassification, searchEditorialFailures
};
