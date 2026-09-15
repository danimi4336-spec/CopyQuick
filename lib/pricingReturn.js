const PRICING_RETURN_DESTINATIONS = Object.freeze({
  '/discovery/build-plan': 'Back to Build Plan',
  '/production/review': 'Back to Production Review'
});

function pricingReturn(value) {
  if (typeof value !== 'string') return null;
  const label = PRICING_RETURN_DESTINATIONS[value];
  return label ? { path: value, label } : null;
}

module.exports = { PRICING_RETURN_DESTINATIONS, pricingReturn };
