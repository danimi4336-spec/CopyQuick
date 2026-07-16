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

function normalizePromptValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeTone(tone) {
  const key = normalizePromptValue(tone).toLowerCase();
  return toneAliases[key] || key || 'professional';
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

const templates = {
  subject_line: {
    professional: [
      "Optimizing Your Workflow with {{product}}",
      "Introducing {{product}}: A Solution for {{audience}}",
      "How {{product}} Can Help Your Business Grow",
      "The Executive's Guide to {{product}}",
      "Data-Driven Results with {{product}}",
      "Enhance Your Strategy: {{product}} Inside",
      "The Professional Choice: {{product}}",
      "Streamline Your Operations with {{product}}",
      "A New Standard for {{audience}}: {{product}}",
      "Why Top Industry Leaders Are Using {{product}}"
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
      "Last Chance: Get {{product}} Before It's Gone!",
      "Urgent: Exclusive Offer on {{product}} for {{audience}}",
      "Time is Running Out for {{product}}",
      "Final Call: {{product}} Access Ending Soon",
      "Don't Miss Out on {{product}}!",
      "Important Update regarding {{product}}",
      "Action Required: Your {{product}} Discount Expires",
      "Limited Time: {{product}} for {{audience}}",
      "Flash Sale: {{product}} is 50% Off Today!",
      "Hurry! Only 5 spots left for {{product}}"
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
      "Unlock Your Potential with {{product}}",
      "Believe in Your Vision: {{product}} Can Help",
      "The Path to Success Starts with {{product}}",
      "Empower Your Journey with {{product}}",
      "See the Difference {{product}} Makes",
      "Dream Big, Use {{product}}",
      "Inspire Others with {{product}}",
      "Your Future Self Will Thank You for {{product}}",
      "The Change You Need: {{product}}",
      "Transform Your Life with {{product}}"
    ]
  },
  social_post: {
    professional: [
      "Discover how {{product}} is transforming the industry for {{audience}}. Reliability meets innovation.",
      "Efficiency is key. With {{product}}, {{audience}} can achieve more in less time.",
      "Proud to announce our latest update for {{product}}. Designed for the modern professional.",
      "Industry insights: Why {{product}} is becoming the go-to tool for {{audience}}.",
      "Maximize your team's output with {{product}}. The professional choice for growth.",
      "Strategy matters. Ensure yours is solid with {{product}}.",
      "Building the future of business with {{product}}. Join the professional network.",
      "Success is a journey. Let {{product}} be your guide.",
      "Expertly crafted for {{audience}}, {{product}} delivers unparalleled results.",
      "The ROI of {{product}} is clear. Here's how it helps {{audience}} scale."
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
      "STOP what you're doing! {{product}} is on sale for the next 2 hours only!",
      "Alert for {{audience}}: {{product}} spots are filling up fast. Grab yours now!",
      "Don't get left behind. Start using {{product}} today before the price goes up.",
      "Urgent update: We only have a few copies of {{product}} left in stock.",
      "The wait is over, but the time is short. Get {{product}} now!",
      "Attention {{audience}}: Use code QUICK for 30% off {{product}}.",
      "Need a solution FAST? {{product}} is here for you.",
      "Final hours to join the {{product}} early access program.",
      "Warning: Missing out on {{product}} might be your biggest mistake this year.",
      "Hurry, {{audience}}! The {{product}} deal of the century ends at midnight."
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
      "Imagine a world where your dreams are within reach. {{product}} makes it possible.",
      "Every great achievement starts with a single step. Take yours with {{product}}.",
      "Empower yourself. Empower your future. Choose {{product}}.",
      "To the dreamers and the doers: {{product}} was built for you.",
      "Rising to the challenge has never been easier with {{product}} by your side.",
      "Be the leader your industry needs. Start with {{product}}.",
      "Your potential is limitless. Let {{product}} help you reach new heights.",
      "Courage is trying something new. Experience the power of {{product}}.",
      "Light the spark of innovation within your team using {{product}}.",
      "Believe in the power of {{product}} to transform your daily life."
    ]
  },
  ad_headline: {
    professional: [
      "The Industry Standard: {{product}}",
      "Scale Your Business with {{product}}",
      "Expert-Level Results for {{audience}}",
      "Strategic Advantage with {{product}}",
      "Reliable Performance: {{product}}",
      "Professional Grade {{product}}",
      "Precision and Power: {{product}}",
      "Optimized for {{audience}}: {{product}}",
      "The Business Choice: {{product}}",
      "Unlocking Growth with {{product}}"
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
      "Get {{product}} NOW - 50% Off!",
      "Limited Supply: {{product}}",
      "Act Fast for {{product}} Access",
      "Don't Miss the {{product}} Launch",
      "Hurry! {{product}} Discount Ending",
      "Immediate Solution: {{product}}",
      "Flash Sale on {{product}}!",
      "Grab {{product}} Before It's Gone",
      "Exclusive {{audience}} Offer: {{product}}",
      "Start with {{product}} in Seconds"
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
      "Change Your Future with {{product}}",
      "The Power to Achieve: {{product}}",
      "Your Journey Starts with {{product}}",
      "Dream Bigger with {{product}}",
      "Unleash Your Genius: {{product}}",
      "Believe in Success: {{product}}",
      "Transformative Results with {{product}}",
      "Inspire Growth: {{product}}",
      "Reach the Top with {{product}}",
      "Visionary Tools: {{product}}"
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
      "Claim Your {{product}} Discount NOW",
      "Start My Trial Before It Expires",
      "Get {{product}} While It Lasts",
      "Buy {{product}} Today and Save",
      "Secure My Spot for {{product}}",
      "Don't Wait - Get {{product}}",
      "Last Call for {{product}}!",
      "Access {{product}} Immediately",
      "Redeem My {{product}} Offer",
      "Hurry - Get {{product}}!"
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
      "Subject: How {{product}} is Helping {{audience}} Succeed\n\nHi there,\n\nSee how businesses like yours are leveraging {{product}} to achieve remarkable results.",
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
      "Subject: Last Chance: Don't Miss This {{product}} Offer\n\nHi {{audience}},\n\nThis is your final reminder — our {{product}} offer ends tonight. Don't miss out!",
      "Subject: Your {{product}} Trial Expires Tomorrow\n\nDear {{audience}},\n\nYour {{product}} free trial is ending soon. Upgrade now to keep your access.",
      "Subject: Important: {{product}} Pricing Update\n\nHello {{audience}},\n\nWe want to let you know about an upcoming change to {{product}} pricing.",
      "Subject: Final Call: {{product}} Special Access Ending\n\nHi there,\n\nYour special access to {{product}} ends in 24 hours. Act now to lock in your benefits.",
      "Subject: Don't Lose Your {{product}} Data\n\nDear {{audience}},\n\nYour {{product}} account will be downgraded soon. Save your work before it's too late."
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
      "Subject: The Power of {{product}} — A Story of Transformation\n\nHello {{audience}},\n\nSee how {{product}} is transforming the way {{audience}} work and achieve their goals.",
      "Subject: Believe in Better — {{product}} Can Help\n\nHi there,\n\nYou have the vision. Let {{product}} help you bring it to life.",
      "Subject: Your Potential × {{product}} = Unlimited Possibilities\n\nDear {{audience}},\n\nCombine your ambition with {{product}} and see what's possible.",
      "Subject: The Future is Bright with {{product}}\n\nHi {{audience}},\n\nWe're building the future of {{product}} and we want you to be part of it."
    ]
  },
  blog_intro: {
    professional: [
      "In today's competitive landscape, {{audience}} need every advantage they can get. That's where {{product}} comes in — a powerful solution designed to transform how you work.",
      "The world of {{product}} is evolving rapidly. Here's what {{audience}} need to know to stay ahead of the curve and make the most of emerging opportunities.",
      "For {{audience}}, finding the right {{product}} can be the difference between success and stagnation. Let's explore what makes a great choice.",
      "As {{audience}} continue to seek better ways to achieve their goals, {{product}} has emerged as a game-changing solution worth serious consideration.",
      "The data is clear: {{audience}} who leverage {{product}} consistently outperform those who don't. Here's why — and how you can too."
    ],
    casual: [
      "Let's be real — {{audience}} deserve better. And {{product}} might just be the upgrade you've been waiting for.",
      "So here's the thing about {{product}}: it's kind of amazing, and we think {{audience}} are going to love it.",
      "If you're {{audience}} and you haven't tried {{product}} yet, what are you waiting for? Let's dive in.",
      "We asked ourselves: what do {{audience}} really need? The answer was {{product}}. Here's why.",
      "You know that feeling when you find something that just works? That's {{product}} for {{audience}}."
    ],
    urgent: [
      "Time is running out for {{audience}} who haven't made the switch to {{product}}. Here's why you need to act now.",
      "The {{product}} landscape is changing fast. {{audience}} who wait will be left behind. Here's what you need to know today.",
      "Don't let another day go by without {{product}}. For {{audience}}, the cost of waiting is simply too high.",
      "Urgent: {{audience}} are racing to adopt {{product}}. Are you keeping up? Read on to find out why.",
      "The window of opportunity for {{product}} is closing. Here's why {{audience}} need to move fast."
    ],
    humorous: [
      "We asked {{audience}} what they wanted. They said 'world peace.' We can't help with that, but we do have {{product}}.",
      "If {{product}} were a superhero, it would be your favorite one. Here's why {{audience}} are basically getting a sidekick.",
      "Spoiler: {{product}} is great. {{audience}} are amazing. Together? Unstoppable. Let us explain.",
      "We were going to write a serious blog post about {{product}}. Then we remembered {{audience}} have a sense of humor too.",
      "{{product}} walked into a bar. The bartender said, 'Why the long face?' {{product}} replied, 'I'm just worried about {{audience}}.'"
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
      "Hi {{audience}}, I wanted to personally introduce {{product}} — a solution designed specifically for professionals like you.",
      "I came across {{product}} and immediately thought of {{audience}}. I think you'll find it incredibly valuable.",
      "Let me show you how {{product}} can help {{audience}} achieve better results in less time.",
      "At {{product}}, we specialize in helping {{audience}} overcome their biggest challenges. Let's talk.",
      "I'd love to schedule a quick call to share how {{product}} is helping similar businesses achieve remarkable outcomes."
    ],
    casual: [
      "Hey {{audience}}, quick question — have you checked out {{product}} yet? I think you'd really like it.",
      "Just wanted to share {{product}} with you. No pressure, but I think it's exactly what {{audience}} need.",
      "Hey there! I'm reaching out because {{product}} might be a great fit for {{audience}}. Want to hear more?",
      "Random thought: {{product}} + {{audience}} = amazing results. Just saying. 😄",
      "I won't keep you long — just wanted to say that {{product}} exists, it's awesome, and {{audience}} should try it."
    ],
    urgent: [
      "Limited availability: {{product}} is offering exclusive early access for {{audience}}. Don't miss this opportunity.",
      "Last chance for {{audience}} to join {{product}} at our current pricing. Offers end soon.",
      "Time-sensitive: {{product}} is opening a limited number of spots for {{audience}}. Reserve yours now.",
      "Urgent update for {{audience}}: Our {{product}} waitlist is closing soon. Secure your spot today.",
      "Act now: {{product}} is offering a special deal for {{audience}} that won't last long."
    ],
    humorous: [
      "Okay, so {{product}} isn't going to make you coffee. But it will make {{audience}} look like a genius.",
      "We asked {{audience}} what they wanted. 3 out of 5 said {{product}}. The other 2 hadn't tried it yet.",
      "{{product}} called. It said it misses {{audience}}. Don't keep it waiting.",
      "If {{product}} wrote this message, it would be way more convincing. But trust us — {{audience}} will love it.",
      "Breaking: {{product}} declared 'best thing since sliced bread' by {{audience}}. Okay, we made that up. But it could happen!"
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
  const tone = normalizeTone(input?.tone);

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
  
  // Pick 5 random templates
  const shuffled = [...toneTemplates].sort(() => 0.5 - Math.random());
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
  normalizeContentType,
  normalizeTone
};
