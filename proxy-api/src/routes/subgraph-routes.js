const Router = require('koa-router');
const axios = require('axios');
const SubgraphProxyService = require('../services/subgraph-proxy-service');
const EnvUtil = require('../utils/env');

const router = new Router({
  prefix: '/'
});

/**
 * Proxies the subgraph request to one of the underlying subgraph instances
 */
router.post(':subgraphName', async (ctx) => {
  const subgraphName = ctx.params.subgraphName;
  const body = ctx.request.body;

  if (subgraphName === 'cache') {
    const response = await axios.post(`${EnvUtil.getGqlCacheEndpoint()}`, {
      query: body.query,
      variables: body.variables
    });

    ctx.body = response.data;
  } else {
    const proxiedResult = await SubgraphProxyService.handleProxyRequest(subgraphName, body.query, body.variables);

    ctx.set('X-Version', proxiedResult.meta.version);
    ctx.set('X-Deployment', proxiedResult.meta.deployment);
    ctx.set('X-Chain', proxiedResult.meta.chain);
    ctx.set('X-Indexed-Block', proxiedResult.meta.indexedBlock);
    ctx.set('X-Endpoint', proxiedResult.meta.endpointIndex);

    ctx.body = { data: proxiedResult.body };
  }
});

module.exports = router;
