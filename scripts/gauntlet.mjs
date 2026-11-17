import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const stages = ['typecheck', 'test:workspace', 'test:voice', 'build', 'test:http'];
const report = { startedAt: new Date().toISOString(), status: 'running', stages: [], limits: ['No live xAI/Hermes inference or real microphone/speaker validation', 'No cloud desktop or Windows acceptance'] };
mkdirSync('.gauntlet', { recursive: true });
for (const stage of stages) {
  console.log(`\nGauntlet: ${stage}`);
  const start = Date.now();
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', stage], { stdio: 'inherit' });
  report.stages.push({ name: stage, exitCode: result.status, error: result.error?.message, milliseconds: Date.now() - start });
  if (result.status !== 0) { report.status = 'failed'; break; }
}
if (report.status === 'running') report.status = 'passed';
writeFileSync('.gauntlet/latest.json', JSON.stringify(report, null, 2));
console.log(`Gauntlet ${report.status}. Evidence: .gauntlet/latest.json`);
process.exitCode = report.status === 'passed' ? 0 : 1;
