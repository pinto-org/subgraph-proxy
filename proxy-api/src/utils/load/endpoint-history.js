const EnvUtil = require('../env');

class EndpointHistory {
  constructor() {
    this.endpointHistory = [];
    this.issueEndpoints = [];
  }

  accepted(index) {
    this.endpointHistory.push({ index, decision: 'a' });
  }

  failed(index, error) {
    const errorCode = (() => {
      if (error?.message?.includes('Store error')) {
        return '(1)';
      } else {
        // This should be temporary so that we can identify the various errors as they occur
        console.log('Unexpected error:', error?.message);
        return '(?)';
      }
    })();
    this.endpointHistory.push({ index, decision: `f${errorCode}` });
    this.issueEndpoints.push({ index, reason: `f${errorCode}` });
    this.issueEndpoints = this.issueEndpoints.filter((v) => v.reason !== 's');
  }

  unsyncd(index) {
    this.endpointHistory.push({ index, decision: 'u' });
    this.issueEndpoints.push({ index, reason: 'u' });
    this.issueEndpoints = this.issueEndpoints.filter((v) => v.reason !== 's');
  }

  stale(index) {
    this.endpointHistory.push({ index, decision: 's' });
    this.issueEndpoints.push({ index, reason: 's' });
  }

  behindButRetryable(index) {
    this.endpointHistory.push({ index, decision: 'b' });
  }

  wobbled(index) {
    this.endpointHistory.push({ index, decision: 'w' });
  }

  invalidBlock(index) {
    this.endpointHistory.push({ index, decision: 'i' });
  }

  getHistoryIndexes() {
    return this.endpointHistory.map((v) => v.index);
  }

  getIssueIndexes() {
    return this.issueEndpoints.map((v) => v.index);
  }

  getFailedEndpoints() {
    return this.issueEndpoints.filter((v) => v.reason.startsWith('f')).map((v) => v.index);
  }

  getUnsyncdEndpoints() {
    return this.issueEndpoints.filter((v) => v.reason.startsWith('u')).map((v) => v.index);
  }

  getStaleEndpoints() {
    return this.issueEndpoints.filter((v) => v.reason.startsWith('s')).map((v) => v.index);
  }

  hasTriedEachEndpoint(subgraphName) {
    const endpoints = EnvUtil.endpointsForSubgraph(subgraphName);
    return endpoints.every((e) => this.endpointHistory.some((v) => v.index === e));
  }
}
module.exports = EndpointHistory;
