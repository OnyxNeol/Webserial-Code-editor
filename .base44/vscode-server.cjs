// Use Microsoft's source-mode web server without launching a system browser.
const { createRequire } = require('node:module');
const path = require('node:path');
const sourceRequire = createRequire('/vscode/package.json');
const testWeb = path.dirname(sourceRequire.resolve('@vscode/test-web/package.json'));
const createApp = require(path.join(testWeb, 'out/server/app.js')).default;
(async () => {
  const app = await createApp({ build: { type: 'sources', location: '/vscode' }, printServerLog: false, coi: false, esm: true });
  if (process.env.BASE44_PREVIEW_MODE === '1') {
    // Koa otherwise renders HTTP URLs for the HTTPS preview proxy.
    app.proxy = true;
    // Normalize the known public origin before the official middleware runs.
    app.middleware.unshift(async (ctx, next) => {
      if (process.env.BASE44_PUBLIC_HOST_SUFFIX) {
        ctx.req.headers['x-forwarded-host'] = `3000-${process.env.BASE44_PUBLIC_HOST_SUFFIX}`;
        ctx.req.headers['x-forwarded-proto'] = 'https';
      }
      await next();
    });
  }
  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => console.log(`Official VS Code source-mode server listening on port ${port}`));
})().catch(error => { console.error(error); process.exit(1); });
