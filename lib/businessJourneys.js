/**
 * Guided objectives exposed by the customer entry flow.
 *
 * Only objectives backed by a complete Objective -> Discovery -> Strategy ->
 * Build Plan workflow may be submitted. Planned objectives remain visible
 * without pretending their workflow is currently executable.
 */
const objectiveUniverse = [
  {
    id: 'launch_product', available: true, icon: '🚀', title: 'Launch a New Product',
    description: 'Bring a new offer to market with a clear, coordinated plan.',
    outcome: 'Create a complete launch strategy including positioning, messaging, marketing assets and recommended next steps.'
  },
  {
    id: 'get_more_customers', available: true, icon: '👥', title: 'Get More Customers',
    description: 'Build a practical path to attract and win more buyers.',
    outcome: 'Identify the strongest acquisition opportunities and create the campaigns, messages and next steps to turn prospects into customers.'
  },
  {
    id: 'increase_conversion_rates', available: false, icon: '📈', title: 'Increase Conversion Rates',
    description: 'Turn more of your existing traffic into customers.',
    outcome: 'Strengthen your offer, sales messaging and customer journey so more visitors take the next step.'
  },
  {
    id: 'improve_search_rankings', available: false, icon: '🔍', title: 'Improve Search Rankings',
    description: 'Grow discoverability with a focused search strategy.',
    outcome: 'Clarify priority search opportunities and build optimized content and messaging that help the right customers find you.'
  },
  {
    id: 'build_brand', available: false, icon: '✨', title: 'Build My Brand',
    description: 'Create a distinctive brand customers recognize and trust.',
    outcome: 'Define your positioning, voice and core story, then translate them into consistent messaging across your business.'
  },
  {
    id: 'promote_service', available: false, icon: '💼', title: 'Promote My Service',
    description: 'Present your expertise clearly and win better-fit clients.',
    outcome: 'Shape a compelling service offer and create the sales, outreach and trust-building assets needed to attract clients.'
  },
  {
    id: 'validate_idea', available: false, icon: '💡', title: 'Validate My Idea',
    description: 'Test demand before investing significant time or money.',
    outcome: 'Clarify your audience, value proposition and validation plan so you can gather evidence and make a confident go-or-adjust decision.'
  },
  {
    id: 'more_objectives', available: false, icon: '➕', title: 'More Objectives',
    description: 'Explore additional ways to build, grow or promote.',
    outcome: 'Additional guided objective workflows are planned.'
  }
];

function getObjective(id) {
  return objectiveUniverse.find((objective) => objective.id === id) || null;
}

function getAvailableObjective(id) {
  const objective = getObjective(id);
  return objective?.available ? objective : null;
}

module.exports = { objectiveUniverse, getObjective, getAvailableObjective };
