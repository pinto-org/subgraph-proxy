const cron = require('node-cron');
const DiscordUtil = require('../utils/discord');
const SubgraphStatusService = require('../services/subgraph-status-service');
const GraphStateTask = require('./tasks/graph-state');
const StatusTask = require('./tasks/status');

// All cron jobs which could be activated are configured here
const ALL_JOBS = {
  status: {
    cron: '* * * * *',
    function: StatusTask.checkAll
  },
  reInitGraphState: {
    cron: '0/30 * * * *',
    function: GraphStateTask.updateGraphEndpointStates
  }
};

// Error handling wrapper for scheduled task functions
async function errorWrapper(fn) {
  try {
    fn();
  } catch (e) {
    console.log('[node-cron] Error in scheduled task', e);
  }
}

function activateJobs(jobNames) {
  let activated = [];
  let failed = [];

  for (const jobName of jobNames) {
    const job = ALL_JOBS[jobName];
    if (job) {
      cron.schedule(job.cron, () => errorWrapper(job.function));
      activated.push(jobName);
    } else {
      failed.push(jobName);
    }
  }
  if (activated.length > 0) {
    console.log(`Activated ${activated.length} jobs: ${activated.join(', ')}`);
  }
  if (failed.length > 0) {
    DiscordUtil.sendWebhookMessage(`Failed to activate jobs: ${failed.join(', ')}`);
    console.log(`Failed to activate jobs: ${failed.join(', ')}`);
  }
}

module.exports = {
  activateJobs
};
