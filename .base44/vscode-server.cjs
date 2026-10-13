// Use Microsoft's source-mode web server without launching a system browser.
const { createRequire } = require('node:module');
const path = require('node:path');
const crypto = require('node:crypto');
const sourceRequire = createRequire('/vscode/package.json');
const testWeb = path.dirname(sourceRequire.resolve('@vscode/test-web/package.json'));
const createApp = require(path.join(testWeb, 'out/server/app.js')).default;

// Inline scripts in the test-web HTML template have no nonces, which violates
// the preview proxy's CSP. We intercept HTML responses and replace inline
// <script> blocks with external <script src> tags served from /inline-scripts/.
const inlineScriptCache = new Map(); // hash -> script content

function extractInlineScripts(html) {
  return html.replace(/<script(?!\s+src)(?!\s+type=["']importmap["'])>([\s\S]*?)<\/script>/g, (match, content) => {
    const trimmed = content.trim();
    if (!trimmed) return match; // keep empty scripts as-is (harmless)
    const hash = crypto.createHash('sha256').update(trimmed).digest('hex').slice(0, 16);
    inlineScriptCache.set(hash, trimmed);
    return `<script src="/inline-scripts/${hash}.js"></script>`;
  });
}

(async () => {
  const app = await createApp({ build: { type: 'sources', location: '/vscode' }, printServerLog: false, coi: false, esm: true });

  if (process.env.BASE44_PREVIEW_MODE === '1') {
    app.proxy = true;
    // Single middleware that runs before all existing middleware (router, static, etc.)
    app.middleware.unshift(async (ctx, next) => {
      // 1. Serve extracted inline scripts as external JS files.
      if (ctx.path.startsWith('/inline-scripts/') && ctx.path.endsWith('.js')) {
        const hash = ctx.path.split('/').pop().replace('.js', '');
        const content = inlineScriptCache.get(hash);
        if (content) {
          ctx.set('Content-Type', 'application/javascript');
          ctx.set('Cache-Control', 'no-store');
          ctx.body = content;
          return;
        }
      }

      // 2. Normalize the origin for the HTTPS preview proxy.
      if (process.env.BASE44_PUBLIC_HOST_SUFFIX) {
        ctx.req.headers['x-forwarded-host'] = `3000-${process.env.BASE44_PUBLIC_HOST_SUFFIX}`;
        ctx.req.headers['x-forwarded-proto'] = 'https';
      }

      // 3. Run all existing middleware (workbench router, static files, etc.)
      await next();

      // 4. After the response is generated, extract inline scripts from HTML.
      const ct = ctx.type || '';
      if (ct.includes('html') && typeof ctx.body === 'string' && ctx.body.includes('<script>')) {
        ctx.body = extractInlineScripts(ctx.body);
      }
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => console.log(`Official VS Code source-mode server listening on port ${port}`));
})().catch(error => { console.error(error); process.exit(1); });
