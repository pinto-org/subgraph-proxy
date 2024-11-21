const SubgraphProxyService = require('../src/services/subgraph-proxy-service');
const SubgraphState = require('../src/utils/state/subgraph');
const EndpointBalanceUtil = require('../src/utils/load/endpoint-balance');
const SubgraphClients = require('../src/datasources/subgraph-clients');
const ChainState = require('../src/utils/state/chain');
const RequestError = require('../src/error/request-error');
const EndpointError = require('../src/error/endpoint-error');
const { captureAndReturn } = require('./utils/capture-args');

const beanResponse = require('./mock-responses/bean.json');
const beanBehindResponse = require('./mock-responses/beanBehind.json');
const beanFarBehindResponse = require('./mock-responses/beanFarBehind.json');
const beanNewDeploymentResponse = require('./mock-responses/beanNewDeployment.json');
const beanOldVersionResponse = require('./mock-responses/beanOldVersion.json');
const RateLimitError = require('../src/error/rate-limit-error');
const EnvUtil = require('../src/utils/env');
const SubgraphStatusService = require('../src/services/subgraph-status-service');
const responseBlock = beanResponse._meta.block.number;
const responseBehindBlock = beanBehindResponse._meta.block.number;
const newDeploymentBlock = beanNewDeploymentResponse._meta.block.number;

// For capturing arguments to EndpointBalanceUtil.chooseEndpoint
let endpointArgCapture;

describe('Subgraph Proxy - Core', () => {
  beforeEach(() => {
    // Clears call history (NOT implementations)
    jest.clearAllMocks();
    jest.spyOn(SubgraphClients, 'makeCallableClient').mockReset();
    // Reset static members between test
    for (const property of Object.keys(SubgraphState)) {
      SubgraphState[property] = {};
    }
  });

  beforeAll(() => {
    jest.spyOn(ChainState, 'getChainHead').mockResolvedValue(responseBlock);
    jest.spyOn(EnvUtil, 'endpointsForSubgraph').mockReturnValue([0, 1]);
  });

  test('Can successfully update the global state', async () => {
    SubgraphState.updateStatesWithResult(0, 'bean', beanResponse, []);
    expect(SubgraphState.getEndpointBlock(0, 'bean')).toEqual(responseBlock);
    expect(SubgraphState.getEndpointChain(0, 'bean')).toEqual('ethereum');
    expect(SubgraphState.getEndpointVersion(0, 'bean')).toEqual('2.3.1');
    expect(SubgraphState.getEndpointDeployment(0, 'bean')).toEqual('QmXXZrhjqb4ygSWVgkPYBWJ7AzY4nKEUqiN5jnDopWBSCD');

    // Subgraph is behind, should not affect endpoint 0
    SubgraphState.updateStatesWithResult(0, 'bean', beanBehindResponse, []);
    expect(SubgraphState.getEndpointBlock(0, 'bean')).toEqual(responseBlock);
    SubgraphState.updateStatesWithResult(1, 'bean', beanBehindResponse, []);
    expect(SubgraphState.getEndpointBlock(1, 'bean')).toEqual(responseBehindBlock);

    SubgraphState.updateStatesWithResult(0, 'bean', beanNewDeploymentResponse, []);
    expect(SubgraphState.getEndpointBlock(0, 'bean')).toEqual(newDeploymentBlock);
    expect(SubgraphState.getEndpointVersion(0, 'bean')).toEqual('2.3.2');
  });

  describe('Core retry logic', () => {
    beforeEach(() => {
      endpointArgCapture = [];
      jest
        .spyOn(EndpointBalanceUtil, 'chooseEndpoint')
        .mockReset()
        .mockImplementationOnce((...args) => captureAndReturn(endpointArgCapture, 0, ...args))
        .mockImplementationOnce((...args) => captureAndReturn(endpointArgCapture, 1, ...args))
        .mockImplementationOnce((...args) => captureAndReturn(endpointArgCapture, -1, ...args))
        .mockImplementationOnce((...args) => captureAndReturn(endpointArgCapture, 0, ...args));
      jest.spyOn(SubgraphState, 'getLatestSubgraphErrorCheck').mockReturnValue(undefined);
      jest.spyOn(SubgraphState, 'getEndpointChain').mockReturnValue('ethereum');
    });

    test('Initial endpoint succeeds', async () => {
      jest.spyOn(SubgraphClients, 'makeCallableClient').mockResolvedValueOnce(async () => beanResponse);
      await expect(SubgraphProxyService._getQueryResult('bean', 'graphql query')).resolves.not.toThrow();

      expect(EndpointBalanceUtil.chooseEndpoint).toHaveBeenCalledTimes(1);
      expect(endpointArgCapture[0]).toEqual(['bean', [], [], null]);
    });
    test('Second endpoint succeeds', async () => {
      jest
        .spyOn(SubgraphClients, 'makeCallableClient')
        .mockImplementationOnce(async () => async () => {
          throw new Error('Generic failure reason');
        })
        .mockResolvedValueOnce(async () => beanResponse);

      await expect(SubgraphProxyService._getQueryResult('bean', 'graphql query')).resolves.not.toThrow();

      expect(EndpointBalanceUtil.chooseEndpoint).toHaveBeenCalledTimes(2);
      expect(endpointArgCapture[0]).toEqual(['bean', [], [], null]);
      expect(endpointArgCapture[1]).toEqual(['bean', [0], [0], null]);
    });
    test('Both endpoints fail - user error', async () => {
      jest
        .spyOn(SubgraphClients, 'makeCallableClient')
        .mockImplementationOnce(async () => async () => {
          throw new Error('Generic failure reason');
        })
        .mockImplementationOnce(async () => async () => {
          throw new Error('Generic failure reason');
        });
      jest.spyOn(SubgraphStatusService, 'checkFatalError').mockResolvedValue(undefined);

      await expect(SubgraphProxyService._getQueryResult('bean', 'graphql query')).rejects.toThrow(RequestError);
      expect(EndpointBalanceUtil.chooseEndpoint).toHaveBeenCalledTimes(4);
      expect(endpointArgCapture[0]).toEqual(['bean', [], [], null]);
      expect(endpointArgCapture[1]).toEqual(['bean', [0], [0], null]);
      expect(endpointArgCapture[2]).toEqual(['bean', [0, 1], [0, 1], null]);
      expect(endpointArgCapture[3]).toEqual(['bean']);
    });
    test('Both endpoints fail - endpoint error', async () => {
      jest.spyOn(SubgraphClients, 'makeCallableClient').mockImplementation(async () => async () => {
        throw new Error('Generic failure reason');
      });
      jest.spyOn(SubgraphStatusService, 'checkFatalError').mockResolvedValue('Fatal error string');

      await expect(SubgraphProxyService._getQueryResult('beanstalk', 'graphql query')).rejects.toThrow(EndpointError);
      expect(EndpointBalanceUtil.chooseEndpoint).toHaveBeenCalledTimes(4);
      expect(endpointArgCapture[0]).toEqual(['beanstalk', [], [], null]);
      expect(endpointArgCapture[1]).toEqual(['beanstalk', [0], [0], null]);
      expect(endpointArgCapture[2]).toEqual(['beanstalk', [0, 1], [0, 1], null]);
      expect(endpointArgCapture[3]).toEqual(['beanstalk']);
    });
    test('One endpoint is out of sync', async () => {
      jest
        .spyOn(SubgraphClients, 'makeCallableClient')
        .mockResolvedValueOnce(async () => beanNewDeploymentResponse)
        .mockResolvedValueOnce(async () => beanResponse);

      await expect(SubgraphProxyService._getQueryResult('bean', 'graphql query')).resolves.not.toThrow();

      expect(EndpointBalanceUtil.chooseEndpoint).toHaveBeenCalledTimes(2);
      expect(endpointArgCapture[1]).toEqual(['bean', [0], [0], null]);
    });
    test('Both endpoints are out of sync', async () => {
      jest
        .spyOn(SubgraphClients, 'makeCallableClient')
        .mockResolvedValueOnce(async () => beanNewDeploymentResponse)
        .mockResolvedValueOnce(async () => beanNewDeploymentResponse);

      await expect(SubgraphProxyService._getQueryResult('bean', 'graphql query')).rejects.toThrow(EndpointError);

      expect(EndpointBalanceUtil.chooseEndpoint).toHaveBeenCalledTimes(3);
      expect(endpointArgCapture[1]).toEqual(['bean', [0], [0], null]);
      expect(endpointArgCapture[2]).toEqual(['bean', [0, 1], [0, 1], null]);
    });
    describe('Old subgraph version is not accepted', () => {
      beforeEach(() => {
        jest
          .spyOn(EndpointBalanceUtil, 'chooseEndpoint')
          .mockReset()
          .mockImplementationOnce((...args) => captureAndReturn(endpointArgCapture, 0, ...args))
          .mockImplementationOnce((...args) => captureAndReturn(endpointArgCapture, 1, ...args))
          .mockImplementationOnce((...args) => captureAndReturn(endpointArgCapture, 0, ...args));
        // Old version will be served on endpoint 0 as 2.3.0
        SubgraphState.setEndpointBlock(1, 'bean', responseBlock);
        SubgraphState.setEndpointVersion(1, 'bean', '2.3.1');
      });
      test('Unless newer fails', async () => {
        jest
          .spyOn(SubgraphClients, 'makeCallableClient')
          .mockResolvedValueOnce(async () => beanOldVersionResponse)
          .mockImplementationOnce(async () => async () => {
            throw new Error('Generic failure reason');
          })
          .mockResolvedValueOnce(async () => beanOldVersionResponse);

        await expect(SubgraphProxyService._getQueryResult('bean', 'graphql query')).resolves.not.toThrow();
        expect(EndpointBalanceUtil.chooseEndpoint).toHaveBeenCalledTimes(3);
        expect(endpointArgCapture[1]).toEqual(['bean', [0], [0], null]);
        expect(endpointArgCapture[2]).toEqual(['bean', [1], [0, 1], null]);
      });
      test('Unless newer becomes out of sync', async () => {
        jest
          .spyOn(SubgraphClients, 'makeCallableClient')
          .mockResolvedValueOnce(async () => beanOldVersionResponse)
          .mockResolvedValueOnce(async () => beanFarBehindResponse)
          .mockResolvedValueOnce(async () => beanOldVersionResponse);

        await expect(SubgraphProxyService._getQueryResult('bean', 'graphql query')).resolves.not.toThrow();
        expect(EndpointBalanceUtil.chooseEndpoint).toHaveBeenCalledTimes(3);
        expect(endpointArgCapture[1]).toEqual(['bean', [0], [0], null]);
        expect(endpointArgCapture[2]).toEqual(['bean', [1], [0, 1], null]);
      });
    });
    test('User explicitly queries far past block', async () => {
      jest.spyOn(SubgraphClients, 'makeCallableClient').mockImplementationOnce(async () => async () => {
        throw new Error(
          `only has data starting at block number 500 and data for block number ${responseBlock + 1000} is therefore not yet available`
        );
      });

      await expect(SubgraphProxyService._getQueryResult('bean', 'graphql query')).rejects.toThrow(RequestError);
      expect(EndpointBalanceUtil.chooseEndpoint).toHaveBeenCalledTimes(1);
    });
    test('User explicitly queries far future block', async () => {
      jest.spyOn(SubgraphClients, 'makeCallableClient').mockImplementationOnce(async () => async () => {
        throw new Error(
          `has only indexed up to block number 1 and data for block number ${responseBlock + 1000} is therefore not yet available`
        );
      });

      await expect(SubgraphProxyService._getQueryResult('bean', 'graphql query')).rejects.toThrow(RequestError);
      expect(EndpointBalanceUtil.chooseEndpoint).toHaveBeenCalledTimes(1);
    });
    test('User explicitly queries current block that is indexed but temporarily unavailable', async () => {
      // Request fails the first 2 times, and succeeds on the third
      jest
        .spyOn(SubgraphClients, 'makeCallableClient')
        .mockImplementationOnce(async () => async () => {
          throw new Error(
            `has only indexed up to block number 20580123 and data for block number ${responseBlock} is therefore not yet available`
          );
        })
        .mockImplementationOnce(async () => async () => {
          throw new Error(
            `has only indexed up to block number 20580123 and data for block number ${responseBlock} is therefore not yet available`
          );
        })
        .mockResolvedValueOnce(async () => beanResponse);

      // Different logic here to prevent returning -1 on third invocation
      jest
        .spyOn(EndpointBalanceUtil, 'chooseEndpoint')
        .mockReset()
        .mockImplementationOnce((...args) => captureAndReturn(endpointArgCapture, 0, ...args))
        .mockImplementationOnce((...args) => captureAndReturn(endpointArgCapture, 1, ...args))
        .mockImplementationOnce((...args) => captureAndReturn(endpointArgCapture, 0, ...args));

      await expect(SubgraphProxyService._getQueryResult('bean', 'graphql query')).resolves.not.toThrow();
      expect(EndpointBalanceUtil.chooseEndpoint).toHaveBeenCalledTimes(3);
      expect(endpointArgCapture[1]).toEqual(['bean', [], [0], null]);
      expect(endpointArgCapture[2]).toEqual(['bean', [], [0, 1], null]);
    });
    test('Latest known indexed block is temporarily unavailable', async () => {
      jest
        .spyOn(EndpointBalanceUtil, 'chooseEndpoint')
        .mockReset()
        .mockImplementationOnce((...args) => captureAndReturn(endpointArgCapture, 0, ...args))
        .mockImplementationOnce((...args) => captureAndReturn(endpointArgCapture, 0, ...args))
        .mockImplementationOnce((...args) => captureAndReturn(endpointArgCapture, 1, ...args))
        .mockImplementationOnce((...args) => captureAndReturn(endpointArgCapture, 0, ...args));

      jest
        .spyOn(SubgraphClients, 'makeCallableClient')
        .mockResolvedValueOnce(async () => beanResponse)
        .mockResolvedValueOnce(async () => beanBehindResponse)
        .mockResolvedValueOnce(async () => beanBehindResponse)
        .mockResolvedValueOnce(async () => beanResponse);
      // Initial query that gets the latest block successfully
      await expect(SubgraphProxyService._getQueryResult('bean', 'graphql query')).resolves.not.toThrow();
      expect(EndpointBalanceUtil.chooseEndpoint).toHaveBeenCalledTimes(1);

      // Second query that fails to get the latest block on first 2 attempts
      await expect(SubgraphProxyService._getQueryResult('bean', 'graphql query')).resolves.not.toThrow();
      expect(EndpointBalanceUtil.chooseEndpoint).toHaveBeenCalledTimes(4);
      expect(endpointArgCapture[2]).toEqual(['bean', [], [0], null]);
      expect(endpointArgCapture[3]).toEqual(['bean', [], [0, 1], null]);
    });
  });

  test('No endpoints are available', async () => {
    // The initial request is rejected, no endpoints are available to service this request
    jest.spyOn(EndpointBalanceUtil, 'chooseEndpoint').mockReturnValueOnce(-1);

    await expect(SubgraphProxyService._getQueryResult('bean', 'graphql query')).rejects.toThrow(RateLimitError);
  });
});
