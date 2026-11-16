import { dependencyPlan } from "./dependencies.js";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ProjectDocument, RunCommand, RunnerStatus } from "./schema.js";
const exec = promisify(execFile);
export type { RunCommand, RunnerStatus } from "./schema.js";
export type RunOutcome = {
  exitCode: number | null;
  cleanupVerified: boolean;
  error?: string;
};
export interface Runner {
  readiness(document?: ProjectDocument): Promise<RunnerStatus>;
  execute(
    id: string,
    document: ProjectDocument,
    command: RunCommand,
    signal: AbortSignal,
    output: (text: string) => void,
  ): Promise<RunOutcome>;
  cleanup(id: string): Promise<boolean>;
}
// Constant entry point. User-controlled code is only executed inside the container.
export const BOOTSTRAP = `
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>1000000)throw new Error('Snapshot too large');}
const doc=JSON.parse(input);const root='/workspace';
for(const file of doc.files){
 if(typeof file.path!=='string'||file.path.startsWith('/')||file.path.includes('\\\\')||!file.path.split('/').every(p=>/^[a-zA-Z0-9_@.-]+$/.test(p)&&p!=='.'&&p!=='..'&&!['.git','node_modules'].includes(p.toLowerCase())))throw new Error('Invalid file path');
 const dest=path.join(root,file.path);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,file.content,{flag:'wx'});
}
const expectedLock=process.argv[2];
if(expectedLock!=='none'){
 const {createHash}=await import('node:crypto');
 const hash=(value)=>createHash('sha256').update(value).digest('hex');
 if(!/^[a-f0-9]{64}$/.test(expectedLock)||hash(await fs.readFile('/workspace/package-lock.json'))!==expectedLock||hash(await fs.readFile('/opt/sebby/package-lock.json'))!==expectedLock)throw new Error('Dependency image lockfile does not match the project');
 const modules=await fs.stat('/opt/sebby/node_modules');if(!modules.isDirectory())throw new Error('Dependency image has no node_modules tree');
 await fs.symlink('/opt/sebby/node_modules','/workspace/node_modules','dir');
}
const command=process.argv[1];if(!['build','test'].includes(command))throw new Error('Unsupported command');
const pkg=JSON.parse(await fs.readFile('/workspace/package.json','utf8'));if(typeof pkg.scripts?.[command]!=='string')throw new Error('Project has no '+command+' script');
const child=spawn('npm',['run',command],{cwd:root,stdio:'inherit',env:{PATH:process.env.PATH,HOME:'/tmp',CI:'1',npm_config_audit:'false',npm_config_fund:'false',npm_config_update_notifier:'false'}});
child.on('error',()=>process.exit(127));child.on('exit',(code)=>process.exit(code??1));
`;
export function dockerCreateArgs(id: string, image: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid run id");
  return [
    "create",
    "--name",
    `sebby-${id}`,
    "--label",
    "sebby.workspace-run=true",
    "--interactive",
    "--pull=never",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=128",
    "--memory=512m",
    "--memory-swap=512m",
    "--cpus=1",
    "--user=65532:65532",
    "--tmpfs",
    "/workspace:rw,nosuid,nodev,size=64m,uid=65532,gid=65532,mode=0700",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,noexec,size=32m,uid=65532,gid=65532,mode=0700",
    "--workdir=/workspace",
    "--entrypoint=node",
    image,
    "--input-type=module",
    "-e",
    BOOTSTRAP,
  ];
}
export class DockerRunner implements Runner {
  constructor(
    private image = process.env.SEBBY_RUNNER_IMAGE || "",
    private binary = process.env.SEBBY_DOCKER_BIN || "/usr/bin/docker",
    private catalog = process.env.SEBBY_DEPENDENCY_IMAGES || "[]",
  ) {}
  private environment() {
    // No application secrets are inherited by Docker or its container.
    return {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: "C.UTF-8",
      ...(process.env.DOCKER_HOST
        ? { DOCKER_HOST: process.env.DOCKER_HOST }
        : {}),
      ...(process.env.DOCKER_CONTEXT
        ? { DOCKER_CONTEXT: process.env.DOCKER_CONTEXT }
        : {}),
    };
  }
  private async call(args: string[]) {
    return exec(this.binary, args, {
      timeout: 15000,
      maxBuffer: 128000,
      env: this.environment(),
    });
  }
  async readiness(document?: ProjectDocument): Promise<RunnerStatus> {
    let plan;
    try {
      plan = dependencyPlan(document, this.image, this.catalog);
    } catch (e) {
      return {
        available: false,
        backend: "docker",
        reason: (e as Error).message,
      };
    }
    try {
      const info = JSON.parse(
        (await this.call(["info", "--format", "{{json .}}"])).stdout,
      );
      if (!info.SecurityOptions?.some((s: string) => s.includes("rootless")))
        return {
          available: false,
          backend: "docker",
          reason: "The runner requires rootless Docker.",
        };
      if (
        info.CgroupVersion !== "2" ||
        !info.MemoryLimit ||
        !info.SwapLimit ||
        !info.PidsLimit ||
        !info.CPUCfsQuota
      )
        return {
          available: false,
          backend: "docker",
          reason:
            "The runner requires cgroup v2 with memory, swap, PID and CPU controls.",
        };
      await this.call(["image", "inspect", plan.image]);
      return {
        available: true,
        backend: "docker",
        image: plan.image,
        lockHash: plan.lockHash,
        reason:
          "Rootless Docker and the configured image are available. Build/test runs have no network and install no dependencies.",
      };
    } catch {
      return {
        available: false,
        backend: "docker",
        reason:
          "Docker or the preloaded image is unavailable. No host execution fallback is enabled.",
      };
    }
  }
  async cleanup(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return false;
    try {
      await this.call(["rm", "--force", `sebby-${id}`]);
      return true;
    } catch (e) {
      return /No such container/.test(String((e as any).stderr || ""));
    }
  }
  async execute(
    id: string,
    document: ProjectDocument,
    command: RunCommand,
    signal: AbortSignal,
    output: (text: string) => void,
  ): Promise<RunOutcome> {
    let created = false,
      cleanupVerified = false,
      exitCode: number | null = null,
      error: string | undefined;
    let child: ReturnType<typeof spawn> | undefined;
    const stop = () => {
      void this.cleanup(id).then((ok) => {
        if (!ok) child?.kill("SIGTERM");
      });
    };
    try {
      const plan = dependencyPlan(document, this.image, this.catalog);
      const args = dockerCreateArgs(id, plan.image);
      args.push(command, plan.lockHash || "none");
      await this.call(args);
      created = true;
      if (!signal.aborted) {
        child = spawn(
          this.binary,
          ["start", "--attach", "--interactive", `sebby-${id}`],
          { env: this.environment(), stdio: ["pipe", "pipe", "pipe"] },
        );
        signal.addEventListener("abort", stop, { once: true });
        if (signal.aborted) stop();
        child.stdout!.on("data", (b: Buffer) => output(b.toString("utf8")));
        child.stderr!.on("data", (b: Buffer) => output(b.toString("utf8")));
        child.stdin!.on("error", () => {});
        child.stdin!.end(JSON.stringify(document));
        exitCode = await new Promise<number | null>((resolve, reject) => {
          child!.once("error", reject);
          child!.once("close", resolve);
        });
      }
    } catch (e) {
      error = (e as Error).message.slice(0, 1000);
    } finally {
      signal.removeEventListener("abort", stop);
      cleanupVerified = await this.cleanup(id);
    }
    // A create failure can be ambiguous even if immediate removal found nothing.
    return {
      exitCode,
      cleanupVerified: created && cleanupVerified,
      ...(error ? { error } : {}),
    };
  }
}
