const { contentTypes, getContentTypeKeys, isValidContentType } = require('./contentTypes');

const toneAliases = {
  professional: 'professional',
  friendly: 'casual',
  casual: 'casual',
  luxury: 'professional',
  scientific: 'professional',
  christian: 'inspirational',
  inspirational: 'inspirational',
  bold: 'urgent',
  urgent: 'urgent',
  playful: 'casual',
  humorous: 'humorous',
  minimal: 'professional'
};

const contentTypeAliases = {
  email: 'email_campaign',
  emails: 'email_campaign',
  headline: 'ad_headline',
  headlines: 'ad_headline',
  ad: 'ad_headline',
  ads: 'ad_headline',
  ad_copy: 'ad_headline',
  copy: 'sales_message',
  product: 'product_description',
  product_descriptions: 'product_description',
  product_description: 'product_description',
  social: 'social_post',
  social_posts: 'social_post',
  social_post: 'social_post'
};

const MAX_CUSTOM_TONE_LENGTH = 160;
const MIN_SAFE_VARIATIONS = 5;
const UNSUPPORTED_TEMPLATE_FACTS = [
  /\b\d+%\s+(?:off|discount|effective|improvement|return|roi)\b/i,
  /\b(?:use|apply)\s+code\s+[A-Z0-9_-]+\b/i,
  /\b(?:only|just)\s+\d+\s+(?:spots?|copies|units?|items?)\b/i,
  /\b(?:few|limited number of)\s+(?:spots?|copies|units?|items?)\b/i,
  /\b(?:spots? (?:are )?filling|copies? left|in stock|supply is limited)\b/i,
  /\b(?:flash sale|last chance|final (?:call|hours?)|time is running out|offer expires?|deal ends?|price goes up)\b/i,
  /\b(?:the )?roi (?:of .{0,80} )?is clear\b/i,
  /\b(?:top )?(?:industry )?leaders? (?:are )?using\b/i,
  /\b(?:science says|clinically proven|guaranteed results?)\b/i,
  /\b(?:delivers unparalleled results|achieve remarkable results)\b/i,
  /\b(?:the data is clear|consistently outperform|transforming the (?:industry|way)|game-changing solution)\b/i,
  /\bchanged the way I work\b/i,
  /\bgiving away (?:a |an )?(?:free )?/i,
  /\bdeclared ['“\"]?.{0,80}['”\"]? by\b/i,
  /\b\d+ out of \d+ said\b/i
];

function normalizePromptValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return '';
  return String(value).trim();
}

function resolveTone(tone) {
  if (tone === null || tone === undefined) {
    return { templateTone: 'professional', customGuidance: '' };
  }
  if (typeof tone !== 'string') {
    return { templateTone: 'professional', customGuidance: '' };
  }

  const trimmed = tone.trim();
  if (!trimmed) {
    return { templateTone: 'professional', customGuidance: '' };
  }

  if (trimmed.length > MAX_CUSTOM_TONE_LENGTH) {
    const error = new Error('Custom tone is too long');
    error.code = 'CUSTOM_TONE_TOO_LONG';
    throw error;
  }

  const key = trimmed.toLowerCase();
  const templateTone = toneAliases[key];
  if (templateTone) {
    return { templateTone, customGuidance: '' };
  }

  return {
    templateTone: 'professional',
    customGuidance: trimmed
  };
}

function normalizeTone(tone) {
  return resolveTone(tone).templateTone;
}

function normalizeContentType(contentType) {
  const raw = normalizePromptValue(contentType);
  const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (contentTypeAliases[key]) return contentTypeAliases[key];
  if (isValidContentType(key)) return key;

  const labelMatch = Object.entries(contentTypes).find(([, label]) => {
    return label.toLowerCase() === raw.toLowerCase();
  });
  if (labelMatch) return labelMatch[0];

  const singularLabelMatch = Object.entries(contentTypes).find(([, label]) => {
    return label.toLowerCase().replace(/s$/, '') === raw.toLowerCase().replace(/s$/, '');
  });
  if (singularLabelMatch) return singularLabelMatch[0];

  return key;
}

function renderTemplate(template, values) {
  return template
    .replace(/{{product}}/g, values.product)
    .replace(/{{audience}}/g, values.audience || 'your audience');
}

function isEvidenceSafeTemplate(template) {
  return typeof template === 'string' && !UNSUPPORTED_TEMPLATE_FACTS.some(pattern => pattern.test(template));
}

const templates = {
  subject_line: {
    professional: [
      "A Practical Introduction to {{product}}",
      "What {{audience}} Should Know About {{product}}",
      "Evaluating {{product}} for Your Current Priorities",
      "A Clear Guide to {{product}}",
      "Is {{product}} the Right Fit for {{audience}}?"
    ],
    casual: [
      "Hey {{audience}}, have you seen {{product}}?",
      "Checking in: How's your work with {{product}} going?",
      "Quick question about {{product}}",
      "You might like this: {{product}}",
      "So, we made this thing called {{product}}...",
      "Think {{audience}} would dig {{product}}?",
      "Better late than never: {{product}} is here!",
      "Just some thoughts on {{product}}",
      "Ready to try something new? {{product}}",
      "No more boring days with {{product}}"
    ],
    urgent: [
      "Important Details to Review About {{product}}",
      "Is {{product}} a Priority for {{audience}} Right Now?",
      "Your Next Step with {{product}}",
      "Before You Decide on {{product}}",
      "A Timely Look at {{product}} for {{audience}}"
    ],
    humorous: [
      "{{product}}, Minus the Dramatic Sales Pitch",
      "A Surprisingly Clear Look at {{product}}",
      "{{product}} Has Entered the Conversation",
      "Five Minutes, One Useful Look at {{product}}",
      "The No-Hype Guide to {{product}}"
    ],
    inspirational: [
      "Explore What Is Possible with {{product}}",
      "Move Your Vision Forward: Evaluate {{product}}",
      "A Thoughtful Next Step with {{product}}",
      "Consider {{product}} for the Journey Ahead",
      "Build Your Next Decision Around Clear {{product}} Details"
    ]
  },
  social_post: {
    professional: [
      "{{audience}} evaluating {{product}} should start with the available details, practical fit, and questions that still need answers.",
      "A professional decision about {{product}} begins with clear information. Review what is established before choosing the next step.",
      "Considering {{product}}? Compare its documented characteristics with the priorities that matter to {{audience}}.",
      "The right choice depends on context. Here is a focused way for {{audience}} to assess {{product}} without relying on hype.",
      "Put clarity first when reviewing {{product}}: understand the offer, confirm the evidence, and evaluate the fit."
    ],
    casual: [
      "Hey {{audience}}, is {{product}} worth a closer look? Start with the details that matter to you.",
      "A quick, no-pressure introduction to {{product}}: what is known, what to compare, and what to ask next.",
      "Curious about {{product}}? Here is a clear overview without pretending every option fits everyone.",
      "Put {{product}} on the shortlist only if the facts line up with what {{audience}} actually need.",
      "Let us make {{product}} easier to evaluate with useful information and fewer buzzwords."
    ],
    urgent: [
      "If {{product}} is relevant to a current priority, {{audience}} can review the available details and choose a next step today.",
      "Need to evaluate {{product}} soon? Start with the facts, fit, and open questions that matter to {{audience}}.",
      "A timely decision about {{product}} still deserves clear information. Here is what {{audience}} should confirm first.",
      "Move the evaluation of {{product}} forward by identifying what is established and what {{audience}} still need to verify.",
      "When timing matters, clarity matters too. Give {{audience}} a direct route to the current information about {{product}}."
    ],
    humorous: [
      "{{product}} has entered the feed—fortunately, it brought useful details instead of a dramatic reveal.",
      "No miracle claims here. Just a clearer way for {{audience}} to take a look at {{product}}.",
      "Marketing buzzwords took the day off. Here is what {{audience}} can actually evaluate about {{product}}.",
      "A plot twist everyone can handle: {{product}} may fit some needs and not others. Check the details.",
      "{{product}} does not need to be the hero of the story. It just needs to make sense for {{audience}}."
    ],
    inspirational: [
      "A meaningful next step starts with a clear decision. Explore whether {{product}} aligns with what matters to {{audience}}.",
      "New possibilities deserve thoughtful evaluation. Take a closer look at {{product}} and the details that support it.",
      "Move forward with clarity: review {{product}}, ask the important questions, and choose the path that fits.",
      "For {{audience}} considering a new direction, {{product}} may be one option worth evaluating carefully.",
      "Turn curiosity into an informed next step by learning what is established about {{product}}."
    ]
  },
  ad_headline: {
    professional: [
      "A Clear Look at {{product}}",
      "Evaluate {{product}} for Your Business",
      "{{product}} Details for {{audience}}",
      "Is {{product}} the Right Strategic Fit?",
      "Make an Informed Choice About {{product}}"
    ],
    casual: [
      "Take a Look at {{product}}",
      "Curious About {{product}}?",
      "The Clear Version of {{product}}",
      "See If {{product}} Fits",
      "What to Know About {{product}}"
    ],
    urgent: [
      "Review {{product}} Today",
      "Is {{product}} Right for {{audience}} Now?",
      "Take the Next Step with {{product}}",
      "Evaluate {{product}} with Clear Information",
      "See What to Confirm About {{product}}"
    ],
    humorous: [
      "{{product}}, Without the Hype",
      "A Less Dramatic Look at {{product}}",
      "{{product}} Has Entered the Chat",
      "Useful Details, Featuring {{product}}",
      "See What {{product}} Is About"
    ],
    inspirational: [
      "Explore Your Next Step with {{product}}",
      "Bring Clarity to Your {{product}} Decision",
      "Consider What {{product}} Could Support",
      "Move Your Plan Forward with Clear Information",
      "Start by Evaluating {{product}}"
    ]
  },
  cta: {
    professional: [
      "Learn More About {{product}}",
      "Review the {{product}} Details",
      "Explore Whether {{product}} Fits",
      "Ask a Question About {{product}}",
      "Consider the Next Step with {{product}}"
    ],
    casual: [
      "Take a Look at {{product}}",
      "See What {{product}} Is About",
      "Tell Me More About {{product}}",
      "Explore {{product}}",
      "See If {{product}} Fits"
    ],
    urgent: [
      "Review {{product}} Now",
      "See Whether {{product}} Fits",
      "Confirm the Details",
      "Choose My Next Step",
      "Evaluate {{product}} Today"
    ],
    humorous: [
      "Okay, Show Me {{product}}",
      "I Am Curious About {{product}}",
      "Let Me See the Details",
      "Give Me the Clear Version",
      "See What {{product}} Is All About"
    ],
    inspirational: [
      "Explore a Thoughtful Next Step",
      "Move Forward with Clear Information",
      "See What {{product}} Could Support",
      "Take the Next Informed Step",
      "Consider {{product}} for the Journey Ahead"
    ]
  },
  product_description: {
    professional: [
      "Meet {{product}}. Review the available details, compare them with your priorities, and decide whether this option belongs on your shortlist.",
      "{{product}} offers customers a clear starting point for evaluation. Confirm the specifications, features, and terms that matter before making a decision.",
      "Consider {{product}} when reviewing the options available to you. Focus on the documented characteristics and ask for any details that have not yet been established.",
      "{{product}} is ready for a closer look. Explore what is included, how it may fit your needs, and which information you should verify next.",
      "Take an informed look at {{product}}. The available facts can help you compare the fit without relying on exaggerated promises or unsupported claims."
    ],
    casual: [
      "Say hello to {{product}}. Take a look at the details, see how they compare with what you need, and ask about anything that is still unclear.",
      "Curious about {{product}}? Start with what is known, check the important specifics, and decide whether you want to explore it further.",
      "Here is {{product}}, without the hard sell. Review the available information and see whether it makes sense for your shortlist.",
      "{{product}} may be worth a closer look. Compare the documented features with your priorities before choosing a next step.",
      "Get to know {{product}} at your own pace. The right decision starts with clear details and honest answers to your questions."
    ],
    urgent: [
      "Need to evaluate {{product}} today? Review the current details, identify what still needs confirmation, and choose the next step that fits.",
      "Take a focused look at {{product}} now. Compare the available facts with your priorities before moving forward.",
      "Move your decision about {{product}} forward with clear information—not invented deadlines, scarcity, or promises.",
      "Review {{product}}, confirm the specifications that matter, and decide whether it belongs on your current shortlist.",
      "When timing matters, start with the facts. {{product}} deserves a direct evaluation grounded in the information available."
    ],
    humorous: [
      "Meet {{product}}—no dramatic reveal, just the details you need to decide whether it deserves a place on your shortlist.",
      "{{product}} has entered the shopping conversation. Check the facts, ask the awkwardly practical questions, and make the call.",
      "Here is {{product}}, served without a side of miracle claims. Review what is known and verify what matters to you.",
      "{{product}} may or may not be your next great find. Fortunately, the available details can help you decide.",
      "Take a clear look at {{product}}. Marketing theatrics are optional; understanding the actual offer is not."
    ],
    inspirational: [
      "Explore {{product}} as one possible step toward your goals. Start with the established details and decide whether the fit supports the direction ahead.",
      "A thoughtful choice begins with clarity. Review {{product}}, confirm what matters to you, and move forward with confidence in the information.",
      "Consider where {{product}} may fit in your plans. The best next step is one grounded in clear facts and realistic expectations.",
      "{{product}} invites a closer look. Use the available details to understand the option and choose the path that feels right for you.",
      "Turn curiosity about {{product}} into an informed decision. Explore what is known, ask what remains open, and take the next step deliberately."
    ]
  },
  email_campaign: {
    professional: [
      "Subject: A Practical Introduction to {{product}}\n\nHi {{audience}},\n\nHere is a clear overview of {{product}}, the available details, and the questions worth considering before a next step.",
      "Subject: Is {{product}} Relevant to Your Priorities?\n\nDear {{audience}},\n\nTake a focused look at {{product}} and compare the established information with what you currently need.",
      "Subject: What to Know About {{product}}\n\nHello {{audience}},\n\nThis summary explains what is known about {{product}} and identifies any details that should be confirmed.",
      "Subject: A Practical Look at {{product}} for {{audience}}\n\nHi there,\n\nHere are the product details and questions worth reviewing before you decide whether {{product}} fits your needs.",
      "Subject: Your Next Decision About {{product}}\n\nDear {{audience}},\n\nReview the current information, note the open questions, and decide whether {{product}} belongs on your shortlist."
    ],
    casual: [
      "Subject: A quick look at {{product}}\n\nHey {{audience}},\n\nIf {{product}} is on your radar, here are the useful details and open questions to review.",
      "Subject: Curious about {{product}}?\n\nHi! 👋\n\nHere is a straightforward introduction so you can decide whether {{product}} is worth exploring.",
      "Subject: {{product}}, without the hype\n\nHey {{audience}},\n\nLet us walk through what is established about {{product}} and what still needs confirmation.",
      "Subject: Is {{product}} a fit?\n\nHi {{audience}},\n\nTake a look at the current information and see how it compares with what matters to you.",
      "Subject: One useful question about {{product}}\n\nHey there,\n\nWhat would you need to know before putting {{product}} on your shortlist? Start with this overview."
    ],
    urgent: [
      "Subject: Important {{product}} Details to Review\n\nHi {{audience}},\n\nIf you're considering {{product}}, here are the key details to review before taking your next step.",
      "Subject: Is {{product}} the Right Fit Right Now?\n\nDear {{audience}},\n\nUse this quick overview to decide whether {{product}} belongs on your current priority list.",
      "Subject: Your Next Step with {{product}}\n\nHello {{audience}},\n\nHere is a concise summary of {{product}} and the information to confirm before moving forward.",
      "Subject: Before You Decide on {{product}}\n\nHi there,\n\nTake a moment to review what {{product}} offers and which details still need confirmation.",
      "Subject: A Timely Look at {{product}}\n\nDear {{audience}},\n\nIf {{product}} is relevant to your current goals, this is a useful time to evaluate the available information."
    ],
    humorous: [
      "Subject: {{product}} has entered your inbox\n\nHey {{audience}},\n\nNo dramatic reveal—just a useful overview of {{product}} and the details worth checking.",
      "Subject: A sales email with fewer sales theatrics\n\nHi! 👋\n\nHere is what is currently known about {{product}}, served without a side of invented hype.",
      "Subject: The straightforward story on {{product}}\n\nDear {{audience}},\n\nTake a clear look at {{product}} and decide whether the available information earns a next step.",
      "Subject: {{product}}, meet {{audience}}\n\nHi {{audience}},\n\nThis introduction keeps things simple: what {{product}} is, what to verify, and where to learn more.",
      "Subject: Open for a practical look at {{product}}\n\nHey there!\n\nHere are the facts and open questions that can help you evaluate {{product}}."
    ],
    inspirational: [
      "Subject: Explore a Thoughtful Next Step with {{product}}\n\nDear {{audience}},\n\nA useful decision starts with clear information. Here is what to consider about {{product}}.",
      "Subject: The Role {{product}} Could Play in Your Goals\n\nHello {{audience}},\n\nExplore where {{product}} may fit, what information is established, and what {{audience}} should verify before moving forward.",
      "Subject: Move Forward with Clarity on {{product}}\n\nHi there,\n\nReview what is known, identify what matters to you, and decide whether {{product}} supports the direction ahead.",
      "Subject: Consider What {{product}} Could Support\n\nDear {{audience}},\n\nExplore the established details and open questions without assuming an outcome that has not been proven.",
      "Subject: An Informed Path Forward with {{product}}\n\nHi {{audience}},\n\nUse this overview to evaluate the fit and choose a next step grounded in clear information."
    ]
  },
  blog_intro: {
    professional: [
      "In today's competitive landscape, {{audience}} need clear information before choosing {{product}}. Here are the practical questions and tradeoffs worth evaluating.",
      "The world of {{product}} is evolving rapidly. Here's what {{audience}} need to know to stay ahead of the curve and make the most of emerging opportunities.",
      "For {{audience}}, finding the right {{product}} can be the difference between success and stagnation. Let's explore what makes a great choice.",
      "As {{audience}} continue to seek better ways to achieve their goals, {{product}} may be worth evaluating. Start with what is known and which details still require validation.",
      "A responsible evaluation of {{product}} starts with evidence, fit, and tradeoffs. Here is a framework {{audience}} can use without assuming outcomes that have not been established."
    ],
    casual: [
      "If {{product}} is on your radar, start with the details that matter most to {{audience}}. Here is a practical way to evaluate the fit.",
      "Curious about {{product}}? Let us break down what {{audience}} should know, what to compare, and which questions to ask next.",
      "Choosing {{product}} should not require decoding a wall of hype. Here is a clear look at the information {{audience}} can use.",
      "Before {{audience}} decide whether {{product}} belongs on the shortlist, it helps to separate the useful details from the open questions.",
      "There is a lot to consider with {{product}}. This guide gives {{audience}} a friendly starting point without assuming the answer."
    ],
    urgent: [
      "When {{audience}} need to make a timely decision about {{product}}, the right questions matter. Start with these practical considerations.",
      "The conversation around {{product}} is moving quickly. Here is what {{audience}} should evaluate before choosing a direction.",
      "Before making {{product}} a priority, {{audience}} should understand the facts, tradeoffs, and open questions. This guide provides a focused starting point.",
      "Need to evaluate {{product}} soon? Here are the essential details {{audience}} can review without relying on hype or unsupported urgency.",
      "A fast decision still deserves clear information. This article helps {{audience}} assess {{product}} responsibly and identify what to verify next."
    ],
    humorous: [
      "{{product}} may come with plenty of marketing noise, but {{audience}} still need useful answers. Let us start with those.",
      "No dramatic reveal required: evaluating {{product}} begins with a few practical questions {{audience}} can actually use.",
      "Before {{audience}} give {{product}} a standing ovation, here are the details and tradeoffs worth checking.",
      "Hype is easy; a clear comparison is more helpful. Here is what {{audience}} should examine when considering {{product}}.",
      "{{product}} does not need a comedy routine to earn attention. It needs clear information, so that is where {{audience}} should begin."
    ],
    inspirational: [
      "A thoughtful next step starts with understanding the options. Here is what {{audience}} should consider about {{product}}.",
      "New directions become clearer when the evidence is clear. Explore what is established about {{product}}.",
      "For {{audience}} considering what comes next, {{product}} may be one option worth evaluating with care.",
      "Turn curiosity about {{product}} into an informed decision by starting with the available facts and open questions.",
      "A strong decision does not need exaggerated promises. It needs a clear view of {{product}} and its fit for {{audience}}."
    ]
  },
  sales_message: {
    professional: [
      "Hi {{audience}}, I would like to introduce {{product}} and share the details that may be relevant to your current priorities.",
      "Hello {{audience}}, {{product}} may be worth considering if it aligns with what you need. I would be glad to answer your questions.",
      "I am reaching out to give {{audience}} a clear overview of {{product}} and the information available to support a decision.",
      "If {{product}} is relevant to your goals, let us review the established details and identify anything that still needs confirmation.",
      "Would a closer look at {{product}} be useful? I can share the current information and help {{audience}} evaluate the fit."
    ],
    casual: [
      "Hey {{audience}}, have you had a chance to look at {{product}}? I can share the key details if it is relevant to what you need.",
      "Just wanted to put {{product}} on your radar. No pressure—take a look at the information and decide whether it is worth exploring.",
      "Hi {{audience}}! If {{product}} sounds relevant, I would be happy to walk through what is known and answer any questions.",
      "A quick note about {{product}}: it may be worth a closer look, depending on the priorities {{audience}} are working through.",
      "I will keep this brief: here is {{product}}, what we can say about it, and where {{audience}} can learn more."
    ],
    urgent: [
      "If {{product}} is on your priority list, now is a good time for {{audience}} to review the details and decide on a next step.",
      "{{audience}}, take a focused look at {{product}} and confirm whether it fits what you need right now.",
      "A timely decision starts with clear information. Review {{product}}, identify any open questions, and choose the right next step for {{audience}}.",
      "Need to evaluate {{product}} soon? Here is a direct overview for {{audience}} without invented deadlines, scarcity, or pressure.",
      "Move your evaluation of {{product}} forward today by confirming the facts that matter most to {{audience}}."
    ],
    humorous: [
      "Hi {{audience}}—no dramatic sales pitch today. Just a clear introduction to {{product}} and an invitation to see whether it fits.",
      "{{product}} has entered the conversation. The next step is simple: review the details and decide whether it belongs on your shortlist.",
      "Good news, {{audience}}: this message skips the hype. Here is what to know about {{product}} and where to ask questions.",
      "A small plot twist: {{product}} may or may not be right for you. Take a look at the details and make the call.",
      "{{audience}}, consider this a friendly introduction to {{product}}—useful information first, sales theatrics second."
    ],
    inspirational: [
      "A meaningful next step begins with a clear conversation. Explore whether {{product}} aligns with the direction {{audience}} want to take.",
      "Your goals deserve careful choices. Review the established details about {{product}} and decide whether the fit is worth exploring.",
      "Every useful partnership starts with understanding. Let us look at what {{product}} may offer and what still needs confirmation.",
      "Move your evaluation forward with clear information about {{product}}, not promises about outcomes that have not been established.",
      "If {{product}} supports the path {{audience}} are considering, the next step is to verify the fit and ask the right questions."
    ]
  }
};

function generateCopy(input) {
  const productDescription = normalizePromptValue(input?.productDescription);
  const targetAudience = normalizePromptValue(input?.targetAudience);
  const contentType = normalizeContentType(input?.contentType);
  const toneResolution = input?.customToneGuidance
    ? { templateTone: normalizeTone(input?.tone), customGuidance: normalizePromptValue(input.customToneGuidance).slice(0, MAX_CUSTOM_TONE_LENGTH) }
    : resolveTone(input?.tone);
  if (toneResolution.customGuidance) {
    const error = new Error('Custom tone guidance is not supported by the template generator');
    error.code = 'CUSTOM_TONE_UNSUPPORTED';
    throw error;
  }
  const tone = toneResolution.templateTone;

  if (!productDescription) {
    throw new Error('Product description is required');
  }
  
  if (!isValidContentType(contentType)) {
    throw new Error(`Invalid content type: ${contentType}. Valid types: ${getContentTypeKeys().join(', ')}`);
  }
  
  const toneTemplates = templates[contentType][tone];
  if (!toneTemplates) {
    throw new Error(`Invalid tone: ${tone} for content type: ${contentType}`);
  }

  const safeTemplates = toneTemplates.filter(isEvidenceSafeTemplate);
  if (safeTemplates.length < MIN_SAFE_VARIATIONS) {
    const error = new Error('Generation template safety requirements are not satisfied');
    error.code = 'GENERATION_TEMPLATE_SAFETY_INCOMPLETE';
    throw error;
  }
  
  // Pick 5 random templates
  const shuffled = [...safeTemplates].sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, 5);
  
  return selected.map(template => ({
    text: renderTemplate(template, {
      product: productDescription,
      audience: targetAudience
    }),
    tone: tone
  }));
}

function getContentTypes() {
  return { ...contentTypes };
}

function getTones() {
  // Assuming tones are consistent across all content types
  return Object.keys(templates.subject_line);
}

module.exports = {
  generateCopy,
  getContentTypes,
  getTones,
  isEvidenceSafeTemplate,
  normalizeContentType,
  normalizeTone,
  resolveTone,
  MAX_CUSTOM_TONE_LENGTH,
  MIN_SAFE_VARIATIONS
};
