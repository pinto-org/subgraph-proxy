const RequestError = require('../error/request-error');
require('dotenv').config();

// Need to replace "<sg>" with the name/id of the subgraph to use
const ENDPOINTS = process.env.ENDPOINTS?.split('|');
const ENDPOINT_TYPES = process.env.ENDPOINT_TYPES?.split('|');
const ENDPOINT_RATE_LIMITS = process.env.ENDPOINT_RATE_LIMITS?.split('|').map((sg) =>
  sg.split(',').map((s) => parseInt(s))
);
const ENDPOINT_UTILIZATION_PREFERENCE = process.env.ENDPOINT_UTILIZATION_PREFERENCE?.split('|').map((s) =>
  parseFloat(s)
);
const ENABLED_SUBGRAPHS = process.env.ENABLED_SUBGRAPHS?.split(',');
const ENDPOINT_SG_IDS = process.env.ENDPOINT_SG_IDS?.split('|').map((sg) => sg.split(','));
const EVM_RPC_URLS = process.env.EVM_RPC_URLS?.split(',');

const ENABLED_CRON_JOBS = process.env.ENABLED_CRON_JOBS?.split(',');

// Validation
for (const endpointIds of ENDPOINT_SG_IDS) {
  if (endpointIds.length !== ENABLED_SUBGRAPHS.length) {
    throw new Error('Invalid environment configured: underlying subgraph ids could not pair with enabled subgraphs.');
  }
}

if (ENDPOINTS.length !== ENDPOINT_RATE_LIMITS.length || ENDPOINTS.length !== ENDPOINT_UTILIZATION_PREFERENCE.length) {
  throw new Error('Invalid environment configured: endpoin configuration incomplete');
}

if (ENDPOINT_UTILIZATION_PREFERENCE.some((u) => u < 0 || u > 1)) {
  throw new Error('Invalid environment configured: utilization out of range');
}

class EnvUtil {
  static throwOnInvalidName(subgraphName) {
    if (!ENABLED_SUBGRAPHS.includes(subgraphName)) {
      throw new RequestError(`Subgraph name '${subgraphName}' is not configured for use in this gateway.`);
    }
  }

  static underlyingUrl(endpointIndex, subgraphName) {
    if (!ENDPOINTS[endpointIndex]) {
      throw new Error(`Unsupported endpoint: ${endpointIndex}`);
    }
    const subgraphIndex = ENABLED_SUBGRAPHS.indexOf(subgraphName);
    if (subgraphIndex === -1) {
      throw new Error(`Unsupported subgraph: ${subgraphName}`);
    }
    return ENDPOINTS[endpointIndex].replace('<sg-id>', ENDPOINT_SG_IDS[endpointIndex][subgraphIndex]);
  }

  static endpointsForSubgraph(subgraphName) {
    const subgraphIndex = ENABLED_SUBGRAPHS.indexOf(subgraphName);
    const validIndices = [];
    for (let i = 0; i < ENDPOINTS.length; ++i) {
      if (ENDPOINT_SG_IDS[i][subgraphIndex]?.trim()) {
        validIndices.push(i);
      }
    }
    return validIndices;
  }

  static subgraphsForEndpoint(endpointIndex) {
    const subgraphNames = [];
    for (let i = 0; i < ENDPOINT_SG_IDS[endpointIndex].length; ++i) {
      if (ENDPOINT_SG_IDS[endpointIndex][i]?.trim()) {
        subgraphNames.push(ENABLED_SUBGRAPHS[i]);
      }
    }
    return subgraphNames;
  }

  // Getters for actual env values
  static getEndpoints() {
    return ENDPOINTS;
  }

  static getEndpointTypes() {
    return ENDPOINT_TYPES;
  }

  static getEndpointRateLimits() {
    return ENDPOINT_RATE_LIMITS;
  }

  static getEndpointUtilizationPreference() {
    return ENDPOINT_UTILIZATION_PREFERENCE;
  }

  static getEnabledSubgraphs() {
    return ENABLED_SUBGRAPHS;
  }

  static getEndpointSgIds() {
    return ENDPOINT_SG_IDS;
  }

  static getEvmRpcUrls() {
    return EVM_RPC_URLS;
  }

  static getEnabledCronJobs() {
    return ENABLED_CRON_JOBS?.filter((s) => s.length > 0) ?? [];
  }

  static getStatusCheckMaxUtilization() {
    return parseFloat(process.env?.STATUS_CHECK_MAX_UTILIZATION ?? '0');
  }

  static allowUnsyncd() {
    return process.env?.ALLOW_UNSYNCD === 'true';
  }
}

module.exports = EnvUtil;
