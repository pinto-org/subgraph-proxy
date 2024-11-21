const axios = require('axios');
const EnvUtil = require('../utils/env');
const SubgraphState = require('../utils/state/subgraph');
const BottleneckLimiters = require('../utils/load/bottleneck-limiters');
const DiscordUtil = require('../utils/discord');

class SubgraphStatusService {
  // If there is any fatal error with this deployment, return the reason message.
  // Underlying implementation is different depending on the subgraph provider.
  static async checkFatalError(endpointIndex, subgraphName) {
    const endpointType = EnvUtil.getEndpointTypes()[endpointIndex];
    let fatalError;
    switch (endpointType) {
      case 'alchemy':
        const alchemyStatus = await this._getAlchemyStatus(endpointIndex, subgraphName);
        fatalError = alchemyStatus.data.data.indexingStatusForCurrentVersion.fatalError?.message;
        break;
      case 'graph':
        const graphStatus = await this._getGraphStatus(endpointIndex, subgraphName);
        fatalError = graphStatus.data.data.indexingStatuses[0].fatalError?.message;
        break;
      default:
        throw new Error(`Unrecognized endpoint type '${endpointType}'.`);
    }

    // Handle related state/messaging
    if (fatalError) {
      if (!SubgraphState.endpointHasFatalErrors(endpointIndex, subgraphName)) {
        DiscordUtil.sendWebhookMessage(
          `A fatal error was encountered for ${subgraphName} e-${endpointIndex}: ${fatalError}`,
          true
        );
        SubgraphState.setEndpointHasFatalErrors(endpointIndex, subgraphName, true);
      }
    } else {
      if (SubgraphState.endpointHasFatalErrors(endpointIndex, subgraphName)) {
        DiscordUtil.sendWebhookMessage(`${subgraphName} e-${endpointIndex} has recovered.`, true);
        SubgraphState.setEndpointHasFatalErrors(endpointIndex, subgraphName, false);
      }
    }
    return fatalError;
  }

  static async _getAlchemyStatus(endpointIndex, subgraphName) {
    const statusUrl = EnvUtil.underlyingUrl(endpointIndex, subgraphName).replace('/api', '/status');
    const status = await BottleneckLimiters.schedule(endpointIndex, async () => await axios.post(statusUrl));
    return status;
  }

  static async _getGraphStatus(endpointIndex, subgraphName) {
    const statusUrl = 'https://api.thegraph.com/index-node/graphql';
    const deploymentHash = SubgraphState.getEndpointDeployment(endpointIndex, subgraphName);
    if (!deploymentHash) {
      throw new Error(
        `Can't retrieve status for Graph Network subgraph '${subgraphName}': the deployment hash is unknown.`
      );
    }

    const status = await BottleneckLimiters.schedule(
      endpointIndex,
      async () =>
        await axios.post(statusUrl, {
          operationName: 'SubgraphIndexingStatusFatalError',
          variables: {
            deploymentIds: [deploymentHash]
          },
          query:
            'query SubgraphIndexingStatusFatalError($deploymentIds: [String!]!) {\n  indexingStatuses(subgraphs: $deploymentIds) {\n    health\n    fatalError {\n      message\n      block {\n        number\n        hash\n        __typename\n      }\n      handler\n      __typename\n    }\n    __typename\n  }\n}'
        })
    );
    return status;
  }
}

module.exports = SubgraphStatusService;
