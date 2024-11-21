const SubgraphClients = require('../datasources/subgraph-clients');
const EndpointBalanceUtil = require('../utils/load/endpoint-balance');
const GraphqlQueryUtil = require('../utils/graph-query');
const EndpointError = require('../error/endpoint-error');
const RequestError = require('../error/request-error');
const RateLimitError = require('../error/rate-limit-error');
const SubgraphState = require('../utils/state/subgraph');
const ChainState = require('../utils/state/chain');
const LoggingUtil = require('../utils/logging');
const EnvUtil = require('../utils/env');
const DiscordUtil = require('../utils/discord');
const SubgraphStatusService = require('./subgraph-status-service');

class SubgraphProxyService {
  // Proxies a subgraph request, accounting for version numbers and indexed blocks
  static async handleProxyRequest(subgraphName, originalQuery, variables) {
    EnvUtil.throwOnInvalidName(subgraphName);
    const queryWithMetadata = GraphqlQueryUtil.addMetadataToQuery(originalQuery);
    const queryResult = await this._getQueryResult(subgraphName, queryWithMetadata, variables);

    const version = queryResult.version.versionNumber;
    const deployment = queryResult._meta.deployment;
    const chain = queryResult.version.chain;

    const result = GraphqlQueryUtil.removeUnrequestedMetadataFromResult(queryResult, originalQuery);
    return {
      meta: {
        version,
        deployment,
        chain
      },
      body: result
    };
  }

  // Gets the result for this query from one of the available endpoints.
  static async _getQueryResult(subgraphName, query, variables) {
    const startTime = new Date();
    const startUtilization = await EndpointBalanceUtil.getSubgraphUtilization(subgraphName);
    const failedEndpoints = [];
    const unsyncdEndpoints = [];
    const staleVersionEndpoints = [];
    const endpointHistory = [];
    try {
      const result = await this._getReliableResult(
        subgraphName,
        query,
        variables,
        failedEndpoints,
        unsyncdEndpoints,
        staleVersionEndpoints,
        endpointHistory
      );
      LoggingUtil.logSuccessfulProxy(subgraphName, startTime, startUtilization, endpointHistory, [
        ...failedEndpoints,
        ...unsyncdEndpoints,
        ...staleVersionEndpoints
      ]);
      return result;
    } catch (e) {
      LoggingUtil.logFailedProxy(subgraphName, startTime, startUtilization, endpointHistory, [
        ...failedEndpoints,
        ...unsyncdEndpoints,
        ...staleVersionEndpoints
      ]);
      throw e;
    }
  }

  // Returns a reliable query result with respect to response consistency and api availability.
  static async _getReliableResult(
    subgraphName,
    query,
    variables,
    failedEndpoints,
    unsyncdEndpoints,
    staleVersionEndpoints,
    endpointHistory
  ) {
    const errors = [];
    const requiredBlock = GraphqlQueryUtil.maxRequestedBlock(query);
    let endpointIndex;
    while (
      (endpointIndex = await EndpointBalanceUtil.chooseEndpoint(
        subgraphName,
        [...failedEndpoints, ...unsyncdEndpoints, ...staleVersionEndpoints],
        endpointHistory,
        requiredBlock
      )) !== -1
    ) {
      endpointHistory.push(endpointIndex);
      let queryResult;
      try {
        const client = await SubgraphClients.makeCallableClient(endpointIndex, subgraphName);
        queryResult = await client(query, variables);
      } catch (e) {
        if (e instanceof RateLimitError) {
          break; // Will likely result in rethrowing a different RateLimitError
        }
        if (await this._isRetryableBlockException(e, endpointIndex, subgraphName)) {
          continue;
        } else {
          failedEndpoints.push(endpointIndex);
          staleVersionEndpoints.length = 0;
          errors.push(e);
        }
      }

      if (queryResult) {
        SubgraphState.updateStatesWithResult(endpointIndex, subgraphName, queryResult);
        for (const failedIndex of failedEndpoints) {
          SubgraphState.setEndpointHasErrors(failedIndex, subgraphName, true);
        }

        // Avoid endpoints with issues
        if (!EnvUtil.allowUnsyncd() && !(await SubgraphState.isInSync(endpointIndex, subgraphName))) {
          unsyncdEndpoints.push(endpointIndex);
          staleVersionEndpoints.length = 0;
          continue;
        } else if (await SubgraphState.isStaleVersion(endpointIndex, subgraphName)) {
          // Note that an old version won't be stale if the newer version failed/is out of sync
          staleVersionEndpoints.push(endpointIndex);
          continue;
        }

        if (queryResult._meta.block.number >= SubgraphState.getLatestBlock(subgraphName)) {
          return queryResult;
        }
        // The endpoint is in sync, but a more recent response had previously been given, either for this endpoint or
        // another. Do not accept this response. A valid response is expected on the next attempt
      }
    }
    await this._throwFailureReason(subgraphName, errors, failedEndpoints, unsyncdEndpoints, staleVersionEndpoints);
  }

  // Identifies whether the failure is recoverable, due to response being behind an explicitly requested block.
  // There is also a type of block exception where the requested block is earlier than the start of indexing.
  // Sample error messages:
  // "has only indexed up to block number 20580123 and data for block number 22333232 is therefore not yet available"
  // "only has data starting at block number 500 and data for block number 20582045 is therefore not yet available"
  static async _isRetryableBlockException(e, endpointIndex, subgraphName) {
    const matchFuture = e.message.match(/indexed up to block number \d+ and data for block number (\d+) is therefore/);
    if (matchFuture) {
      const requestedBlock = parseInt(matchFuture[1]);
      const chain = SubgraphState.getEndpointChain(endpointIndex, subgraphName);
      if (requestedBlock > (await ChainState.getChainHead(chain)) + 5) {
        // User requested a future block. This is not allowed
        throw new RequestError(`The requested block ${requestedBlock} is invalid for chain ${chain}.`);
      }
      return true;
    }

    const matchPast = e.message.match(
      /only has data starting at block number (\d+) and data for block number (\d+) is therefore/
    );
    if (matchPast) {
      const earliestBlock = parseInt(matchPast[1]);
      const requestedBlock = parseInt(matchPast[2]);
      throw new RequestError(
        `The requested block ${requestedBlock} is smaller than the earliest accessible block for ${subgraphName}: ${earliestBlock}.`
      );
    }
    return false;
  }

  // Throws an exception based on the failure reason
  static async _throwFailureReason(subgraphName, errors, failedEndpoints, unsyncdEndpoints, staleVersionEndpoints) {
    const endpointsAttempted = failedEndpoints.length + unsyncdEndpoints.length + staleVersionEndpoints.length;
    if (endpointsAttempted < EnvUtil.endpointsForSubgraph(subgraphName).length) {
      // If any of the endpoints were not attempted, assume this is a rate limiting issue.
      // This is preferable to performing the status check on a failing endpoint,
      // while another endpoint is presumably alive and actively servicing requests.
      if (endpointsAttempted === 0) {
        DiscordUtil.sendWebhookMessage(
          `Rate limit exceeded on all endpoints for ${subgraphName}. No endpoints attempted to service this request.`
        );
      } else {
        DiscordUtil.sendWebhookMessage(
          `Rate limit exceeded on endpoint(s) for ${subgraphName}. At least one endpoint tried and failed this request.`
        );
      }
      throw new RateLimitError(
        'The server is currently experiencing high traffic and cannot process your request. Please try again later.'
      );
    } else if (failedEndpoints.length > 0) {
      if (new Date() - SubgraphState.getLatestSubgraphErrorCheck(subgraphName) < 60 * 1000) {
        if (SubgraphState.allHaveErrors(subgraphName)) {
          throw new EndpointError('Subgraph is unable to process this request and may be offline.');
        } else {
          throw new RequestError(errors[0].message);
        }
      }

      // All endpoints failed. Check status to see if subgraphs are down or the client constructed a bad query.
      let hasErrors = true;
      let fatalError;
      const endpointIndex = await EndpointBalanceUtil.chooseEndpoint(subgraphName);
      try {
        SubgraphState.setLatestSubgraphErrorCheck(subgraphName);
        fatalError = await SubgraphStatusService.checkFatalError(endpointIndex, subgraphName);
        if (!fatalError) {
          hasErrors = false;
        }
      } catch (e) {
        if (e instanceof RateLimitError) {
          throw e;
        }
      }

      if (hasErrors) {
        // Assume the client query was not the issue
        for (const failedIndex of failedEndpoints) {
          SubgraphState.setEndpointHasErrors(failedIndex, subgraphName, true);
        }
        if (!fatalError) {
          console.log(`Failed to retrieve status for ${subgraphName} e-${endpointIndex}.`);
        }
        throw new EndpointError('Subgraph is unable to process this request and may be offline.');
      } else {
        // The endpoint is responsive and therefore the user constructed a bad request
        throw new RequestError(errors[0].message);
      }
    } else if (unsyncdEndpoints.length > 0) {
      throw new EndpointError('Subgraph has not yet indexed up to the latest block.');
    }
  }
}

module.exports = SubgraphProxyService;
