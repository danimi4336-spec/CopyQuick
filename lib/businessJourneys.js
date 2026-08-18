/**
 * Business Journeys — the core data model for the Builder Command Center.
 * Each journey represents a business objective with its full blueprint.
 * 
 * Structure:
 *   groups  — categorized collection of journeys (BUILD / GROW / PROMOTE)
 *   journeys[id] — individual journey definition
 *   getJourney(id) — lookup helper
 *   getByGroup(group) — filter helper
 */

const journeyGroups = [
  { id: 'build',    label: 'BUILD',   icon: '🚀' },
  { id: 'grow',     label: 'GROW',    icon: '📈' },
  { id: 'promote',  label: 'PROMOTE', icon: '💼' },
];

/**
 * Objective Universe — the first decision shown to a new entrepreneur.
 * Objectives capture intent; the detailed journeys below describe execution.
 */
const objectiveUniverse = [
  { id: 'launch_product', icon: '🚀', title: 'Launch a New Product', description: 'Bring a new offer to market with a clear, coordinated plan.', outcome: 'Create a complete launch strategy including positioning, messaging, marketing assets and recommended next steps.' },
  { id: 'get_more_customers', icon: '👥', title: 'Get More Customers', description: 'Build a practical path to attract and win more buyers.', outcome: 'Identify the strongest acquisition opportunities and create the campaigns, messages and next steps to turn prospects into customers.' },
  { id: 'increase_conversion_rates', icon: '📈', title: 'Increase Conversion Rates', description: 'Turn more of your existing traffic into customers.', outcome: 'Strengthen your offer, sales messaging and customer journey so more visitors take the next step.' },
  { id: 'improve_search_rankings', icon: '🔍', title: 'Improve Search Rankings', description: 'Grow discoverability with a focused search strategy.', outcome: 'Clarify priority search opportunities and build optimized content and messaging that help the right customers find you.' },
  { id: 'build_brand', icon: '✨', title: 'Build My Brand', description: 'Create a distinctive brand customers recognize and trust.', outcome: 'Define your positioning, voice and core story, then translate them into consistent messaging across your business.' },
  { id: 'promote_service', icon: '💼', title: 'Promote My Service', description: 'Present your expertise clearly and win better-fit clients.', outcome: 'Shape a compelling service offer and create the sales, outreach and trust-building assets needed to attract clients.' },
  { id: 'validate_idea', icon: '💡', title: 'Validate My Idea', description: 'Test demand before investing significant time or money.', outcome: 'Clarify your audience, value proposition and validation plan so you can gather evidence and make a confident go-or-adjust decision.' },
  { id: 'more_objectives', icon: '➕', title: 'More Objectives', description: 'Explore additional ways to build, grow or promote.', outcome: 'Continue to the full Builder to explore more business journeys and choose the execution path that best fits your priorities.' }
];

/**
 * Each journey object:
 *   id            — unique slug
 *   group         — group id (build / grow / promote)
 *   icon          — emoji
 *   title         — short headline
 *   description   — one-liner shown in the card
 *   platforms     — [optional] list of platform choices for this journey
 *   blueprint     — array of asset categories
 *     category    — category label (e.g. "Product Foundation")
 *     items       — array of asset name strings
 *   estimatedAssets — number
 *   estimatedTime — human-readable string
 */
const journeys = {

  /* ===================== BUILD ===================== */

  launch_product: {
    id: 'launch_product',
    group: 'build',
    icon: '🚀',
    title: 'Launch a New Product',
    description: 'Generate everything you need to bring a new product to market.',
    platforms: ['Amazon', 'Shopify', 'Walmart', 'Etsy', 'TikTok Shop', 'WooCommerce', 'Multiple Platforms'],
    blueprint: [
      {
        category: 'Product Foundation',
        items: ['Product Description', 'Features', 'Benefits', 'Positioning Statement']
      },
      {
        category: 'Sales Assets',
        items: ['Landing Page', 'Product Images ✏️', 'Lifestyle Images ✏️']
      },
      {
        category: 'Advertising',
        items: ['Facebook Ads', 'Instagram Ads', 'Google Search Ads']
      },
      {
        category: 'Email Marketing',
        items: ['Welcome Email', 'Launch Email', 'Follow-up Email', 'Abandoned Cart Email']
      },
      {
        category: 'Social Media',
        items: ['Facebook Posts', 'Instagram Posts', 'LinkedIn Posts', 'X Posts']
      },
      {
        category: 'SEO',
        items: ['SEO Title', 'Meta Description', 'Blog Article']
      }
    ],
    estimatedAssets: 34,
    estimatedTime: '≈ 1 minute'
  },

  build_brand: {
    id: 'build_brand',
    group: 'build',
    icon: '✨',
    title: 'Build My Brand',
    description: 'Establish your brand voice and create consistent messaging.',
    blueprint: [
      {
        category: 'Brand Foundation',
        items: ['Brand Voice Guide', 'Mission Statement', 'Tagline Options', 'Brand Story']
      },
      {
        category: 'Website',
        items: ['Hero Headline', 'About Page', 'Value Proposition', 'CTA Buttons']
      },
      {
        category: 'Social Media',
        items: ['Bio / Profile', 'Branded Hashtags', 'Content Pillars', 'Post Templates']
      },
      {
        category: 'Email',
        items: ['Welcome Series', 'Brand Introduction Email', 'Newsletter Template']
      }
    ],
    estimatedAssets: 22,
    estimatedTime: '≈ 45 seconds'
  },

  start_store: {
    id: 'start_store',
    group: 'build',
    icon: '🛒',
    title: 'Start an Online Store',
    description: 'Create product listings, store copy, and launch assets.',
    platforms: ['Shopify', 'Amazon', 'Etsy', 'WooCommerce', 'BigCommerce', 'Multiple Platforms'],
    blueprint: [
      {
        category: 'Store Foundation',
        items: ['Store Description', 'About Page', 'Shipping Policy', 'Return Policy']
      },
      {
        category: 'Product Listings',
        items: ['Product Title', 'Product Description', 'Bullet Points', 'Product Features']
      },
      {
        category: 'Marketing',
        items: ['Launch Email', 'Facebook Shop Post', 'Instagram Story', 'Google Shopping Ad']
      },
      {
        category: 'SEO',
        items: ['SEO Title', 'Meta Description', 'Product Keywords']
      }
    ],
    estimatedAssets: 24,
    estimatedTime: '≈ 45 seconds'
  },

  /* ===================== GROW ===================== */

  scale_product: {
    id: 'scale_product',
    group: 'grow',
    icon: '📈',
    title: 'Take My Existing Product to the Next Level',
    description: 'Refresh and expand marketing for an existing product.',
    blueprint: [
      {
        category: 'Refresh',
        items: ['Updated Product Description', 'New Features Copy', 'Improved Benefits']
      },
      {
        category: 'Expansion Channels',
        items: ['LinkedIn Campaign', 'Retargeting Ads', 'Partnership Pitch']
      },
      {
        category: 'Customer Marketing',
        items: ['Upsell Email', 'Cross-sell Recommendations', 'Loyalty Program Copy']
      }
    ],
    estimatedAssets: 18,
    estimatedTime: '≈ 30 seconds'
  },

  expand_marketplaces: {
    id: 'expand_marketplaces',
    group: 'grow',
    icon: '🌐',
    title: 'Expand to New Marketplaces',
    description: 'Adapt your product for additional sales channels.',
    platforms: ['Amazon', 'Etsy', 'Walmart', 'eBay', 'TikTok Shop', 'Multiple Platforms'],
    blueprint: [
      {
        category: 'Marketplace Listings',
        items: ['Platform-Specific Title', 'Enhanced Description', 'Keyword-Optimized Bullets', 'A+ Content Copy']
      },
      {
        category: 'Advertising',
        items: ['Sponsored Ads', 'Marketplace SEO', 'Promotion Copy']
      }
    ],
    estimatedAssets: 12,
    estimatedTime: '≈ 25 seconds'
  },

  marketing_campaign: {
    id: 'marketing_campaign',
    group: 'grow',
    icon: '📢',
    title: 'Create a Marketing Campaign',
    description: 'A complete multi-channel campaign from one brief.',
    blueprint: [
      {
        category: 'Campaign Foundation',
        items: ['Campaign Brief', 'Core Message', 'Creative Direction']
      },
      {
        category: 'Email',
        items: ['Announcement Email', 'Reminder Email', 'Follow-up Email']
      },
      {
        category: 'Advertising',
        items: ['Facebook Ads', 'Instagram Ads', 'Google Ads', 'LinkedIn Ads']
      },
      {
        category: 'Social Media',
        items: ['Facebook Posts', 'Instagram Posts', 'LinkedIn Posts', 'X Posts']
      },
      {
        category: 'Landing Page',
        items: ['Hero Headline', 'Benefits Section', 'CTA Section', 'FAQ Section']
      }
    ],
    estimatedAssets: 28,
    estimatedTime: '≈ 50 seconds'
  },

  /* ===================== PROMOTE ===================== */

  promote_service: {
    id: 'promote_service',
    group: 'promote',
    icon: '💼',
    title: 'Promote My Service',
    description: 'Generate compelling copy for your service-based business.',
    blueprint: [
      {
        category: 'Service Foundation',
        items: ['Service Description', 'Pricing Page Copy', 'FAQ Copy']
      },
      {
        category: 'Trust Assets',
        items: ['Testimonials', 'Case Study Outline', 'About the Founder']
      },
      {
        category: 'Outreach',
        items: ['Cold Email Template', 'Follow-up Sequence', 'LinkedIn Outreach']
      },
      {
        category: 'Advertising',
        items: ['Service Ad Headlines', 'Google Local Ad', 'Facebook Lead Ad']
      }
    ],
    estimatedAssets: 20,
    estimatedTime: '≈ 35 seconds'
  },

  individual_assets: {
    id: 'individual_assets',
    group: 'promote',
    icon: '🎯',
    title: 'Generate Individual Marketing Assets',
    description: 'Select and generate exactly the assets you need, one at a time.',
    blueprint: [
      {
        category: 'Popular Assets',
        items: ['Email Subject Lines', 'Social Media Posts', 'Ad Headlines', 'Call-to-Actions']
      },
      {
        category: 'Content',
        items: ['Blog Introduction', 'Product Description', 'Sales Message']
      },
      {
        category: 'Campaign Elements',
        items: ['Facebook Ad Copy', 'Instagram Caption', 'Google Ad Headline', 'LinkedIn Post']
      }
    ],
    estimatedAssets: 12,
    estimatedTime: '≈ 15 seconds'
  }
};

/* ====== Helpers ====== */

function getJourney(id) {
  return journeys[id] || null;
}

function getByGroup(groupId) {
  return Object.values(journeys).filter(function(j) {
    return j.group === groupId;
  });
}

function getGroupsWithJourneys() {
  return journeyGroups.map(function(g) {
    return {
      id: g.id,
      label: g.label,
      icon: g.icon,
      journeys: getByGroup(g.id)
    };
  });
}

function getAllJourneys() {
  return Object.values(journeys);
}

function getObjective(id) {
  return objectiveUniverse.find(function(objective) {
    return objective.id === id;
  }) || null;
}

/* ====== Platform helpers (Story 4 ready) ====== */

function getPlatformsForJourney(journeyId) {
  const j = journeys[journeyId];
  return j && j.platforms ? j.platforms : null;
}

function getAssetCount(journeyId) {
  const j = journeys[journeyId];
  if (!j) return 0;
  return j.blueprint.reduce(function(sum, cat) {
    return sum + cat.items.length;
  }, 0);
}

module.exports = {
  objectiveUniverse,
  journeyGroups,
  journeys,
  getJourney,
  getByGroup,
  getGroupsWithJourneys,
  getAllJourneys,
  getObjective,
  getPlatformsForJourney,
  getAssetCount
};
