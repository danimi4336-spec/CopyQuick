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
  }
};

function generateCopy(input) {
  const { productDescription, targetAudience, contentType, tone } = input;
  
  if (!templates[contentType]) {
    throw new Error(`Invalid content type: ${contentType}`);
  }
  
  const toneTemplates = templates[contentType][tone];
  if (!toneTemplates) {
    throw new Error(`Invalid tone: ${tone} for content type: ${contentType}`);
  }
  
  // Pick 5 random templates
  const shuffled = [...toneTemplates].sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, 5);
  
  return selected.map(template => ({
    text: template
      .replace(/{{product}}/g, productDescription)
      .replace(/{{audience}}/g, targetAudience),
    tone: tone
  }));
}

function getContentTypes() {
  return Object.keys(templates);
}

function getTones() {
  // Assuming tones are consistent across all content types
  return Object.keys(templates.subject_line);
}

module.exports = {
  generateCopy,
  getContentTypes,
  getTones
};
