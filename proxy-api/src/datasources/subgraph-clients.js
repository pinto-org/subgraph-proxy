const { GraphQLClient } = require('graphql-request');
const EnvUtil = require('../utils/env');
const BottleneckLimiters = require('../utils/load/bottleneck-limiters');

class SubgraphClients {
  // Stores the clients, key format endpointIndex-subgraphName (based on the ordering in .env)
  static clients = {};

  static getClient(endpointIndex, subgraphName) {
    const key = `${endpointIndex}-${subgraphName}`;
    if (!this.clients[key]) {
      this.clients[key] = new GraphQLClient(EnvUtil.underlyingUrl(endpointIndex, subgraphName));
    }
    return this.clients[key];
  }

  static async makeCallableClient(endpointIndex, subgraphName) {
    const callableClient = async (query, variables) => {
      const client = this.getClient(endpointIndex, subgraphName);
      const response = await client.request(query, variables);
      return response;
    };
    const limiterWrapped = await BottleneckLimiters.wrap(endpointIndex, callableClient);
    return limiterWrapped;
  }
}

module.exports = SubgraphClients;
