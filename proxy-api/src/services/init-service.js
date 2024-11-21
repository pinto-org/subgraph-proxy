const SubgraphClients = require('../datasources/subgraph-clients');
const EnvUtil = require('../utils/env');
const GraphqlQueryUtil = require('../utils/graph-query');
const SubgraphState = require('../utils/state/subgraph');

class InitService {
  // Initializes all states
  static async initAllStates() {
    const promiseGenerators = [];
    for (const subgraphName of EnvUtil.getEnabledSubgraphs()) {
      promiseGenerators.push(() => this.initSubgraphStates(subgraphName));
    }
    await Promise.all(promiseGenerators.map((p) => p()));
  }

  // Initializes states by subgraph
  static async initSubgraphStates(subgraphName) {
    const promiseGenerators = [];
    for (const endpointIndex of EnvUtil.endpointsForSubgraph(subgraphName)) {
      promiseGenerators.push(() => this.initState(endpointIndex, subgraphName));
    }
    await Promise.all(promiseGenerators.map((p) => p()));
  }

  // Initializes states by endpoint
  static async initEndpointStates(endpointIndex) {
    const promiseGenerators = [];
    for (const subgraphName of EnvUtil.subgraphsForEndpoint(endpointIndex)) {
      promiseGenerators.push(() => this.initState(endpointIndex, subgraphName));
    }
    await Promise.all(promiseGenerators.map((p) => p()));
  }

  // Initialize the state for the given endpoint/subgraph pair
  static async initState(endpointIndex, subgraphName) {
    try {
      const client = await SubgraphClients.makeCallableClient(endpointIndex, subgraphName);
      const metaAndVersion = await client(`{${GraphqlQueryUtil.METADATA_QUERY}}`);
      SubgraphState.updateStatesWithResult(endpointIndex, subgraphName, metaAndVersion);
      SubgraphState.setLastEndpointSelectedTimestamp(endpointIndex, subgraphName);
      console.log(`Initialized e-${endpointIndex} for ${subgraphName}.`);
    } catch (e) {
      console.log(`Failed to initialize e-${endpointIndex} for ${subgraphName}.`);
      SubgraphState.setEndpointHasErrors(endpointIndex, subgraphName, true);
    }
  }
}

module.exports = InitService;
