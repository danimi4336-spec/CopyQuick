function stringList(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()) : [];
}

function cleanDirection(value) {
  return String(value || '').split(' — ')[0].trim();
}

function buildProductionSynthesis(outputs = []) {
  const byId = new Map(outputs.map(item => [item.deliverableId, item.output]));
  const concept = byId.get('product_concept_brief');
  const validation = byId.get('validation_plan');
  if (!concept || !validation) return null;

  const specification = byId.get('product_specification_brief');
  const sourcing = byId.get('sourcing_manufacturer_brief');
  const compliance = byId.get('compliance_evidence_checklist');
  const economics = byId.get('unit_economics_pricing_model');
  const physicalTrack = Boolean(specification);

  const directions = stringList(concept.directionsToExplore).map(cleanDirection);
  const openDecisions = physicalTrack
    ? [...stringList(specification.openSpecificationDecisions), ...stringList(concept.openDecisions)]
    : stringList(concept.openDecisions);
  const nextActions = physicalTrack
    ? [...stringList(validation.nextActions), ...stringList(sourcing?.nextActions)]
    : stringList(validation.nextActions);
  const evidenceNeeded = physicalTrack
    ? [...stringList(validation.evidenceToCollect), ...stringList(compliance?.evidenceNeeded)]
    : stringList(validation.evidenceToCollect);
  return {
    currentStage: 'Idea validation',
    conceptDirections: directions,
    openDecisions: openDecisions.slice(0, 3),
    immediateActions: nextActions.slice(0, 3),
    evidenceNeeded: evidenceNeeded.slice(0, 3),
    unlockTitle: physicalTrack ? 'Before product pages, imagery, and launch campaigns unlock' : 'Before Amazon listing and launch assets unlock',
    unlockConditions: physicalTrack
      ? [
          'The approved product specification has measurable requirements and validated prototype or sample evidence.',
          'Supplier capability, compliance responsibilities, landed economics, packaging, and fulfillment assumptions are documented.',
          economics ? 'Price, minimum order, cash exposure, and contribution margin are acceptable under documented downside assumptions.' : 'Unit economics and pricing inputs are established before inventory commitment.'
        ]
      : [
          'A specific customer priority is repeated across credible discovery conversations.',
          'One product direction is consistently understood and relevant enough to develop further.',
          'The product definition and substantiation plan are established before listing, imagery, or launch claims are created.'
        ]
  };
}

module.exports = { buildProductionSynthesis };
