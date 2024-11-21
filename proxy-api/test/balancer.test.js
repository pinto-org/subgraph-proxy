const EndpointBalanceUtil = require('../src/utils/load/endpoint-balance');
const ChainState = require('../src/utils/state/chain');
const SubgraphState = require('../src/utils/state/subgraph');
const EnvUtil = require('../src/utils/env');
const BottleneckLimiters = require('../src/utils/load/bottleneck-limiters');

const mockTimeNow = new Date(1700938811 * 1000);
const mockTimePrev = new Date(1680938811 * 1000);
const mockTimeFuture = new Date(1710938811 * 1000);

/** Tests according to the strategy description on EndpointBalanceUtil.chooseEndpoint method. **/

const mockEndpointErrors = (index, value) => {
  jest.spyOn(SubgraphState, 'endpointHasErrors').mockImplementation((endpointIndex, _) => {
    return endpointIndex === index ? value : !value;
  });
  jest.spyOn(SubgraphState, 'getLastEndpointErrorTimestamp').mockImplementation((endpointIndex, _) => {
    return endpointIndex === index ? mockTimeNow : undefined;
  });
};

const mockEndpointOutOfSync = (index, value) => {
  jest.spyOn(SubgraphState, 'isInSync').mockImplementation((endpointIndex, _) => {
    return endpointIndex === index ? !value : value;
  });
  jest.spyOn(SubgraphState, 'getLastEndpointOutOfSyncTimestamp').mockImplementation((endpointIndex, _) => {
    return endpointIndex === index ? mockTimeNow : undefined;
  });
};

const mockEndpointOnStaleVersion = (index, value) => {
  jest.spyOn(SubgraphState, 'isStaleVersion').mockImplementation((endpointIndex, _) => {
    return endpointIndex === index ? value : !value;
  });
  jest.spyOn(SubgraphState, 'getLastEndpointStaleVersionTimestamp').mockImplementation((endpointIndex, _) => {
    return endpointIndex === index ? mockTimeNow : undefined;
  });
};

describe('Endpoint Balancer', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(EnvUtil, 'endpointsForSubgraph').mockReturnValue([0, 1]);
    jest.spyOn(EnvUtil, 'getEndpointUtilizationPreference').mockReturnValue([0.8, 0.8]);

    jest.spyOn(ChainState, 'getChainHead').mockResolvedValue(500);
    jest.spyOn(SubgraphState, 'endpointHasErrors').mockReturnValue(false);
    jest.spyOn(SubgraphState, 'isInSync').mockReturnValue(true);
    jest.spyOn(SubgraphState, 'getEndpointDeployment').mockReturnValue('abc');
    jest.spyOn(SubgraphState, 'getEndpointVersion').mockReturnValue('1.0.0');
    jest.spyOn(SubgraphState, 'getLatestVersion').mockReturnValue('1.0.0');
    jest.spyOn(SubgraphState, 'getEndpointBlock').mockReturnValue(500);
    jest.spyOn(SubgraphState, 'getLatestBlock').mockReturnValue(500);
    // Prevents triggering the associated condition in the average case
    jest.spyOn(SubgraphState, 'getLastEndpointSelectedTimestamp').mockReturnValue(mockTimeFuture);

    // Current utilization
    jest.spyOn(BottleneckLimiters, 'isBurstDepleted').mockReturnValue(false);
    jest.spyOn(BottleneckLimiters, 'getUtilization').mockReturnValue(0.2);

    jest.useFakeTimers();
    jest.setSystemTime(mockTimeNow);
  });

  test('Blacklisted endpoints are not selected', async () => {
    const blacklist = [];
    const choice1 = await EndpointBalanceUtil.chooseEndpoint('bean', blacklist);
    expect(choice1).not.toEqual(-1);
    expect(blacklist).not.toContain(choice1);

    blacklist.push(0);
    const choice2 = await EndpointBalanceUtil.chooseEndpoint('bean', blacklist);
    expect(choice2).not.toEqual(-1);
    expect(choice2).not.toEqual(choice1);
    expect(blacklist).not.toContain(choice2);

    blacklist.push(1);
    expect(await EndpointBalanceUtil.chooseEndpoint('bean', blacklist)).toEqual(-1);
  });

  describe('Prefers to avoid troublesome endpoints', () => {
    test('Endpoints with errors are not considered unless time elapsed', async () => {
      mockEndpointErrors(0, true);
      const choice1 = await EndpointBalanceUtil.chooseEndpoint('bean');
      expect(choice1).toEqual(1);

      jest.setSystemTime(mockTimeFuture);
      const choice2 = await EndpointBalanceUtil.chooseEndpoint('bean');
      expect(choice2).toEqual(0);
    });

    test('Endpoints out of sync are not considered unless time elapsed', async () => {
      mockEndpointOutOfSync(0, true);
      const choice1 = await EndpointBalanceUtil.chooseEndpoint('bean');
      expect(choice1).toEqual(1);

      jest.setSystemTime(mockTimeFuture);
      const choice2 = await EndpointBalanceUtil.chooseEndpoint('bean');
      expect(choice2).toEqual(0);
    });

    test('Endpoints on older version are not considered unless time elapsed', async () => {
      mockEndpointOnStaleVersion(0, true);
      const choice1 = await EndpointBalanceUtil.chooseEndpoint('bean');
      expect(choice1).toEqual(1);

      jest.setSystemTime(mockTimeFuture);
      const choice2 = await EndpointBalanceUtil.chooseEndpoint('bean');
      expect(choice2).toEqual(0);
    });

    test('Endpoints with recent errors can be considered if recovered', async () => {
      mockEndpointErrors(0, true);
      const choice1 = await EndpointBalanceUtil.chooseEndpoint('bean');
      expect(choice1).toEqual(1);

      mockEndpointErrors(0, false);
      const choice2 = await EndpointBalanceUtil.chooseEndpoint('bean');
      expect(choice2).toEqual(0);
    });

    test('Endpoints out of sync recently can be considered if recovered', async () => {
      mockEndpointOutOfSync(0, true);
      const choice1 = await EndpointBalanceUtil.chooseEndpoint('bean');
      expect(choice1).toEqual(1);

      mockEndpointOutOfSync(0, false);
      const choice2 = await EndpointBalanceUtil.chooseEndpoint('bean');
      expect(choice2).toEqual(0);
    });

    test('Endpoints recently on older version can be considered if recovered', async () => {
      mockEndpointOnStaleVersion(0, true);
      const choice1 = await EndpointBalanceUtil.chooseEndpoint('bean');
      expect(choice1).toEqual(1);

      mockEndpointOnStaleVersion(0, false);
      const choice2 = await EndpointBalanceUtil.chooseEndpoint('bean');
      expect(choice2).toEqual(0);
    });
  });

  describe('<100% utilized', () => {
    test('Endpoint under utilization preference cap is preferred', async () => {
      jest.spyOn(BottleneckLimiters, 'getUtilization').mockResolvedValue(0.5);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(0);

      jest.spyOn(BottleneckLimiters, 'getUtilization').mockImplementation((endpointIndex) => {
        return endpointIndex === 0 ? 0.95 : 0.4;
      });
      expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(1);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean', [1])).toEqual(0);
    });

    test('Both above preference cap, underutilized endpoint is chosen', async () => {
      jest.spyOn(BottleneckLimiters, 'getUtilization').mockImplementation((endpointIndex) => {
        return endpointIndex === 0 ? 0.82 : 0.85;
      });
      expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(0);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean', [0])).toEqual(1);

      jest.spyOn(BottleneckLimiters, 'getUtilization').mockImplementation((endpointIndex) => {
        return endpointIndex === 0 ? 0.88 : 0.85;
      });
      expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(1);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean', [1])).toEqual(0);
    });

    test('Endpoint with latest block result is chosen', async () => {
      jest.spyOn(BottleneckLimiters, 'getUtilization').mockImplementation((endpointIndex) => {
        return endpointIndex === 0 ? 0.52 : 0.2;
      });
      jest.spyOn(SubgraphState, 'getEndpointBlock').mockImplementation((endpointIndex, _) => {
        return endpointIndex === 0 ? 499 : 500;
      });
      jest.spyOn(SubgraphState, 'getLastEndpointResultTimestamp').mockReturnValue(mockTimeNow);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(1);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean', [1])).toEqual(0);

      // Same should occur even if utilization preference is exceeded (but not >100%)
      jest.spyOn(BottleneckLimiters, 'getUtilization').mockImplementation((endpointIndex) => {
        return endpointIndex === 0 ? 0.52 : 0.9;
      });
      expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(1);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean', [1])).toEqual(0);

      jest.spyOn(BottleneckLimiters, 'getUtilization').mockImplementation((endpointIndex) => {
        return endpointIndex === 0 ? 0.52 : 1.5;
      });
      expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(0);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean', [0])).toEqual(1);
    });

    describe('Endpoint with no recent result is chosen on that basis', () => {
      beforeEach(() => {
        jest.spyOn(BottleneckLimiters, 'getUtilization').mockImplementation((endpointIndex) => {
          return endpointIndex === 0 ? 0.1 : 0;
        });
        jest.spyOn(SubgraphState, 'getLastEndpointSelectedTimestamp').mockImplementation((endpointIndex, _) => {
          return endpointIndex === 0 ? mockTimeNow : mockTimePrev;
        });
      });
      test('Non-recent endpoint is chosen', async () => {
        expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(1);
      });
      test('Not chosen due to fatal errors', async () => {
        jest.spyOn(SubgraphState, 'endpointHasFatalErrors').mockImplementation((endpointIndex, _) => {
          return endpointIndex === 1;
        });
        expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(0);
        expect(await EndpointBalanceUtil.chooseEndpoint('bean', [0])).toEqual(1);
      });
      test('Not chosen due to recent errors', async () => {
        mockEndpointErrors(1, true);
        expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(0);
        expect(await EndpointBalanceUtil.chooseEndpoint('bean', [0])).toEqual(1);
      });
      test('Not chosen due to out of sync', async () => {
        mockEndpointOutOfSync(1, true);
        expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(0);
        expect(await EndpointBalanceUtil.chooseEndpoint('bean', [0])).toEqual(1);
      });
      test('Not chosen due to stale version', async () => {
        mockEndpointOnStaleVersion(1, true);
        expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(0);
        expect(await EndpointBalanceUtil.chooseEndpoint('bean', [0])).toEqual(1);
      });
    });

    describe('Retry latest history endpoint', () => {
      beforeEach(() => {
        jest.spyOn(SubgraphState, 'getEndpointBlock').mockImplementation((endpointIndex, _) => {
          return endpointIndex === 0 ? 500 : 499;
        });
      });

      test('No explicit query block', async () => {
        // Requeried
        expect(await EndpointBalanceUtil.chooseEndpoint('bean', [], [0])).toEqual(0);
        expect(await EndpointBalanceUtil.chooseEndpoint('bean', [0], [0])).toEqual(1);
        // Not requeried
        expect(await EndpointBalanceUtil.chooseEndpoint('bean', [], [1])).toEqual(0);
        expect(await EndpointBalanceUtil.chooseEndpoint('bean', [0], [1])).toEqual(1);
      });

      test('Explicit query block', async () => {
        // Requeried
        expect(await EndpointBalanceUtil.chooseEndpoint('bean', [], [0], 500)).toEqual(0);
        expect(await EndpointBalanceUtil.chooseEndpoint('bean', [0], [0], 500)).toEqual(1);
        // Not requeried
        expect(await EndpointBalanceUtil.chooseEndpoint('bean', [], [1], 500)).toEqual(0);
        expect(await EndpointBalanceUtil.chooseEndpoint('bean', [0], [1], 500)).toEqual(1);
        expect(await EndpointBalanceUtil.chooseEndpoint('bean', [], [0], 501)).toEqual(1);
        expect(await EndpointBalanceUtil.chooseEndpoint('bean', [], [0, 1], 501)).toEqual(0);
        expect(await EndpointBalanceUtil.chooseEndpoint('bean', [0], [0, 1], 501)).toEqual(1);
      });
    });
  });

  describe('>=100% utilized', () => {
    test('Lesser utilized endpoint is chosen', async () => {
      jest.spyOn(EndpointBalanceUtil, 'getSubgraphUtilization').mockResolvedValue({ 0: 2.5, 1: 6 });
      expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(0);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean', [0])).toEqual(1);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean', [1])).toEqual(0);

      jest.spyOn(EndpointBalanceUtil, 'getSubgraphUtilization').mockResolvedValue({ 0: 8, 1: 1.5 });
      expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(1);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean', [0])).toEqual(1);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean', [1])).toEqual(0);
    });

    test('No endpoint can be chosen', async () => {
      jest.spyOn(BottleneckLimiters, 'isBurstDepleted').mockReturnValue(true);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(-1);

      jest.spyOn(BottleneckLimiters, 'isBurstDepleted').mockImplementation((endpointIndex) => {
        return endpointIndex === 0;
      });
      expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(1);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean', [1])).toEqual(-1);
    });

    test('Utilization taking precedence over block conditions', async () => {
      jest.spyOn(SubgraphState, 'getEndpointBlock').mockImplementation((endpointIndex, _) => {
        return endpointIndex === 0 ? 500 : 499;
      });
      jest.spyOn(EndpointBalanceUtil, 'getSubgraphUtilization').mockResolvedValue({ 0: 5, 1: 2 });
      // History
      expect(await EndpointBalanceUtil.chooseEndpoint('bean', [], [0])).toEqual(1);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean', [], [1], 500)).toEqual(1);
      // Both having recent results
      jest.spyOn(SubgraphState, 'getLastEndpointResultTimestamp').mockReturnValue(mockTimeNow);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(1);
    });
  });

  describe('Last resort selections', () => {
    test('Chooses endpoint with errors if all remaining endpoints have recent errors', async () => {
      mockEndpointErrors(0, true);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(1);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean', [1])).toEqual(0);
    });
    test('Chooses endpoint out of sync if all remaining endpoints are recently out of sync', async () => {
      mockEndpointOutOfSync(0, true);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(1);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean', [1])).toEqual(0);
    });
    test('Chooses endpoint on older version if all remaining endpoints are recently on older version', async () => {
      mockEndpointOnStaleVersion(0, true);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean')).toEqual(1);
      expect(await EndpointBalanceUtil.chooseEndpoint('bean', [1])).toEqual(0);
    });
  });
});
