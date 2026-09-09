import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Completion, CompletionResult } from "@speak-human/core";

export type LoopbackConfig = { url: string; model: string; timeoutMs?: number };
export type CommandConfig = {
  executable: string;
  args?: string[];
  env?: string[];
  timeoutMs?: number;
  allowRemoteSource: true;
};
const OUTPUT_LIMIT = 32 * 1024;

export function validateLoopbackUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("loopback-url-invalid");
  }
  if (
    !/^https?:$/.test(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("loopback-url-invalid");
  return url;
}
function timeoutSignal(
  signal: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    },
  };
}
export function isLoopbackConfig(value: unknown): value is LoopbackConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Record<string, unknown>;
  if (
    !hasOnly(config, ["url", "model", "timeoutMs"]) ||
    typeof config.url !== "string" ||
    typeof config.model !== "string" ||
    !config.model.trim() ||
    (config.timeoutMs !== undefined &&
      (typeof config.timeoutMs !== "number" ||
        !Number.isSafeInteger(config.timeoutMs) ||
        config.timeoutMs < 1))
  )
    return false;
  try {
    validateLoopbackUrl(config.url);
    return true;
  } catch {
    return false;
  }
}
export function loopbackCompletion(config: LoopbackConfig): Completion {
  if (!isLoopbackConfig(config)) throw new Error("loopback-config-invalid");
  const url = validateLoopbackUrl(config.url);
  return async (prompt, signal) => {
    if (signal.aborted) throw new Error("loopback-aborted");
    const operation = timeoutSignal(signal, config.timeoutMs ?? 10_000);
    try {
      if (operation.signal.aborted) throw new Error("loopback-aborted");
      const response = await fetch(new URL("/v1/chat/completions", url), {
        method: "POST",
        redirect: "error",
        signal: operation.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          temperature: 0,
          max_tokens: 2048,
          stop: ["</REWRITE>"],
        }),
      });
      if (!response.ok || !response.body) throw new Error("loopback-failed");
      const reader = response.body.getReader();
      let bytes = new Uint8Array();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        if (bytes.length + next.value.length > OUTPUT_LIMIT)
          throw new Error("loopback-overflow");
        const combined = new Uint8Array(bytes.length + next.value.length);
        combined.set(bytes);
        combined.set(next.value, bytes.length);
        bytes = combined;
      }
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const body: unknown = JSON.parse(decoded);
      if (!isCompletionResponse(body)) throw new Error("loopback-invalid");
      const choice = body.choices[0]!;
      return {
        text: choice.message.content,
        ...(body.model
          ? { route: { provider: "loopback", model: body.model } }
          : {}),
        ...(body.usage
          ? {
              usage: {
                ...(body.usage.prompt_tokens !== undefined
                  ? { input: body.usage.prompt_tokens }
                  : {}),
                ...(body.usage.completion_tokens !== undefined
                  ? { output: body.usage.completion_tokens }
                  : {}),
              },
            }
          : {}),
      };
    } finally {
      operation.dispose();
    }
  };
}
type CompletionResponse = {
  choices: [{ message: { content: string } }];
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};
function isCompletionResponse(value: unknown): value is CompletionResponse {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.choices) || body.choices.length !== 1) return false;
  const choice = body.choices[0];
  if (!choice || typeof choice !== "object") return false;
  const message = (choice as { message?: unknown }).message;
  if (
    !message ||
    typeof message !== "object" ||
    typeof (message as { content?: unknown }).content !== "string"
  )
    return false;
  if (
    body.model !== undefined &&
    (typeof body.model !== "string" || !body.model.trim())
  )
    return false;
  if (body.usage === undefined) return true;
  if (!body.usage || typeof body.usage !== "object") return false;
  const usage = body.usage as Record<string, unknown>;
  return ["prompt_tokens", "completion_tokens", "total_tokens"].every(
    (key) =>
      usage[key] === undefined ||
      (typeof usage[key] === "number" &&
        Number.isFinite(usage[key]) &&
        usage[key] >= 0),
  );
}
function hasOnly(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function validUsage(value: unknown, keys: readonly string[]): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    hasOnly(value as Record<string, unknown>, keys) &&
    Object.values(value as Record<string, unknown>).every(
      (item) => typeof item === "number" && Number.isFinite(item) && item >= 0,
    )
  );
}
export function isCommandConfig(value: unknown): value is CommandConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Record<string, unknown>;
  return (
    hasOnly(config, [
      "executable",
      "args",
      "env",
      "timeoutMs",
      "allowRemoteSource",
    ]) &&
    config.allowRemoteSource === true &&
    typeof config.executable === "string" &&
    config.executable.startsWith("/") &&
    (config.args === undefined ||
      (Array.isArray(config.args) &&
        config.args.every(
          (item) => typeof item === "string" && !item.includes("\0"),
        ))) &&
    (config.env === undefined ||
      (Array.isArray(config.env) &&
        config.env.every(
          (name) =>
            typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name),
        ))) &&
    (config.timeoutMs === undefined ||
      (typeof config.timeoutMs === "number" &&
        Number.isSafeInteger(config.timeoutMs) &&
        config.timeoutMs > 0))
  );
}
export function commandCompletion(config: CommandConfig): Completion {
  if (process.platform === "win32")
    throw new Error("command-platform-unsupported");
  if (!isCommandConfig(config)) throw new Error("command-config-invalid");
  return async (prompt, signal) => {
    if (signal.aborted) throw new Error("command-aborted");
    const cwd = await mkdtemp(join(tmpdir(), "speak-human-"));
    const environment: Record<string, string> = {};
    for (const name of config.env ?? []) {
      const value = process.env[name];
      if (value !== undefined) environment[name] = value;
    }
    try {
      return await new Promise<CompletionResult>((resolve, reject) => {
        if (signal.aborted) {
          reject(new Error("command-aborted"));
          return;
        }
        const child = spawn(config.executable, config.args ?? [], {
          cwd,
          env: environment,
          detached: process.platform !== "win32",
          stdio: ["pipe", "pipe", "ignore"],
        });
        let output = Buffer.alloc(0);
        let settled = false;
        const terminate = async (): Promise<void> => {
          const alreadyClosed = child.exitCode !== null;
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {
            /* process group already exited */
          }
          if (!alreadyClosed)
            await new Promise<void>((done) =>
              child.once("close", () => done()),
            );
        };
        const finish = (error?: Error, result?: CompletionResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          void terminate().then(() =>
            error ? reject(error) : resolve(result!),
          );
        };
        const abort = () => finish(new Error("command-aborted"));
        const timer = setTimeout(
          () => finish(new Error("command-timeout")),
          config.timeoutMs ?? 10_000,
        );
        signal.addEventListener("abort", abort, { once: true });
        child.stdout.on("data", (chunk: Buffer) => {
          output = Buffer.concat([output, chunk]);
          if (output.length > OUTPUT_LIMIT)
            finish(new Error("command-overflow"));
        });
        child.on("error", () => finish(new Error("command-failed")));
        child.stdin.on("error", () =>
          finish(new Error("command-stdin-failed")),
        );
        child.on("close", (code) => {
          if (settled) return;
          if (code !== 0) return finish(new Error("command-failed"));
          try {
            const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
              output,
            );
            const parsed: unknown = JSON.parse(decoded);
            if (!isCommandResponse(parsed)) throw new Error("command-invalid");
            finish(undefined, {
              text: parsed.completion,
              ...(parsed.route ? { route: parsed.route } : {}),
              ...(parsed.usage ? { usage: parsed.usage } : {}),
            });
          } catch {
            finish(new Error("command-invalid"));
          }
        });
        child.stdin.end(
          JSON.stringify({
            schema_version: 1,
            prompt: `${prompt.system}\n\n${prompt.user}`,
          }),
        );
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  };
}
type CommandResponse = {
  schema_version: 1;
  completion: string;
  route?: { provider: string; model: string };
  usage?: { input?: number; output?: number; cost?: number };
};
function isCommandResponse(value: unknown): value is CommandResponse {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  if (body.schema_version !== 1 || typeof body.completion !== "string")
    return false;
  const allowed = new Set(["schema_version", "completion", "route", "usage"]);
  if (!Object.keys(body).every((key) => allowed.has(key))) return false;
  if (
    body.route !== undefined &&
    (!body.route ||
      typeof body.route !== "object" ||
      !hasOnly(body.route as Record<string, unknown>, ["provider", "model"]) ||
      typeof (body.route as { provider?: unknown }).provider !== "string" ||
      !(body.route as { provider: string }).provider.trim() ||
      typeof (body.route as { model?: unknown }).model !== "string" ||
      !(body.route as { model: string }).model.trim())
  )
    return false;
  if (
    body.usage !== undefined &&
    !validUsage(body.usage, ["input", "output", "cost"])
  )
    return false;
  return true;
}
