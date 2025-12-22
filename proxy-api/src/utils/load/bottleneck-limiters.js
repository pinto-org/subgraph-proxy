const { default: Bottleneck } = require('bottleneck');
const RateLimitError = require('../../error/rate-limit-error');
const EnvUtil = require('../env');

class BottleneckLimiters {
  static bottleneckLimiters = [];
  static maxPeriodicRequests = [];
  static maxReservoirSizes = [];

  // Create a limiter for each configured endpoint
  static {
    for (let i = 0; i < EnvUtil.getEndpoints().length; ++i) {
      const [rqPerInterval, interval, maxBurst] = EnvUtil.getEndpointRateLimits()[i];
      if (interval % 250 !== 0) {
        throw new Error('Invalid .env configuration: bottleneck requires rate limit interval divisible by 250.');
      }

      const limiterFactory = () =>
        new Bottleneck({
          reservoir: maxBurst,
          reservoirIncreaseAmount: rqPerInterval,
          reservoirIncreaseInterval: interval,
          reservoirIncreaseMaximum: maxBurst,
          maxConcurrent: maxBurst,
          // An ideal implementation would involve two limiters: a burst limiter and a throttle limiter.
          // The burst limiter would have no minTime as it would allow for making many concurrent requests
          // when there is initially no traffic. Not necessary to implement at this time.
          minTime: Math.ceil(interval / rqPerInterval)
        });

      let makeSubgraphLimiter;
      if (EnvUtil.getEndpointRateLimitType(i) === 'per-subgraph') {
        makeSubgraphLimiter = () => limiterFactory();
      } else {
        const lim = limiterFactory();
        makeSubgraphLimiter = () => lim;
      }

      for (const sgName of EnvUtil.subgraphsForEndpoint(i)) {
        (this.bottleneckLimiters[i] ??= {})[sgName] = makeSubgraphLimiter();
      }

      this.bottleneckLimiters.push();
      this.maxPeriodicRequests.push(rqPerInterval);
      this.maxReservoirSizes.push(maxBurst);
    }
  }

  static async wrap(endpointIndex, subgraphName, fnToWrap) {
    if (await this.isBurstDepleted(endpointIndex, subgraphName)) {
      throw new RateLimitError(`Exceeded rate limit for e-${endpointIndex}-${subgraphName}.`);
    }
    return this.bottleneckLimiters[endpointIndex][subgraphName].wrap(fnToWrap);
  }

  static async schedule(endpointIndex, subgraphName, fnToSchedule) {
    if (await this.isBurstDepleted(endpointIndex, subgraphName)) {
      throw new RateLimitError(`Exceeded rate limit for e-${endpointIndex}-${subgraphName}.`);
    }
    return await this.bottleneckLimiters[endpointIndex][subgraphName].schedule(fnToSchedule);
  }

  static async isBurstDepleted(endpointIndex, subgraphName) {
    return (await this.bottleneckLimiters[endpointIndex][subgraphName].currentReservoir()) === 0;
  }

  // Returns the utilization as a ratio of current active requests / max rq per interval.
  // Can exceed 100%
  static async getUtilization(endpointIndex, subgraphName) {
    const currentReservoir = await this.bottleneckLimiters[endpointIndex][subgraphName].currentReservoir();
    // These aren't necessarily still executing, but they are considered "active" in that they
    // were either scheduled recently or are queued to be executed.
    const activeRequests = this.maxReservoirSizes[endpointIndex] - currentReservoir;
    return activeRequests / this.maxPeriodicRequests[endpointIndex];
  }
}

module.exports = BottleneckLimiters;
