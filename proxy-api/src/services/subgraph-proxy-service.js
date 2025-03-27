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
const EndpointHistory = require('../utils/load/endpoint-history');

class SubgraphProxyService {
  // Proxies a subgraph request, accounting for version numbers and indexed blocks
  static async handleProxyRequest(subgraphName, originalQuery, variables) {
    EnvUtil.throwOnInvalidName(subgraphName);
    const requiredBlock = GraphqlQueryUtil.requiredIndexedBlock(originalQuery);
    const queryWithMetadata = GraphqlQueryUtil.addMetadataToQuery(originalQuery);
    const { data, endpointIndex } = await this._getQueryResult(
      subgraphName,
      queryWithMetadata,
      variables,
      requiredBlock
    );

    const version = data.version.versionNumber;
    const deployment = data._meta.deployment;
    const chain = data.version.chain;
    const indexedBlock = data._meta.block.number;

    const body = GraphqlQueryUtil.removeUnrequestedMetadataFromResult(data, originalQuery);
    return {
      meta: {
        version,
        deployment,
        chain,
        indexedBlock,
        endpointIndex
      },
      body
    };
  }

  // Gets the result for this query from one of the available endpoints.
  static async _getQueryResult(subgraphName, query, variables, requiredBlock) {
    const startTime = new Date();
    const startUtilization = await EndpointBalanceUtil.getSubgraphUtilization(subgraphName);
    const endpointHistory = new EndpointHistory();
    try {
      const result = await this._getReliableResult(subgraphName, query, variables, requiredBlock, endpointHistory);
      LoggingUtil.logSuccessfulProxy(query, subgraphName, startTime, startUtilization, endpointHistory);
      return result;
    } catch (e) {
      LoggingUtil.logFailedProxy(query, subgraphName, startTime, startUtilization, endpointHistory);
      throw e;
    }
  }

  // Returns a reliable query result with respect to response consistency and api availability.
  static async _getReliableResult(subgraphName, query, variables, requiredBlock, stepRecorder) {
    // Add a brief delay if all endpoints have been tried; the request is not being dropped
    const delayRetry = async () => {
      if (stepRecorder.hasTriedEachEndpoint(subgraphName)) {
        // This implementation is not perfect since ideally it would delay only once after trying each
        // endpoint, but in practice this is tough to implement since the endpoint balancer may be unpredictable.
        // Thus a low timeout delay is chosen.
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    };

    const errors = [];
    let endpointIndex;
    while (
      (endpointIndex = await EndpointBalanceUtil.chooseEndpoint(
        subgraphName,
        stepRecorder.getIssueIndexes(),
        stepRecorder.getHistoryIndexes(),
        requiredBlock === Number.MAX_SAFE_INTEGER ? null : requiredBlock
      )) !== -1
    ) {
      let queryResult;
      try {
        const client = await SubgraphClients.makeCallableClient(endpointIndex, subgraphName);
        queryResult = await client(query, variables);
      } catch (e) {
        if (e instanceof RateLimitError) {
          break; // Will likely result in rethrowing a different RateLimitError
        }
        try {
          // Identify whether the exception was related to the block number requested
          const failedBlock = await this._failedBlockException(e, endpointIndex, subgraphName);
          if (failedBlock) {
            if (failedBlock > SubgraphState.getEndpointBlock(endpointIndex, subgraphName) + 50) {
              // User requested block that has not been indexed yet
              stepRecorder.unsyncd(endpointIndex);
            } else {
              // Endpoint is behind but not out of sync
              stepRecorder.behindButRetryable(endpointIndex);
              await delayRetry();
            }
            continue;
          } else {
            stepRecorder.failed(endpointIndex);
            errors.push(e);
          }
        } catch (e2) {
          stepRecorder.invalidBlock(endpointIndex);
          throw e2;
        }
      }

      if (queryResult) {
        SubgraphState.updateStatesWithResult(endpointIndex, subgraphName, queryResult);
        for (const failedIndex of stepRecorder.getFailedEndpoints()) {
          SubgraphState.setEndpointHasErrors(failedIndex, subgraphName, true);
        }

        // Avoid endpoints that are out of sync unless it is explicitly allowable
        if (
          !EnvUtil.allowUnsyncd() &&
          queryResult._meta.block.number < requiredBlock &&
          !(await SubgraphState.isInSync(endpointIndex, subgraphName))
        ) {
          stepRecorder.unsyncd(endpointIndex);
          continue;
          // Avoid stale versions
        } else if (await SubgraphState.isStaleVersion(endpointIndex, subgraphName)) {
          // Note that an old version won't be stale if the newer version failed/is out of sync
          stepRecorder.stale(endpointIndex);
          continue;
        }

        if (queryResult._meta.block.number >= SubgraphState.getLatestBlock(subgraphName)) {
          if (errors.length > 0) {
            // If there were any errors before an accepted response, log them
            console.log(
              `Accepted request, but one endpoint failed with message: ${errors[0].message}\nquery: ${query}`
            );
          }
          stepRecorder.accepted(endpointIndex);
          return {
            data: queryResult,
            endpointIndex
          };
        }
        // The endpoint is in sync, but a more recent response had previously been given, either for this endpoint or
        // another. Do not accept this response. A valid response is expected on the next attempt
        stepRecorder.wobbled(endpointIndex);

        await delayRetry();
      }
    }
    await this._throwFailureReason(subgraphName, errors, stepRecorder);
  }

  // Identifies whether the failure is due to the indexed block - the response being behind an explicitly requested block.
  // There is also a type of block exception where the requested block is earlier than the start of indexing.
  // Sample error messages:
  // alchemy:
  // "has only indexed up to block number 20580123 and data for block number 22333232 is therefore not yet available"
  // "only has data starting at block number 500 and data for block number 20582045 is therefore not yet available"
  // dnet:
  // "Unavailable(missing block: 28068745, latest: 28068741)"
  // "bad query: bad query: requested block 29, before minimum `startBlock` of manifest 22622961"
  static async _failedBlockException(e, endpointIndex, subgraphName) {
    const matchFuture =
      e.message.match(/indexed up to block number (\d+) and data for block number (\d+) is therefore/) ??
      e.message.match(/Unavailable\(missing block: (\d+), latest: (\d+)\)/);
    if (matchFuture) {
      const blocks = [parseInt(matchFuture[1]), parseInt(matchFuture[2])];
      const indexedBlock = Math.min(...blocks);
      const requestedBlock = Math.max(...blocks);

      SubgraphState.setEndpointBlock(endpointIndex, subgraphName, indexedBlock);
      const chain = SubgraphState.getEndpointChain(endpointIndex, subgraphName);
      if (requestedBlock > (await ChainState.getChainHead(chain)) + 5) {
        // User requested a future block. This is never allowed
        throw new RequestError(
          `The requested block ${requestedBlock} is invalid for chain ${chain} (chain head is ${await ChainState.getChainHead(chain)}).`
        );
      }
      return requestedBlock;
    }

    // Requesting blocks before indexing starts is never allowed
    const matchPast =
      e.message.match(/only has data starting at block number (\d+) and data for block number (\d+) is therefore/) ??
      e.message.match(/bad query: bad query: requested block (\d+), before minimum `startBlock` of manifest (\d+)/);
    if (matchPast) {
      // Blocks are provided in reverse order for the two endpoint types
      const blocks = [parseInt(matchPast[1]), parseInt(matchPast[2])];
      const earliestBlock = Math.min(...blocks);
      const requestedBlock = Math.max(...blocks);
      throw new RequestError(
        `The requested block ${requestedBlock} is smaller than the earliest accessible block for ${subgraphName}: ${earliestBlock}.`
      );
    }
  }

  // Throws an exception based on the failure reason
  static async _throwFailureReason(subgraphName, errors, endpointHistory) {
    const [failedEndpoints, unsyncdEndpoints, staleVersionEndpoints] = [
      endpointHistory.getFailedEndpoints(),
      endpointHistory.getUnsyncdEndpoints(),
      endpointHistory.getStaleEndpoints()
    ];

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
      const indexedBlock = SubgraphState.getLatestBlock(subgraphName);
      DiscordUtil.sendWebhookMessage(`Subgraph ${subgraphName} has fallen behind (currently at ${indexedBlock}).`);
      throw new EndpointError(`Subgraph has not indexed up to the latest block (currently at ${indexedBlock}).`);
    }
  }
}

module.exports = SubgraphProxyService;
