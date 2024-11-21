const InitService = require('../../services/init-service');
const EnvUtil = require('../../utils/env');

class GraphStateTask {
  // Graph network subgraphs need to be re-initialized periodically since old versions persist and
  // would still be used by the status check if the deployment hash does not get updated.
  static async updateGraphEndpointStates() {
    const graphEndpointIndex = EnvUtil.getEndpointTypes().indexOf('graph');
    if (graphEndpointIndex !== -1) {
      await InitService.initEndpointStates(graphEndpointIndex);
    }
  }
}

module.exports = GraphStateTask;
