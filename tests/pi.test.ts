import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import {
  createSpeakHuman,
  isConfig,
  loadConfig,
  type Config,
} from "@speak-human/pi";

const fake = fileURLToPath(
  new URL("../fixtures/fake-backend.mjs", import.meta.url),
);
const prose =
  "This is a long enough assistant response with at least forty plain words so it can enter the rewrite path without ambiguity. It preserves a warning, a command, and a practical next step that the reader can use after this response has completed in the terminal without changing any primary assistant metadata or usage values.";

type Handler = (event: unknown, context: ExtensionContext) => unknown;
type Command = {
  handler(args: string, context: ExtensionContext): Promise<void> | void;
};
type Entry = { type: string; data: Record<string, unknown> };

type Harness = {
  api: ExtensionAPI;
  handlers: Map<string, Handler>;
  commands: Map<string, Command>;
  entries: Entry[];
};

function createHarness(): Harness {
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, Command>();
  const entries: Entry[] = [];
  const partial = {
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
    },
    registerCommand(name: string, command: Command) {
      commands.set(name, command);
    },
    appendEntry(type: string, data: Record<string, unknown>) {
      entries.push({ type, data });
    },
  };
  return {
    api: partial as unknown as ExtensionAPI,
    handlers,
    commands,
    entries,
  };
}

type ContextControls = {
  branch?: readonly SessionEntry[];
  scoped?: boolean;
  authenticated?: boolean;
  completionText?: string;
  pending?: boolean;
  signal?: AbortSignal;
  onComplete?: () => void;
};

function createContext(controls: ContextControls = {}): {
  context: ExtensionContext;
  statuses: Array<string | undefined>;
  notifications: string[];
  release?: () => void;
  completionCalls: { count: number };
} {
  const statuses: Array<string | undefined> = [];
  const notifications: string[] = [];
  const completionCalls = { count: 0 };
  const model = { provider: "p", id: "m" };
  let release: (() => void) | undefined;
  const partial = {
    signal: controls.signal,
    ui: {
      setStatus(_key: string, value?: string) {
        statuses.push(value);
      },
      notify(message: string) {
        notifications.push(message);
      },
    },
    sessionManager: { getBranch: () => controls.branch ?? [] },
    scopedModels: controls.scoped === false ? [] : [{ model }],
    modelRegistry: {
      find: () => ({ ...model }),
      getAvailable: () => [{ ...model }],
      hasConfiguredAuth: () => controls.authenticated !== false,
      async complete(
        _model: unknown,
        request: { messages: unknown[] },
        options: { signal: AbortSignal },
      ) {
        completionCalls.count++;
        assert.equal(request.messages.length, 1);
        if (controls.pending) {
          await new Promise<void>((resolve, reject) => {
            release = resolve;
            options.signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          });
        }
        controls.onComplete?.();
        return {
          stopReason: "stop",
          provider: "p",
          model: "m",
          content: [
            {
              type: "text",
              text:
                controls.completionText ??
                `<REWRITE>\n${prose.replace("long enough", "sufficiently long")}`,
            },
          ],
          usage: {
            input: 7,
            output: 5,
            cost: { total: 0.002 },
          },
        };
      },
    },
  };
  return {
    context: partial as unknown as ExtensionContext,
    statuses,
    notifications,
    completionCalls,
    ...(release ? { release } : {}),
  };
}

const nativeConfig: Config = {
  schemaVersion: 1,
  backend: {
    kind: "pi-native",
    models: ["missing/model", "p/m"],
    timeoutMs: 1_000,
    allowRemoteSource: true,
  },
};

function assistantMessage(text = prose) {
  return {
    role: "assistant",
    stopReason: "stop",
    provider: "primary",
    model: "primary-model",
    timestamp: 1,
    usage: { input: 1, output: 2 },
    content: [
      { type: "text", text },
      { type: "toolCall", id: "call", name: "x", arguments: {} },
    ],
  };
}

test("strict config accepts only complete backend-specific schema v1 shapes", () => {
  const valid = [
    {
      schemaVersion: 1,
      backend: {
        kind: "loopback",
        config: { url: "http://127.0.0.1:1", model: "m", timeoutMs: 1 },
      },
    },
    {
      schemaVersion: 1,
      backend: {
        kind: "command",
        config: { executable: "/bin/echo", allowRemoteSource: true },
      },
    },
    nativeConfig,
  ];
  for (const config of valid) assert.equal(isConfig(config), true);
  const invalid = [
    {},
    { schemaVersion: 2, backend: valid[0]!.backend },
    { schemaVersion: 1, extra: true, backend: valid[0]!.backend },
    {
      schemaVersion: 1,
      backend: {
        kind: "loopback",
        config: { url: "", model: "m", unknown: true },
      },
    },
    {
      schemaVersion: 1,
      enabledByDefault: true,
      backend: {
        kind: "loopback",
        config: { url: "https://example.com", model: "m" },
      },
    },
    {
      schemaVersion: 1,
      backend: {
        kind: "command",
        config: { executable: "echo", allowRemoteSource: true },
      },
    },
    {
      schemaVersion: 1,
      backend: { kind: "pi-native", models: [], allowRemoteSource: true },
    },
    {
      schemaVersion: 1,
      backend: {
        kind: "pi-native",
        models: ["p/m"],
        timeoutMs: 0,
        allowRemoteSource: true,
      },
    },
  ];
  for (const config of invalid) assert.equal(isConfig(config), false);
});

test("config loading distinguishes missing, malformed, and valid files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "speak-human-config-"));
  const missing = join(directory, "missing.json");
  const malformed = join(directory, "malformed.json");
  const valid = join(directory, "valid.json");
  await writeFile(malformed, "{");
  await writeFile(valid, JSON.stringify(nativeConfig));
  assert.deepEqual(loadConfig(missing), { error: "config-unavailable" });
  assert.deepEqual(loadConfig(malformed), { error: "config-invalid" });
  assert.deepEqual(loadConfig(valid), { config: nativeConfig });
});

test("Pi native completion handles unscoped models and preserves primary metadata", async () => {
  const harness = createHarness();
  createSpeakHuman(nativeConfig)(harness.api);
  const runtime = createContext({ scoped: false });
  await harness.commands.get("speak-human")!.handler("on", runtime.context);
  const message = assistantMessage();
  const result = (await harness.handlers.get("message_end")!(
    { message },
    runtime.context,
  )) as { message?: ReturnType<typeof assistantMessage> } | undefined;

  assert.equal(result?.message?.provider, "primary");
  assert.deepEqual(result?.message?.usage, message.usage);
  assert.equal(result?.message?.content[1], message.content[1]);
  assert.equal(runtime.completionCalls.count, 1);

  const telemetry = harness.entries.find(
    (entry) => entry.type === "speak-human-telemetry-v1",
  );
  assert.equal(telemetry?.data.rewrite_route_provider, "p");
  assert.equal(telemetry?.data.rewrite_route_model, "m");
  assert.equal(telemetry?.data.rewrite_usage_input, 7);
  assert.equal(telemetry?.data.rewrite_usage_output, 5);
  assert.equal(telemetry?.data.rewrite_usage_cost, 0.002);
  assert.deepEqual(telemetry?.data.checks, []);
  assert.equal(JSON.stringify(telemetry).includes(prose), false);
  assert.match(String(telemetry?.data.source_sha256), /^[a-f0-9]{64}$/);
});

test("Pi telemetry ignores untrusted backend route metadata", async () => {
  const harness = createHarness();
  createSpeakHuman({
    schemaVersion: 1,
    backend: {
      kind: "command",
      config: {
        executable: process.execPath,
        args: [fake, "private-route"],
        timeoutMs: 1_000,
        allowRemoteSource: true,
      },
    },
  })(harness.api);
  const runtime = createContext();
  await harness.commands.get("speak-human")!.handler("on", runtime.context);
  await harness.handlers.get("message_end")!(
    { message: assistantMessage() },
    runtime.context,
  );
  const telemetry = harness.entries.find(
    (entry) => entry.type === "speak-human-telemetry-v1",
  );
  assert.equal(telemetry?.data.rewrite_route_provider, "command");
  assert.equal(telemetry?.data.rewrite_route_model, "configured-command");
  assert.equal(
    JSON.stringify(telemetry).includes("private response prose"),
    false,
  );
});

test("Pi adapter restores active-branch state on start and tree navigation", async () => {
  const harness = createHarness();
  createSpeakHuman(nativeConfig)(harness.api);
  const branch = [
    {
      type: "custom",
      customType: "speak-human-state-v1",
      data: { enabled: true },
    },
    {
      type: "custom",
      customType: "speak-human-state-v1",
      data: { enabled: false },
    },
  ] as unknown as SessionEntry[];
  const runtime = createContext({ branch });

  await harness.handlers.get("session_start")!({}, runtime.context);
  await harness.commands.get("speak-human")!.handler("status", runtime.context);
  assert.match(runtime.notifications.at(-1) ?? "", /enabled=false/);

  branch.push({
    type: "custom",
    customType: "speak-human-state-v1",
    data: { enabled: true },
  } as unknown as SessionEntry);
  await harness.handlers.get("session_tree")!({}, runtime.context);
  await harness.commands.get("speak-human")!.handler("status", runtime.context);
  assert.match(runtime.notifications.at(-1) ?? "", /enabled=true/);
});

test("context cancellation after a cooperative completion prevents replacement", async () => {
  const harness = createHarness();
  createSpeakHuman(nativeConfig)(harness.api);
  const controller = new AbortController();
  const runtime = createContext({
    signal: controller.signal,
    onComplete: () => controller.abort(),
  });
  await harness.commands.get("speak-human")!.handler("on", runtime.context);
  const result = await harness.handlers.get("message_end")!(
    { message: assistantMessage() },
    runtime.context,
  );
  assert.equal(result, undefined);
  assert.equal(harness.entries.at(-1)?.data.outcome, "rejected");
  assert.equal(harness.entries.at(-1)?.data.code, "aborted");
});

test("session navigation aborts pending rewrite and prevents late replacement", async () => {
  const harness = createHarness();
  createSpeakHuman(nativeConfig)(harness.api);
  const runtime = createContext({ pending: true });
  await harness.commands.get("speak-human")!.handler("on", runtime.context);

  const pending = harness.handlers.get("message_end")!(
    { message: assistantMessage() },
    runtime.context,
  );
  const concurrent = await harness.handlers.get("message_end")!(
    { message: assistantMessage() },
    runtime.context,
  );
  assert.equal(concurrent, undefined);
  await harness.handlers.get("session_tree")!({}, runtime.context);
  assert.equal(await pending, undefined);
  assert.equal(
    harness.entries.some((entry) => entry.type === "speak-human-telemetry-v1"),
    false,
  );
  assert.equal(runtime.statuses.at(-1), undefined);
});

test("shutdown clears status and aborts work", async () => {
  const harness = createHarness();
  createSpeakHuman(nativeConfig)(harness.api);
  const runtime = createContext({ pending: true });
  await harness.commands.get("speak-human")!.handler("on", runtime.context);
  const pending = harness.handlers.get("message_end")!(
    { message: assistantMessage() },
    runtime.context,
  );
  await harness.handlers.get("session_shutdown")!({}, runtime.context);
  assert.equal(await pending, undefined);
  assert.equal(runtime.statuses.at(-1), undefined);
});

test("no-change, ineligible, unauthenticated, and missing config keep original", async () => {
  const noChangeHarness = createHarness();
  createSpeakHuman(nativeConfig)(noChangeHarness.api);
  const noChange = createContext({ completionText: "<NO_CHANGE>" });
  await noChangeHarness.commands
    .get("speak-human")!
    .handler("on", noChange.context);
  assert.equal(
    await noChangeHarness.handlers.get("message_end")!(
      { message: assistantMessage() },
      noChange.context,
    ),
    undefined,
  );
  assert.equal(
    await noChangeHarness.handlers.get("message_end")!(
      { message: assistantMessage("Too short.") },
      noChange.context,
    ),
    undefined,
  );

  const unavailableHarness = createHarness();
  createSpeakHuman(nativeConfig)(unavailableHarness.api);
  const unavailable = createContext({ authenticated: false });
  await unavailableHarness.commands
    .get("speak-human")!
    .handler("on", unavailable.context);
  assert.equal(
    await unavailableHarness.handlers.get("message_end")!(
      { message: assistantMessage() },
      unavailable.context,
    ),
    undefined,
  );

  const missingHarness = createHarness();
  createSpeakHuman(undefined, "config-unavailable")(missingHarness.api);
  const missing = createContext();
  await missingHarness.commands
    .get("speak-human")!
    .handler("doctor", missing.context);
  assert.deepEqual(missing.notifications, ["error=config-unavailable"]);
  assert.ok(missingHarness.commands.has("speak-human"));
});

test("commands toggle state and expose only the latest in-memory original", async () => {
  const harness = createHarness();
  createSpeakHuman(nativeConfig)(harness.api);
  const runtime = createContext();
  const command = harness.commands.get("speak-human")!;

  await command.handler("on", runtime.context);
  assert.equal(runtime.statuses.at(-1), "↻ speak human · pi-native");
  await harness.handlers.get("message_end")!(
    { message: assistantMessage() },
    runtime.context,
  );
  await command.handler("show-original", runtime.context);
  assert.equal(runtime.notifications.at(-1), prose);
  await command.handler("off", runtime.context);
  assert.equal(runtime.statuses.at(-1), undefined);
  await command.handler("bogus", runtime.context);
  assert.match(runtime.notifications.at(-1) ?? "", /usage=/);
});
