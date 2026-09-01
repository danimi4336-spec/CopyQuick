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
      "Your Mom Called, She Says You Need {{product}}",
      "Why {{product}} is Better Than a Cold Pizza",
      "Finally, {{product}} - Because Life is Hard Enough",
      "Stop Doing That! Use {{product}} Instead",
      "{{product}}: It's Like Magic, But Real",
      "If You Love {{product}}, We Should Be Friends",
      "Sorry for Being Awesome (It's the {{product}})",
      "How to Win at Life Using {{product}}",
      "Is It Friday Yet? (Oh, and {{product}} is here)",
      "{{product}}: Now with 100% Less Drama"
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
      "We've been working on something cool: {{product}}. Can't wait for you all to try it!",
      "Hey {{audience}}, what's your biggest challenge right now? Maybe {{product}} can help.",
      "Just dropped: a fresh look at {{product}}. Check it out!",
      "Coffee, laptop, and {{product}}. The perfect morning setup.",
      "Life's too short for bad tools. That's why we made {{product}}.",
      "Anyone else obsessed with {{product}} lately? Just us? Okay.",
      "Giving away a free trial of {{product}} for one lucky person in our community!",
      "Real talk: {{product}} changed the way I work. Hope it does the same for you.",
      "Quick tip for {{audience}}: Use {{product}} to get ahead this week.",
      "Weekend vibes and getting some work done with {{product}}. Loving it."
    ],
    urgent: [
      "If {{product}} is relevant to a current priority, {{audience}} can review the available details and choose a next step today.",
      "Need to evaluate {{product}} soon? Start with the facts, fit, and open questions that matter to {{audience}}.",
      "A timely decision about {{product}} still deserves clear information. Here is what {{audience}} should confirm first.",
      "Move the evaluation of {{product}} forward by identifying what is established and what {{audience}} still need to verify.",
      "When timing matters, clarity matters too. Give {{audience}} a direct route to the current information about {{product}}."
    ],
    humorous: [
      "If {{product}} was a person, we'd probably marry it. (Don't tell our legal team).",
      "Solving world hunger? No. Solving your {{product}} problems? Absolutely.",
      "We told our boss we were working, but we were actually just playing with {{product}}.",
      "{{product}}: Because manual labor is so last century.",
      "I don't always use tools, but when I do, I prefer {{product}}.",
      "Does {{product}} make you look cooler? Science says yes.",
      "Finally, a tool that's smarter than my cat. Thanks, {{product}}!",
      "Warning: Use of {{product}} may result in excessive productivity and happiness.",
      "We'd say {{product}} is better than sliced bread, but bread is pretty good.",
      "Stop crying over your spreadsheets and start using {{product}}."
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
      "You Need {{product}} in Your Life",
      "Wait, You're Not Using {{product}}?",
      "The Best Thing Since... Well, Ever: {{product}}",
      "Level Up with {{product}}",
      "Simply Better: {{product}}",
      "Join the {{product}} Fan Club",
      "Work Smarter, Not Harder: {{product}}",
      "Your New Favorite Tool: {{product}}",
      "Try {{product}}, Thank Us Later",
      "Making Life Easier with {{product}}"
    ],
    urgent: [
      "Review {{product}} Today",
      "Is {{product}} Right for {{audience}} Now?",
      "Take the Next Step with {{product}}",
      "Evaluate {{product}} with Clear Information",
      "See What to Confirm About {{product}}"
    ],
    humorous: [
      "{{product}}: 100% Better Than Nothing",
      "Your Competitors Hate {{product}}",
      "Finally, {{product}} is Here!",
      "Stop Being Boring, Use {{product}}",
      "{{product}}: Magic (But Not Really)",
      "Warning: {{product}} is Addictive",
      "Because You're Worth It: {{product}}",
      "Better Results, Less Tears: {{product}}",
      "{{product}}: Your New Secret Weapon",
      "Don't Be a Luddite, Use {{product}}"
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
      "Schedule a Demo of {{product}}",
      "Contact Sales for {{product}}",
      "Get the Whitepaper on {{product}}",
      "Start Your Professional Trial",
      "Request a Quote for {{product}}",
      "Download the {{product}} Guide",
      "Invest in {{product}} Today",
      "Partner with {{product}}",
      "Register for the {{product}} Webinar",
      "Learn More About {{product}}"
    ],
    casual: [
      "Give {{product}} a Spin",
      "Grab Your Copy of {{product}}",
      "Check Out {{product}} Here",
      "Join the Fun with {{product}}",
      "See What the Hype is About",
      "Try {{product}} for Free",
      "Hop In: {{product}} is Ready",
      "Tell Me More About {{product}}",
      "Let's Do This: Get {{product}}",
      "I'm Ready for {{product}}"
    ],
    urgent: [
      "Review {{product}} Now",
      "See Whether {{product}} Fits",
      "Confirm the Details",
      "Choose My Next Step",
      "Evaluate {{product}} Today"
    ],
    humorous: [
      "Click Here or the Kitten Gets It",
      "Take My Money! (For {{product}})",
      "Yes, I Want to Be Awesome",
      "Stop Reading, Start Clicking",
      "Gimme {{product}}!",
      "Join the Cool Kids with {{product}}",
      "Click This Shiny Button",
      "I Promise to Use {{product}}",
      "Why Are You Still Here?",
      "Unlock the Secret of {{product}}"
    ],
    inspirational: [
      "Start Your Transformation",
      "Unlock My True Potential",
      "Join the Movement Today",
      "Empower My Career",
      "Create My Legacy with {{product}}",
      "I Believe in My Vision",
      "Take the First Step",
      "Achieve Greatness Now",
      "Say Yes to Success",
      "Be the Change You Seek"
    ]
  },
  product_description: {
    professional: [
      "{{product}} is presented as a polished, dependable option for shoppers who want clear information before they buy. This description keeps the focus on what the product is, how it fits into a customer's routine, and why it may be worth considering without adding unsupported claims.",
      "Introduce {{product}} with a straightforward product description that feels professional and easy to trust. The copy highlights the product clearly, explains its role in simple terms, and gives customers enough context to understand whether it is the right fit for them.",
      "{{product}} deserves copy that is clear, credible, and useful. This description positions the product with a refined tone, avoids exaggerated promises, and gives shoppers a concise overview they can use while comparing their options.",
      "Make {{product}} easy to understand with a product description built for confident buying decisions. The copy explains the product in practical language, supports a professional brand presence, and leaves room for verified details such as ingredients, specifications, or features.",
      "{{product}} is described with a clean, professional voice that helps customers quickly understand the offer. The copy emphasizes clarity, usefulness, and trust while avoiding invented benefits, certifications, dosages, or medical claims."
    ],
    casual: [
      "Meet {{product}}, explained in a way that feels simple, friendly, and easy to shop. This description gives customers the essentials without pressure, helping them understand what the product is and why it might belong on their shortlist.",
      "{{product}} gets a warm, approachable description that keeps things clear. The copy talks to customers like real people, introduces the product naturally, and avoids overpromising details that were not provided.",
      "Give shoppers a quick but useful look at {{product}}. This description keeps the tone relaxed, explains the product in plain language, and makes it easier for customers to decide if they want to learn more.",
      "{{product}} is introduced with friendly, readable copy that works well for product pages, marketplaces, or social commerce. It keeps the product front and center while leaving space for verified details like size, ingredients, materials, or features.",
      "A good product description should help customers feel informed, not overwhelmed. This version presents {{product}} in a casual voice, focusing on clarity, usefulness, and a natural path toward purchase."
    ],
    urgent: [
      "{{product}} is introduced with a clear, action-oriented description designed to help shoppers decide quickly. The copy creates momentum without inventing scarcity, discounts, stock levels, or unsupported product claims.",
      "Move customers from interest to action with a focused description of {{product}}. This version explains the product clearly, keeps the value easy to grasp, and uses an urgent tone without relying on false countdowns or exaggerated promises.",
      "{{product}} gets a concise product description built for faster buying decisions. It keeps the copy practical, direct, and grounded in the information provided so urgency does not become hype.",
      "Help customers understand {{product}} quickly with copy that is direct and conversion-minded. This description gives the product a strong presence while avoiding unsupported claims about results, availability, or guarantees.",
      "This product description positions {{product}} with clarity and momentum. It is suitable for a sales page or marketplace listing where customers need the essentials fast before taking the next step."
    ],
    humorous: [
      "{{product}} gets a product description with a little personality and a lot of clarity. The copy keeps the product easy to understand, adds a light touch of humor, and avoids making claims the product details cannot support.",
      "Here is {{product}}, described without sounding like a cardboard box wrote it. This version keeps the important details clear while giving the listing a warmer, more memorable voice.",
      "{{product}} is presented with friendly product-page copy that has just enough wit to feel human. It explains what the product is, keeps the tone light, and stays grounded in the facts provided.",
      "A product description can be useful without being boring. This version introduces {{product}} with a playful tone, practical context, and no invented benefits or miracle promises.",
      "{{product}} gets copy that is clear first and clever second. Customers can understand the product quickly, enjoy the tone, and still get a responsible description that does not stretch beyond the input."
    ],
    inspirational: [
      "{{product}} is described with an uplifting tone that helps customers imagine how it could fit into their goals or daily life. The copy stays grounded, avoids unsupported promises, and presents the product with clarity and purpose.",
      "Give {{product}} a product description that feels positive, useful, and easy to believe. This version explains the product in a hopeful voice while leaving space for verified details and customer-specific benefits.",
      "{{product}} is positioned as a thoughtful choice for customers looking for something that supports their next step. The description is inspirational in tone but careful not to invent outcomes, certifications, or claims.",
      "This description helps {{product}} feel purposeful without becoming vague. It explains the product clearly, speaks with optimism, and keeps the message tied to what customers can responsibly understand from the information provided.",
      "Present {{product}} with copy that is encouraging, clear, and customer-friendly. The description supports a confident brand voice while avoiding exaggerated claims or facts that were not supplied."
    ]
  },
  email_campaign: {
    professional: [
      "Subject: Welcome to {{product}} — Let's Get Started\n\nHi {{audience}},\n\nWelcome aboard! We're thrilled to have you join the {{product}} community. Here's everything you need to know to get started.",
      "Subject: Your {{product}} Journey Begins Now\n\nDear {{audience}},\n\nThank you for choosing {{product}}. We've put together a quick guide to help you make the most of your experience.",
      "Subject: Inside {{product}} — What You Need to Know\n\nHello {{audience}},\n\nWe wanted to share some exciting updates about {{product}} that you won't want to miss.",
      "Subject: A Practical Look at {{product}} for {{audience}}\n\nHi there,\n\nHere are the product details and questions worth reviewing before you decide whether {{product}} fits your needs.",
      "Subject: Exclusive Tips for Getting the Most from {{product}}\n\nDear {{audience}},\n\nWe've compiled our best tips and tricks to help you maximize the value of {{product}}."
    ],
    casual: [
      "Subject: So, you joined {{product}}! 🎉\n\nHey there!\n\nWe're so excited you decided to try {{product}}. Let's jump right in!",
      "Subject: Quick check-in about {{product}}\n\nHi! 👋\n\nJust wanted to see how things are going with {{product}}. Got a minute?",
      "Subject: {{product}} — we made some cool updates\n\nHey {{audience}},\n\nWe've been busy improving {{product}} and wanted to share what's new!",
      "Subject: We think you'll love this {{product}} feature\n\nHi {{audience}},\n\nThere's a feature in {{product}} we think you'll absolutely love. Check it out!",
      "Subject: How's {{product}} working for you?\n\nHey there,\n\nWe'd love to hear about your experience with {{product}} so far."
    ],
    urgent: [
      "Subject: Important {{product}} Details to Review\n\nHi {{audience}},\n\nIf you're considering {{product}}, here are the key details to review before taking your next step.",
      "Subject: Is {{product}} the Right Fit Right Now?\n\nDear {{audience}},\n\nUse this quick overview to decide whether {{product}} belongs on your current priority list.",
      "Subject: Your Next Step with {{product}}\n\nHello {{audience}},\n\nHere is a concise summary of {{product}} and the information to confirm before moving forward.",
      "Subject: Before You Decide on {{product}}\n\nHi there,\n\nTake a moment to review what {{product}} offers and which details still need confirmation.",
      "Subject: A Timely Look at {{product}}\n\nDear {{audience}},\n\nIf {{product}} is relevant to your current goals, this is a useful time to evaluate the available information."
    ],
    humorous: [
      "Subject: {{product}} just got even better (yes, really)\n\nHey {{audience}},\n\nWe know you already love {{product}}, but we went and made it even better. You're welcome.",
      "Subject: Our therapists say we need to stop emailing you\n\nHi! 👋\n\nBut we couldn't resist sharing this {{product}} update. It's pretty cool, we promise.",
      "Subject: We tried to keep this a secret. We failed.\n\nDear {{audience}},\n\n{{product}} has a new feature and we're too excited not to tell you about it.",
      "Subject: This is not spam. It's a {{product}} love letter.\n\nHi {{audience}},\n\nOkay, maybe it's a newsletter. But we do love having you as a {{product}} user!",
      "Subject: 3 reasons to open this email (all involve {{product}})\n\nHey there!\n\nOkay, we're not usually this direct, but {{product}} has some news you need to hear."
    ],
    inspirational: [
      "Subject: Your Future with {{product}} Starts Today\n\nDear {{audience}},\n\nEvery great journey begins with a single step. Yours starts with {{product}}.",
      "Subject: The Role {{product}} Could Play in Your Goals\n\nHello {{audience}},\n\nExplore where {{product}} may fit, what information is established, and what {{audience}} should verify before moving forward.",
      "Subject: Believe in Better — {{product}} Can Help\n\nHi there,\n\nYou have the vision. Let {{product}} help you bring it to life.",
      "Subject: Your Potential × {{product}} = Unlimited Possibilities\n\nDear {{audience}},\n\nCombine your ambition with {{product}} and see what's possible.",
      "Subject: The Future is Bright with {{product}}\n\nHi {{audience}},\n\nWe're building the future of {{product}} and we want you to be part of it."
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
      "Every journey begins with a single step. For {{audience}}, that step might just be discovering {{product}}.",
      "Imagine what {{audience}} could achieve with the right {{product}}. Now stop imagining — it's possible.",
      "The best time to start is now. {{product}} is here to help {{audience}} reach new heights.",
      "Believe in the power of {{product}} to transform how {{audience}} work, live, and succeed.",
      "Your potential is limitless. With {{product}}, {{audience}} can finally unlock what they're truly capable of."
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
      "Imagine the possibilities when {{audience}} join forces with {{product}}. The future is brighter than you think.",
      "Your vision, our {{product}}. Together, there's nothing {{audience}} can't achieve.",
      "Every great partnership starts with a conversation. Let {{product}} be part of your story.",
      "You have the drive. {{product}} has the tools. Together, {{audience}} can accomplish extraordinary things.",
      "Believe in what's possible. {{product}} is here to help {{audience}} turn potential into reality."
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
