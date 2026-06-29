import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * The sandbox layer (plan §4). The agent executes untrusted, model-generated
 * shell commands and installs arbitrary npm packages — that MUST happen in a
 * per-job, ephemeral, network-controlled isolate, torn down after sealing.
 *
 * `BuildSandbox` is the provider-neutral interface. Production should back it
 * with Vercel Sandbox (preferred) or E2B; locally we back it with a temp
 * directory on the app host. The local provider is a DEVELOPMENT-ONLY
 * convenience and is NOT a security boundary — never run a real agent build
 * through it on a public host. The provider is chosen by SINGLETAKE_SANDBOX
 * (default "local").
 */

export type SandboxExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export interface BuildSandbox {
  /** Absolute path to the build root inside the sandbox. */
  readonly root: string;
  writeFile(relPath: string, data: Buffer | string): Promise<void>;
  exec(
    cmd: string,
    args: string[],
    opts?: { timeoutMs?: number; cwd?: string; env?: Record<string, string> },
  ): Promise<SandboxExecResult>;
  readDir(relPath: string): Promise<string[]>;
  readFile(relPath: string): Promise<Buffer>;
  /** Absolute host path for a sandbox-relative path (so the seal gate can read it). */
  hostPath(relPath: string): string;
  dispose(): Promise<void>;
}

class LocalSandbox implements BuildSandbox {
  readonly root: string;
  constructor(root: string) {
    this.root = root;
  }
  private abs(rel: string): string {
    // contain everything under root — refuse to escape the build dir
    const p = path.resolve(this.root, rel);
    if (p !== this.root && !p.startsWith(this.root + path.sep)) {
      throw new Error(`sandbox path escapes root: ${rel}`);
    }
    return p;
  }
  hostPath(rel: string): string {
    return this.abs(rel);
  }
  async writeFile(rel: string, data: Buffer | string): Promise<void> {
    const p = this.abs(rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  }
  async readFile(rel: string): Promise<Buffer> {
    return fs.readFileSync(this.abs(rel));
  }
  async readDir(rel: string): Promise<string[]> {
    return fs.readdirSync(this.abs(rel));
  }
  exec(
    cmd: string,
    args: string[],
    opts: { timeoutMs?: number; cwd?: string; env?: Record<string, string> } = {},
  ): Promise<SandboxExecResult> {
    const cwd = opts.cwd ? this.abs(opts.cwd) : this.root;
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd,
        env: { ...process.env, ...opts.env },
        shell: false,
      });
      let stdout = "";
      let stderr = "";
      let done = false;
      const finish = (code: number) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(124);
      }, opts.timeoutMs ?? 10 * 60_000);
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", (e) => {
        stderr += String(e);
        finish(127);
      });
      child.on("close", (code) => finish(code ?? 0));
    });
  }
  async dispose(): Promise<void> {
    try {
      fs.rmSync(this.root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

/**
 * Create a fresh build sandbox. Today only the local provider is implemented;
 * Vercel Sandbox / E2B providers slot in here behind the same interface (plan
 * §4) and are selected via SINGLETAKE_SANDBOX.
 */
export async function createSandbox(): Promise<BuildSandbox> {
  const provider = process.env.SINGLETAKE_SANDBOX ?? "local";
  switch (provider) {
    case "local": {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "singletake-build-"));
      return new LocalSandbox(root);
    }
    // case "vercel": return createVercelSandbox();   // plan §4 (Phase 4)
    // case "e2b":    return createE2BSandbox();       // plan §4 (Phase 4)
    default:
      throw new Error(
        `unknown sandbox provider "${provider}" (set SINGLETAKE_SANDBOX=local)`,
      );
  }
}
