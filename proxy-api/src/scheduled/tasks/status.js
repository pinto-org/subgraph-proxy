const SubgraphStatusService = require('../../services/subgraph-status-service');
const EnvUtil = require('../../utils/env');
const BottleneckLimiters = require('../../utils/load/bottleneck-limiters');

class StatusTask {
  // Perform an error check if utilization is low. There is no need to do the check when
  // utilization is high, since regular api requests can perform the check also.
  static async checkAll() {
    for (const subgraphName of EnvUtil.getEnabledSubgraphs()) {
      for (const endpointIndex of EnvUtil.endpointsForSubgraph(subgraphName)) {
        const utilization = await BottleneckLimiters.getUtilization(endpointIndex);
        if (utilization <= EnvUtil.getStatusCheckMaxUtilization()) {
          try {
            await SubgraphStatusService.checkFatalError(endpointIndex, subgraphName);
          } catch (e) {
            console.log(`Failed to retrieve status for ${subgraphName} e-${endpointIndex}.`);
          }
        }
      }
    }
  }
}

module.exports = StatusTask;
