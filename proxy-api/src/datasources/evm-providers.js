const { JsonRpcProvider } = require('ethers');
const EnvUtil = require('../utils/env');

class EvmProviders {
  // Contains a provider by chain
  static providers = {};

  static {
    const pattern = /^([^:]+):(.*)$/;
    for (const rpc of EnvUtil.getEvmRpcUrls()) {
      const match = rpc.match(pattern);
      if (!match) {
        throw new Error('Invalid environment configured: rpc did not match expected format.');
      }
      const chain = match[1];
      this.providers[chain] = new JsonRpcProvider(match[2]);
    }
  }
  static providerForChain(chain) {
    return this.providers[chain];
  }
}

module.exports = EvmProviders;
