const subgraphRoutes = require('./routes/subgraph-routes.js');

const Koa = require('koa');
const bodyParser = require('koa-bodyparser');
const cors = require('@koa/cors');

const { activateJobs } = require('./scheduled/cron-schedule.js');
const EnvUtil = require('./utils/env.js');
const InitService = require('./services/init-service.js');

async function appStartup() {
  // Activate whichever cron jobs are configured, if any
  activateJobs(EnvUtil.getEnabledCronJobs());

  await InitService.initAllStates();

  const app = new Koa();

  app.use(bodyParser());
  app.use(
    cors({
      origin: '*'
    })
  );

  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      if (!(err instanceof Error)) {
        err = new Error(err);
      }
      ctx.status = err.statusCode || err.status || 500;
      ctx.body = {
        message: err.showMessage ? err.message : 'Internal Server Error.'
      };
      // This was not anticipated, log it
      if (!err.showMessage) {
        console.log(err);
      }
    }
  });

  app.use(subgraphRoutes.routes());
  app.use(subgraphRoutes.allowedMethods());

  app.listen(3001, () => {
    console.log('Server running on port 3001');
  });
}
appStartup();

// Unhandled promise rejection handler prevents api restart under those circumstances.
// Ideally potential promise rejections are handled locally but that may not be the case.
process.on('unhandledRejection', (reason, promise) => {
  console.log('Unhandled Rejection at:', promise, 'reason:', reason);
});
