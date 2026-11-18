import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
// The email form is a local development identity picker, never production authentication.
const child = spawn(process.execPath, ['--env-file-if-exists=.env.local', 'server/dist/workspace-server.js'], {
  stdio: 'inherit', env: { ...process.env, SEBBY_WORKSPACE_ONLY: '1', DEV_LOGIN: '1', SESSION_SECRET: process.env.SESSION_SECRET || randomBytes(32).toString('hex'), APP_URL: `http://127.0.0.1:${process.env.PORT || 8787}` },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
