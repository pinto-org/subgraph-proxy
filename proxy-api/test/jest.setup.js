// Disable env. Mock entire module so the validations do not execute
jest.mock('../src/utils/env', () => {
  return {
    throwOnInvalidName: jest.fn(),
    underlyingUrl: jest.fn(),
    endpointsForSubgraph: jest.fn(),
    getEndpoints: jest.fn(),
    getEndpointRateLimits: jest.fn(),
    getEndpointUtilizationPreference: jest.fn(),
    getEnabledSubgraphs: jest.fn(),
    getEndpointSgIds: jest.fn(),
    getEvmRpcUrls: jest.fn(),
    allowUnsyncd: jest.fn().mockReturnValue(false)
  };
});
// Disable bottleneck limiters. Mock entire module so the static initializer does not execute
jest.mock('../src/utils/load/bottleneck-limiters', () => {
  return {
    isBurstDepleted: jest.fn(),
    getUtilization: jest.fn()
  };
});
// Disable evm providers. Mock entire module so the static initializer does not execute
jest.mock('../src/datasources/evm-providers', () => {
  return {};
});
// Disables any discord messaging
jest.mock('../src/utils/discord');
// Disable LoggingUtil logs
jest.mock('../src/utils/logging');
