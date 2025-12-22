const EnvUtil = require('../env');
const SubgraphState = require('../state/subgraph');
const BottleneckLimiters = require('./bottleneck-limiters');

// Can consider which endpoint is further indexed when responses from both endpoints are at least this recent.
const RECENT_RESULT_MS = 2000;

class EndpointBalanceUtil {
  /**
   * Chooses which endpoint to use for an outgoing request.
   * Strategy:
   * 1. If in blacklist or isBurstDepleted, avoid outright.
   *    If any pass this step, an endpoint is guaranteed to be chosen.
   * 2. If the subgraph has errors, is out of sync, or is not on the latest version,
   *    avoid unless some time has passed since last result
   * 3. If there are no options, re-consider whatever was removed in step (2)
   * 4. If there are still multiple to choose from:
   *  a. Ignore both (b) and (c) if >100% utilization for the endpoint they would choose.
   *  b. If an endpoint is most recent in history but not blacklist:
   *   i. If the query explicitly requests a particular block, query that endpoint again
   *      if its known indexed block >= the explicitly requested block.
   *  ii. Otherwise, query the endpoint again if its block >= the latest known
   *      indexed block for that subgraph.
   * iii. If (i) and (ii) were not satisfied, do not query the same endpoint again in the next attempt.
   *  c. If both have a result within the last RECENT_RESULT_MS, prefer one having a later block
   *  d. Prefer according to utilization
   * 5. Choose the preferred endpoint, unless any in this preference stack doesn't have a result in
   *    the last RECENT_RESULT_MS, despite being on the latest version, in sync, and without fatal error
   *    or recent errors. In that case, choose the first endpoint matching that description.
   *
   * @param {string} subgraphName
   * @param {number[]} blacklist - none of these endpoints should be returned.
   * @param {number[]} history - sequence of endpoints which have been chosen and queried to serve this request.
   *    This is useful in balancing queries when one subgraph falls behind but not out of sync.
   * @param {number} requiredBlock - highest block number that was explicitly requested in the query.
   * @returns {number} the endpoint index that should be used for the next query.
   *    If no endpoints are suitable for a reqeuest, returns -1.
   */
  static async chooseEndpoint(subgraphName, blacklist = [], history = [], requiredBlock = null) {
    const selected = await this._chooseEndpoint(subgraphName, blacklist, history, requiredBlock);
    SubgraphState.setLastEndpointSelectedTimestamp(selected, subgraphName);
    return selected;
  }

  // Returns the current utilization percentage for each endpoint underlying this subgraph
  static async getSubgraphUtilization(subgraphName) {
    const utilization = {};
    for (const endpointIndex of EnvUtil.endpointsForSubgraph(subgraphName)) {
      utilization[endpointIndex] = await BottleneckLimiters.getUtilization(endpointIndex, subgraphName);
    }
    return utilization;
  }

  static async _chooseEndpoint(subgraphName, blacklist, history, requiredBlock) {
    const subgraphEndpoints = EnvUtil.endpointsForSubgraph(subgraphName);
    let options = [];
    // Remove blacklisted/overutilized endpoints
    for (const endpointIndex of subgraphEndpoints) {
      if (
        !(await BottleneckLimiters.isBurstDepleted(endpointIndex, subgraphName)) &&
        !blacklist.includes(endpointIndex)
      ) {
        options.push(endpointIndex);
      }
    }

    if (options.length === 0) {
      return -1;
    } else if (options.length === 1) {
      return options[0];
    }

    // If possible, avoid known troublesome endpoints
    const troublesomeEndpoints = await this._getTroublesomeEndpoints(options, subgraphName);
    if (options.length !== troublesomeEndpoints.length) {
      options = options.filter((endpoint) => !troublesomeEndpoints.includes(endpoint));
    }

    if (options.length > 1) {
      const currentUtilization = await this.getSubgraphUtilization(subgraphName);
      const latestIndexedBlock = SubgraphState.getLatestBlock(subgraphName);
      const sortLogic = (a, b) => {
        const isLastHistory = (a) => history[history.length - 1] === a;
        const isOverutilized = (a) => currentUtilization[a] >= 1;
        const canRetryLast = (a) => {
          const minimalBlock = requiredBlock ?? latestIndexedBlock;
          return SubgraphState.getEndpointBlock(a) >= minimalBlock && !isOverutilized(a);
        };
        // Retry previous request to the same endpoint if it didnt fail previously and is fully indexed
        if (isLastHistory(a)) {
          if (canRetryLast(a)) {
            return -1;
          } else if (!isOverutilized(b)) {
            return 1;
          }
        } else if (isLastHistory(b)) {
          if (canRetryLast(b)) {
            return 1;
          } else if (!isOverutilized(a)) {
            return -1;
          }
        }

        // Use endpoint with later results if neither results are stale
        const lastA = SubgraphState.getLastEndpointResultTimestamp(a, subgraphName);
        const lastB = SubgraphState.getLastEndpointResultTimestamp(b, subgraphName);
        if (Math.abs(lastA - lastB) < RECENT_RESULT_MS) {
          const useLaterBlock = (a, b) => {
            return SubgraphState.getEndpointBlock(a) > SubgraphState.getEndpointBlock(b);
          };
          if (useLaterBlock(a, b) && !isOverutilized(a)) {
            return -1;
          } else if (useLaterBlock(b, a) && !isOverutilized(a)) {
            return 1;
          }
        }

        // Choose according to utilization
        if (
          currentUtilization[a] < EnvUtil.getEndpointUtilizationPreference()[a] &&
          currentUtilization[b] < EnvUtil.getEndpointUtilizationPreference()[b]
        ) {
          // Neither are exceeding the preference, use the preferred/lower index endpoint
          return a - b;
        }
        // At least one exceeds the preference, choose the lower of the two
        if (currentUtilization[a] !== currentUtilization[b]) {
          return currentUtilization[a] - currentUtilization[b];
        }
        return a - b;
      };
      options.sort(sortLogic);
    }
    for (let i = 0; i < options.length; ++i) {
      if (
        // No need to check utilization - if there is no recent response and no errors, it cant be over utilized.
        new Date() - SubgraphState.getLastEndpointSelectedTimestamp(options[i], subgraphName) > RECENT_RESULT_MS &&
        !SubgraphState.endpointHasFatalErrors(options[i], subgraphName) &&
        !SubgraphState.isRecentlyHavingError(options[i], subgraphName) &&
        !(await SubgraphState.isStaleVersion(options[i], subgraphName)) &&
        (await SubgraphState.isInSync(options[i], subgraphName))
      ) {
        return options[i];
      }
    }
    return options[0];
  }

  // A "troublesome endpoint" is defined as an endpoint which is known in the last minute to: (1) have errors,
  // (2) be out of sync/singificantly behind in indexing, or (3) not running the latest subgraph version
  static async _getTroublesomeEndpoints(endpointsIndices, subgraphName) {
    const troublesomeEndpoints = [];
    for (const endpointIndex of endpointsIndices) {
      if (
        SubgraphState.isRecentlyHavingError(endpointIndex, subgraphName) ||
        (await SubgraphState.isRecentlyOutOfSync(endpointIndex, subgraphName)) ||
        (await SubgraphState.isRecentlyStaleVersion(endpointIndex, subgraphName))
      ) {
        troublesomeEndpoints.push(endpointIndex);
      }
    }
    return troublesomeEndpoints;
  }
}

module.exports = EndpointBalanceUtil;
