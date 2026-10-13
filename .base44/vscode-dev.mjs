// Run the official web bundler and rebuild from live source on changes.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { copyFileSync } from 'node:fs';
copyFileSync('/vscode/node_modules/@vscode/codicons/dist/codicon.ttf', '/vscode/src/vs/base/browser/ui/codicons/codicon/codicon.ttf');
const require = createRequire('/vscode/package.json');
const chokidar = require('chokidar');
let building = false;
let pending = false;
async function build() {
  if (building) { pending = true; return; }
  building = true;
  do {
    pending = false;
    await new Promise((resolve, reject) => {
      const child = spawn('node', ['build/next/index.ts', 'bundle', '--target', 'web', '--out', 'out'], { cwd: '/vscode', stdio: 'inherit' });
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Official web build exited with ${code}`)));
    });
  } while (pending);
  building = false;
}
await build();
const server = spawn('node', ['/base44/vscode-server.cjs'], { cwd: '/vscode', stdio: 'inherit' });
server.on('exit', code => process.exit(code ?? 1));
const watcher = chokidar.watch(['/vscode/src', '/vscode/product.json'], { ignoreInitial: true, usePolling: true, interval: 1000, awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 } });
watcher.on('all', () => build().catch(error => { console.error(error); server.kill(); process.exit(1); }));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { server.kill(signal); watcher.close(); process.exit(0); });
}
