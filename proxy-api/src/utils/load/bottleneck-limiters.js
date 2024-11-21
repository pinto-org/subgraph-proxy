const { default: Bottleneck } = require('bottleneck');
const RateLimitError = require('../../error/rate-limit-error');
const EnvUtil = require('../env');

class BottleneckLimiters {
  static bottleneckLimiters = [];
  static maxPeriodicRquests = [];
  static maxReservoirSizes = [];

  // Create a limiter for each configured endpoint
  static {
    for (let i = 0; i < EnvUtil.getEndpoints().length; ++i) {
      const [rqPerInterval, interval, maxBurst] = EnvUtil.getEndpointRateLimits()[i];
      if (interval % 250 !== 0) {
        throw new Error('Invalid .env configuration: bottleneck requires rate limit interval divisible by 250.');
      }

      this.bottleneckLimiters.push(
        new Bottleneck({
          reservoir: maxBurst,
          reservoirIncreaseAmount: rqPerInterval,
          reservoirIncreaseInterval: interval,
          reservoirIncreaseMaximum: maxBurst,
          maxConcurrent: maxBurst,
          minTime: Math.ceil(interval / rqPerInterval)
        })
      );
      this.maxPeriodicRquests.push(rqPerInterval);
      this.maxReservoirSizes.push(maxBurst);
    }
  }

  static async wrap(endpointIndex, fnToWrap) {
    if (await this.isBurstDepleted(endpointIndex)) {
      throw new RateLimitError(`Exceeded rate limit for e-${endpointIndex}.`);
    }
    return this.bottleneckLimiters[endpointIndex].wrap(fnToWrap);
  }

  static async schedule(endpointIndex, fnToSchedule) {
    if (await this.isBurstDepleted(endpointIndex)) {
      throw new RateLimitError(`Exceeded rate limit for e-${endpointIndex}.`);
    }
    return await this.bottleneckLimiters[endpointIndex].schedule(fnToSchedule);
  }

  static async isBurstDepleted(endpointIndex) {
    return (await this.bottleneckLimiters[endpointIndex].currentReservoir()) === 0;
  }

  // Returns the utilization as a ratio of current active requests / max rq per interval.
  // Can exceed 100%
  static async getUtilization(endpointIndex) {
    const currentReservoir = await this.bottleneckLimiters[endpointIndex].currentReservoir();
    // These aren't necessarily still executing, but they are considered "active" in that they
    // were either scheduled recently or are queued to be executed.
    const activeRequests = this.maxReservoirSizes[endpointIndex] - currentReservoir;
    return activeRequests / this.maxPeriodicRquests[endpointIndex];
  }
}

module.exports = BottleneckLimiters;
