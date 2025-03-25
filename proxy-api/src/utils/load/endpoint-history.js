class EndpointHistory {
  constructor() {
    this.endpointHistory = [];
    this.issueEndpoints = [];
  }

  accepted(index) {
    this.endpointHistory.push({ index, decision: 'a' });
  }

  failed(index) {
    this.endpointHistory.push({ index, decision: 'e' });
    this.issueEndpoints.push({ index, reason: 'f' });
    this.issueEndpoints = issueEndpoints.filter((v) => v.reason !== 's');
  }

  unsyncd(index) {
    this.endpointHistory.push({ index, decision: 'u' });
    this.issueEndpoints.push({ index, reason: 'u' });
    this.issueEndpoints = issueEndpoints.filter((v) => v.reason !== 's');
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

  getHistoryIndexes() {
    return this.endpointHistory.map((v) => v.index);
  }

  getIssueIndexes() {
    return this.issueEndpoints.map((v) => v.index);
  }

  getFailedEndpoints() {
    return this.issueEndpoints.filter((v) => v.reason === 'f').map((v) => v.index);
  }

  getUnsyncdEndpoints() {
    return this.issueEndpoints.filter((v) => v.reason === 'u').map((v) => v.index);
  }

  getStaleEndpoints() {
    return this.issueEndpoints.filter((v) => v.reason === 's').map((v) => v.index);
  }
}
module.exports = EndpointHistory;
