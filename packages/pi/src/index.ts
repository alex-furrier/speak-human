import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  bucket,
  digest,
  eligible,
  rewrite,
  type Completion,
  type CompletionResult,
} from "@speak-human/core";
import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
type AssistantMessage = Extract<
  MessageEndEvent["message"],
  { role: "assistant" }
>;
type NativeModel = ExtensionContext["scopedModels"][number]["model"];
import {
  commandCompletion,
  loopbackCompletion,
  validateLoopbackUrl,
  type CommandConfig,
  type LoopbackConfig,
} from "@speak-human/cli";

type Backend =
  | { kind: "loopback"; config: LoopbackConfig }
  | { kind: "command"; config: CommandConfig }
  | {
      kind: "pi-native";
      models: string[];
      timeoutMs?: number;
      allowRemoteSource: true;
    };
export type Config = {
  schemaVersion: 1;
  backend: Backend;
  enabledByDefault?: boolean;
};
type TextBlock = { type: "text"; text: string };
const STATE = "speak-human-state-v1";
const TELEMETRY = "speak-human-telemetry-v1";

function configPath(): string {
  return (
    process.env.SPEAK_HUMAN_CONFIG_PATH ??
    join(homedir(), ".config", "speak-human", "config.json")
  );
}
export function loadConfig(path = configPath()): {
  config?: Config;
  error?: string;
} {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return { error: "config-unavailable" };
  }
  try {
    const value: unknown = JSON.parse(contents);
    return isConfig(value) ? { config: value } : { error: "config-invalid" };
  } catch {
    return { error: "config-invalid" };
  }
}
function hasOnly(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function validTimeout(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
  );
}
export function isConfig(value: unknown): value is Config {
  if (!value || typeof value !== "object") return false;
  const config = value as Record<string, unknown>;
  if (
    !hasOnly(config, ["schemaVersion", "backend", "enabledByDefault"]) ||
    config.schemaVersion !== 1 ||
    (typeof config.enabledByDefault !== "undefined" &&
      typeof config.enabledByDefault !== "boolean") ||
    !config.backend ||
    typeof config.backend !== "object"
  )
    return false;
  const backend = config.backend as Record<string, unknown>;
  if (backend.kind === "loopback") {
    if (
      !hasOnly(backend, ["kind", "config"]) ||
      !backend.config ||
      typeof backend.config !== "object"
    )
      return false;
    const item = backend.config as Record<string, unknown>;
    if (
      !hasOnly(item, ["url", "model", "timeoutMs"]) ||
      typeof item.url !== "string" ||
      typeof item.model !== "string" ||
      item.model.trim().length === 0 ||
      !validTimeout(item.timeoutMs)
    )
      return false;
    try {
      validateLoopbackUrl(item.url);
      return true;
    } catch {
      return false;
    }
  }
  if (backend.kind === "command") {
    if (
      !hasOnly(backend, ["kind", "config"]) ||
      !backend.config ||
      typeof backend.config !== "object"
    )
      return false;
    const item = backend.config as Record<string, unknown>;
    return (
      hasOnly(item, [
        "executable",
        "args",
        "env",
        "timeoutMs",
        "allowRemoteSource",
      ]) &&
      typeof item.executable === "string" &&
      item.executable.startsWith("/") &&
      item.allowRemoteSource === true &&
      validTimeout(item.timeoutMs) &&
      (item.args === undefined ||
        (Array.isArray(item.args) &&
          item.args.every(
            (arg) => typeof arg === "string" && !arg.includes("\0"),
          ))) &&
      (item.env === undefined ||
        (Array.isArray(item.env) &&
          item.env.every(
            (name) =>
              typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name),
          )))
    );
  }
  return (
    backend.kind === "pi-native" &&
    hasOnly(backend, ["kind", "models", "timeoutMs", "allowRemoteSource"]) &&
    backend.allowRemoteSource === true &&
    validTimeout(backend.timeoutMs) &&
    Array.isArray(backend.models) &&
    backend.models.length > 0 &&
    backend.models.every(
      (model) => typeof model === "string" && modelParts(model) !== undefined,
    )
  );
}
function textBlock(
  message: AssistantMessage | undefined,
): { text: string; index: number } | undefined {
  if (!message || message.role !== "assistant" || message.stopReason !== "stop")
    return undefined;
  const texts = message.content.flatMap((block, index) =>
    block.type === "text" && typeof block.text === "string"
      ? [{ text: block.text, index }]
      : [],
  );
  return texts.length === 1 ? texts[0] : undefined;
}
function restoredEnabled(branch: readonly SessionEntry[]): boolean | undefined {
  let enabled: boolean | undefined;
  for (const entry of branch)
    if (
      entry.type === "custom" &&
      entry.customType === STATE &&
      typeof (entry.data as { enabled?: unknown } | undefined)?.enabled ===
        "boolean"
    )
      enabled = (entry.data as { enabled: boolean }).enabled;
  return enabled;
}
function modelParts(value: string): [string, string] | undefined {
  const separator = value.indexOf("/");
  return separator > 0 && separator < value.length - 1
    ? [value.slice(0, separator), value.slice(separator + 1)]
    : undefined;
}
function nativeCompletion(
  context: ExtensionContext,
  backend: Extract<Backend, { kind: "pi-native" }>,
): Completion {
  const scoped =
    context.scopedModels.length === 0
      ? undefined
      : new Set(
          context.scopedModels.map(
            ({ model }) => `${model.provider}/${model.id}`,
          ),
        );
  for (const configured of backend.models) {
    const parts = modelParts(configured);
    if (!parts || (scoped && !scoped.has(configured))) continue;
    const model = context.modelRegistry.find(...parts);
    if (
      !model ||
      !context.modelRegistry
        .getAvailable()
        .some(
          (available) =>
            available.provider === model.provider && available.id === model.id,
        ) ||
      !context.modelRegistry.hasConfiguredAuth(model)
    )
      continue;
    return async (prompt, signal) => {
      const result = await context.modelRegistry.complete(
        model,
        {
          systemPrompt: prompt.system,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: prompt.user }],
              timestamp: Date.now(),
            },
          ],
        },
        { signal },
      );
      const texts = result.content.filter(
        (part): part is TextBlock =>
          part.type === "text" && typeof part.text === "string",
      );
      if (result.stopReason !== "stop" || texts.length !== 1)
        throw new Error("native-invalid-result");
      return {
        text: texts[0]!.text,
        route: { provider: model.provider, model: model.id },
        ...(result.usage
          ? {
              usage: {
                input: result.usage.input,
                output: result.usage.output,
                cost: result.usage.cost.total,
              },
            }
          : {}),
      } satisfies CompletionResult;
    };
  }
  throw new Error("native-model-unavailable");
}
function operationSignal(
  parents: readonly (AbortSignal | undefined)[],
  timeoutMs: number,
): { signal: AbortSignal; close(): void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const parent of parents) {
    if (parent?.aborted) controller.abort();
    else parent?.addEventListener("abort", abort, { once: true });
  }
  const timer = setTimeout(abort, timeoutMs);
  return {
    signal: controller.signal,
    close: () => {
      clearTimeout(timer);
      for (const parent of parents) parent?.removeEventListener("abort", abort);
    },
  };
}
export function createSpeakHuman(
  config: Config | undefined,
  configError?: string,
): (pi: ExtensionAPI) => void {
  return (pi) => {
    let enabled = config?.enabledByDefault === true;
    let original: string | undefined;
    let running: AbortController | undefined;
    let active = true;
    let previous = "none";
    const status = (context: ExtensionContext) => {
      const backend = config?.backend.kind ?? "unconfigured";
      const text = running
        ? `↻ speaking human · ${backend}`
        : enabled
          ? `↻ speak human · ${backend}`
          : undefined;
      context.ui.setStatus("speak-human", text);
    };
    const cancel = () => {
      running?.abort();
      running = undefined;
      original = undefined;
    };
    const rebuild = (_event: unknown, context: ExtensionContext) => {
      cancel();
      active = true;
      enabled =
        restoredEnabled(context.sessionManager.getBranch()) ??
        config?.enabledByDefault === true;
      status(context);
    };
    pi.on("session_start", rebuild);
    pi.on("session_tree", rebuild);
    pi.on("session_shutdown", (_event, context) => {
      active = false;
      cancel();
      context.ui.setStatus("speak-human", undefined);
    });
    pi.registerCommand("speak-human", {
      description: "on, off, status, doctor, or show-original",
      async handler(args, context) {
        const action = args.trim();
        if (action === "on" || action === "off") {
          enabled = action === "on";
          pi.appendEntry(STATE, { enabled });
          status(context);
          return;
        }
        if (action === "show-original") {
          context.ui.notify(original ?? "no-original", "info");
          return;
        }
        if (action === "doctor") {
          context.ui.notify(
            config
              ? doctor(config, context)
              : `error=${configError ?? "config-unavailable"}`,
            config ? "info" : "warning",
          );
          return;
        }
        if (action === "status" || action === "") {
          status(context);
          context.ui.notify(
            `enabled=${enabled}; backend=${config?.backend.kind ?? "unconfigured"}; route=${route(config?.backend)}; disclosure=${config?.backend.kind === "loopback" ? "local" : "remote-consent"}; timeout=${timeout(config?.backend)}; previous=${previous}`,
            "info",
          );
          return;
        }
        context.ui.notify(
          "usage=on|off|status|doctor|show-original",
          "warning",
        );
      },
    });
    pi.on("message_end", async (event, context) => {
      if (event.message.role !== "assistant") return;
      const message = event.message;
      const block = textBlock(message);
      if (!config || !enabled || running || !block || !eligible(block.text))
        return;
      const controller = new AbortController();
      running = controller;
      const operation = operationSignal(
        [controller.signal, context.signal],
        timeout(config.backend),
      );
      const started = Date.now();
      const source = block.text;
      status(context);
      try {
        const completion =
          config.backend.kind === "loopback"
            ? loopbackCompletion(config.backend.config)
            : config.backend.kind === "command"
              ? commandCompletion(config.backend.config)
              : nativeCompletion(context, config.backend);
        const completed = await rewrite(source, completion, operation.signal);
        if (controller.signal.aborted) return;
        const outcome = operation.signal.aborted
          ? ({ status: "rejected", reason: "aborted", checks: [] } as const)
          : completed;
        previous = `${outcome.status}:${Date.now() - started}ms`;
        pi.appendEntry(TELEMETRY, {
          outcome: outcome.status,
          code: "reason" in outcome ? outcome.reason : "ok",
          checks:
            outcome.status === "rewrite"
              ? outcome.checks
              : outcome.status === "rejected"
                ? (outcome.checks ?? [])
                : [],
          backend: config.backend.kind,
          route: route(config.backend),
          ...(outcome.status !== "rejected" && outcome.completion.route
            ? {
                rewrite_route_provider: outcome.completion.route.provider,
                rewrite_route_model: outcome.completion.route.model,
              }
            : {}),
          ...(outcome.status !== "rejected" && outcome.completion.usage
            ? {
                rewrite_usage_input: outcome.completion.usage.input,
                rewrite_usage_output: outcome.completion.usage.output,
                rewrite_usage_cost: outcome.completion.usage.cost,
              }
            : {}),
          elapsed_ms: Date.now() - started,
          source_sha256: digest(source),
          output_sha256:
            outcome.status === "rewrite" ? digest(outcome.text) : undefined,
          word_bucket: bucket(source.trim().split(/\s+/).length),
          byte_bucket: bucket(Buffer.byteLength(source)),
        });
        if (outcome.status !== "rewrite" || operation.signal.aborted) return;
        original = source;
        const content = [...message.content];
        content[block.index] = {
          ...(content[block.index] as TextBlock),
          type: "text",
          text: outcome.text,
        } as (typeof content)[number];
        return { message: { ...message, content } };
      } catch {
        if (!controller.signal.aborted) {
          previous = `rejected:${Date.now() - started}ms`;
          pi.appendEntry(TELEMETRY, {
            outcome: "rejected",
            code: "backend-unavailable",
            checks: [],
            backend: config.backend.kind,
            route: route(config.backend),
            elapsed_ms: Date.now() - started,
            source_sha256: digest(source),
            word_bucket: bucket(source.trim().split(/\s+/).length),
            byte_bucket: bucket(Buffer.byteLength(source)),
          });
        }
        return;
      } finally {
        operation.close();
        if (running === controller) running = undefined;
        if (active) status(context);
      }
    });
  };
}
function route(backend: Backend | undefined): string {
  if (!backend) return "none";
  return backend.kind === "pi-native"
    ? (backend.models[0] ?? "none")
    : backend.kind === "loopback"
      ? backend.config.model
      : "configured-command";
}
function timeout(backend: Backend | undefined): number {
  return backend?.kind === "loopback" || backend?.kind === "command"
    ? (backend.config.timeoutMs ?? 10_000)
    : backend?.kind === "pi-native"
      ? (backend.timeoutMs ?? 10_000)
      : 10_000;
}
function doctor(config: Config, context: ExtensionContext): string {
  if (config.backend.kind === "loopback") {
    try {
      loopbackCompletion(config.backend.config);
      return "ok=loopback-config";
    } catch {
      return "error=loopback-config";
    }
  }
  if (config.backend.kind === "command") {
    try {
      commandCompletion(config.backend.config);
      return "ok=command-config";
    } catch {
      return "error=command-config";
    }
  }
  try {
    nativeCompletion(context, config.backend);
    return "ok=pi-native-route";
  } catch {
    return "error=pi-native-route";
  }
}
export default function speakHuman(pi: ExtensionAPI): void {
  const loaded = loadConfig();
  createSpeakHuman(loaded.config, loaded.error)(pi);
}
