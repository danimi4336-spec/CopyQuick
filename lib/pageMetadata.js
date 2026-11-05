const DEFAULT_PUBLIC_ORIGIN = 'https://copyquick.co';

const PUBLIC_PAGES = Object.freeze({
  '/': Object.freeze({
    title: 'CopyQuick — Guided Marketing Planning and Content Production',
    description: 'Turn a business objective into an evidence-aware marketing strategy, Build Plan, and customer-ready content with CopyQuick.'
  }),
  '/about': Object.freeze({
    title: 'About CopyQuick',
    description: 'Learn how CopyQuick guides small businesses from business context and strategy to an actionable marketing Build Plan.'
  }),
  '/contact': Object.freeze({
    title: 'Contact CopyQuick Support',
    description: 'Contact CopyQuick support with product, account, billing, or accessibility questions.'
  }),
  '/pricing': Object.freeze({
    title: 'CopyQuick Pricing',
    description: 'Compare CopyQuick monthly credit plans for guided marketing planning and customer-ready content production.'
  }),
  '/privacy': Object.freeze({
    title: 'Privacy Policy — CopyQuick',
    description: 'Read the CopyQuick Privacy Policy and learn how account, billing, and product data are handled.'
  }),
  '/terms': Object.freeze({
    title: 'Terms of Service — CopyQuick',
    description: 'Read the terms that govern access to and use of CopyQuick.'
  }),
  '/cookies': Object.freeze({
    title: 'Cookie Policy — CopyQuick',
    description: 'Read how CopyQuick uses essential cookies and related browser storage.'
  }),
  '/refunds': Object.freeze({
    title: 'Refund Policy — CopyQuick',
    description: 'Review the CopyQuick refund policy and how to request billing assistance.'
  })
});

function normalizedOrigin(value) {
  const candidate = String(value || '').trim();
  try {
    const parsed = new URL(candidate || DEFAULT_PUBLIC_ORIGIN);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      return DEFAULT_PUBLIC_ORIGIN;
    }
    return parsed.origin;
  } catch (_) {
    return DEFAULT_PUBLIC_ORIGIN;
  }
}

function pageMetadataFor(pathname, options = {}) {
  const path = typeof pathname === 'string' && pathname.startsWith('/') ? pathname : '/';
  const definition = PUBLIC_PAGES[path];
  if (!definition) {
    return Object.freeze({
      indexable: false,
      robots: 'noindex, nofollow, noarchive',
      title: options.title || 'CopyQuick'
    });
  }
  const origin = normalizedOrigin(options.origin);
  const canonicalUrl = new URL(path, `${origin}/`).href;
  return Object.freeze({
    ...definition,
    indexable: true,
    robots: 'index, follow',
    canonicalUrl,
    imageUrl: new URL('/images/copyquick-social-card.png', `${origin}/`).href,
    imageAlt: 'CopyQuick — guided marketing planning and content production',
    type: 'website'
  });
}

function sitemapEntries(options = {}) {
  const origin = normalizedOrigin(options.origin);
  return Object.keys(PUBLIC_PAGES).map(path => new URL(path, `${origin}/`).href);
}

module.exports = {
  DEFAULT_PUBLIC_ORIGIN,
  PUBLIC_PAGES,
  normalizedOrigin,
  pageMetadataFor,
  sitemapEntries
};
