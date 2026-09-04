import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { createServer, type RequestListener } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  commandCompletion,
  loopbackCompletion,
  type CommandConfig,
  type LoopbackConfig,
  validateLoopbackUrl,
} from "../packages/cli/src/index.ts";
const fake = fileURLToPath(
  new URL("../fixtures/fake-backend.mjs", import.meta.url),
);
const prompt = { system: "system contract", user: "private prompt" };
const run = (mode: string, extras: Partial<CommandConfig> = {}) =>
  commandCompletion({
    executable: process.execPath,
    args: [fake, mode],
    timeoutMs: mode === "timeout" ? 150 : 1500,
    allowRemoteSource: true,
    ...extras,
  })(prompt, new AbortController().signal);
async function withServer(
  handler: RequestListener,
  runTest: (config: LoopbackConfig) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await runTest({
      url: `http://127.0.0.1:${address.port}`,
      model: "request-model",
      timeoutMs: 100,
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
test("command backend accepts bounded JSON protocol", async () =>
  assert.equal((await run("ok")).text, "<NO_CHANGE>"));
test("command backend rejects malformed UTF-8, overflow, timeout, nonzero, and invalid schemas", async () => {
  for (const mode of [
    "utf8",
    "overflow",
    "timeout",
    "nonzero",
    "invalid",
    "invalid-metadata",
  ])
    await assert.rejects(run(mode));
});
test("command backend validates config and does not spawn for an aborted signal", async () => {
  for (const invalid of [
    { executable: "echo", allowRemoteSource: true as const },
    { executable: "/bin/echo", allowRemoteSource: true as const, timeoutMs: 0 },
    {
      executable: "/bin/echo",
      allowRemoteSource: true as const,
      args: ["bad\0arg"],
    },
    {
      executable: "/bin/echo",
      allowRemoteSource: true as const,
      env: ["BAD-NAME"],
    },
  ]) {
    assert.throws(() => commandCompletion(invalid));
  }
  await assert.rejects(
    commandCompletion({
      executable: "/definitely/missing/speak-human-backend",
      allowRemoteSource: true,
    })(prompt, new AbortController().signal),
  );
  const directory = await mkdtemp(join(tmpdir(), "speak-human-marker-"));
  const marker = join(directory, "marker");
  process.env.MARKER_FILE = marker;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    commandCompletion({
      executable: process.execPath,
      args: [fake, "marker"],
      env: ["MARKER_FILE"],
      allowRemoteSource: true,
    })(prompt, controller.signal),
  );
  await assert.rejects(access(marker));
});
test("command backend starts with an allowlisted environment", async () => {
  process.env.SECRET = "do-not-pass";
  assert.equal((await run("env")).text, "<NO_CHANGE>");
  assert.equal((await run("env", { env: ["SECRET"] })).text, "<REWRITE>\nleak");
});
test("command backend sends source only through bounded stdin", async () => {
  assert.equal((await run("inspect")).text, "<NO_CHANGE>");
});
test("command backend kills descendants with its process group", async () => {
  const directory = await mkdtemp(join(tmpdir(), "speak-human-test-"));
  const pidFile = join(directory, "pid");
  process.env.PID_FILE = pidFile;
  assert.equal((await run("child", { env: ["PID_FILE"] })).text, "<NO_CHANGE>");
  const pid = Number(await readFile(pidFile, "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.throws(() => process.kill(pid, 0));
});
test("loopback backend accepts exact success metadata and rejects transport failures", async () => {
  await withServer(
    (request, response) => {
      assert.equal(request.url, "/v1/chat/completions");
      response.end(
        JSON.stringify({
          choices: [{ message: { content: "<NO_CHANGE>" } }],
          model: "local",
          usage: { prompt_tokens: 2, completion_tokens: 3 },
        }),
      );
    },
    async (config) => {
      assert.deepEqual(
        await loopbackCompletion(config)(prompt, new AbortController().signal),
        {
          text: "<NO_CHANGE>",
          route: { provider: "loopback", model: "local" },
          usage: { input: 2, output: 3 },
        },
      );
    },
  );
  await withServer(
    (_request, response) =>
      response.end(
        JSON.stringify({
          id: "chatcmpl-local",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "<NO_CHANGE>" },
            },
          ],
        }),
      ),
    async (config) =>
      assert.equal(
        (await loopbackCompletion(config)(prompt, new AbortController().signal))
          .text,
        "<NO_CHANGE>",
      ),
  );
  for (const body of [
    Buffer.from([0xff]),
    "{",
    JSON.stringify({
      choices: [{ message: { content: "x" } }],
      usage: { prompt_tokens: -1 },
    }),
  ])
    await withServer(
      (_request, response) => response.end(body),
      async (config) =>
        assert.rejects(
          loopbackCompletion(config)(prompt, new AbortController().signal),
        ),
    );
  await withServer(
    (_request, response) => {
      response.statusCode = 307;
      response.setHeader("location", "https://example.com/collect");
      response.end();
    },
    async (config) =>
      assert.rejects(
        loopbackCompletion(config)(prompt, new AbortController().signal),
      ),
  );
  await withServer(
    (_request, response) => {
      response.statusCode = 500;
      response.end();
    },
    async (config) =>
      assert.rejects(
        loopbackCompletion(config)(prompt, new AbortController().signal),
      ),
  );
  await withServer(
    (_request, response) => setTimeout(() => response.end("{}"), 200),
    async (config) =>
      assert.rejects(
        loopbackCompletion(config)(prompt, new AbortController().signal),
      ),
  );
  await withServer(
    (_request, response) => response.end("x".repeat(33 * 1024)),
    async (config) =>
      assert.rejects(
        loopbackCompletion(config)(prompt, new AbortController().signal),
      ),
  );
});
test("loopback backend does not fetch for an aborted signal", async () => {
  let hits = 0;
  await withServer(
    (_request, response) => {
      hits++;
      response.end("{}");
    },
    async (config) => {
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        loopbackCompletion(config)(prompt, controller.signal),
      );
    },
  );
  assert.equal(hits, 0);
});
test("loopback URL must be credential-free local HTTP", () => {
  assert.throws(() => validateLoopbackUrl("https://example.com"));
  assert.throws(() => validateLoopbackUrl("http://x:y@localhost"));
  assert.equal(
    validateLoopbackUrl("http://127.0.0.1:8080").hostname,
    "127.0.0.1",
  );
});
