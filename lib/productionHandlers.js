const { getProductionContract, getProductionContractIds } = require('./productionContracts');

function getProductionHandler(deliverableId) {
  return getProductionContract(deliverableId);
}

function isExecutableDeliverable(deliverableId) {
  return Boolean(getProductionHandler(deliverableId));
}

function getExecutableDeliverableIds() {
  return getProductionContractIds();
}

module.exports = {
  getExecutableDeliverableIds,
  getProductionHandler,
  isExecutableDeliverable
};
