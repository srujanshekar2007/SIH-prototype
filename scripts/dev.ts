import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const children: ChildProcess[] = [];
const tsxCli = resolve(root, 'node_modules/tsx/dist/cli.mjs');
const viteCli = resolve(root, 'node_modules/vite/bin/vite.js');

children.push(spawn(process.execPath, [tsxCli, 'server/index.ts'], { cwd: root, stdio: 'inherit' }));
children.push(spawn(process.execPath, [viteCli, '--host', '127.0.0.1'], { cwd: root, stdio: 'inherit' }));

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  process.exitCode = code;
}

for (const child of children) {
  child.on('error', (error) => { console.error(error.message); shutdown(1); });
  child.on('exit', (code) => { if (!shuttingDown) shutdown(code || 0); });
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
