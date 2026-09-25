import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const main = fileURLToPath(
  new URL("../packages/cli/src/main.ts", import.meta.url),
);
const fake = fileURLToPath(
  new URL("../fixtures/fake-backend.mjs", import.meta.url),
);
const backend = {
  kind: "command",
  config: {
    executable: process.execPath,
    args: [fake, "ok"],
    allowRemoteSource: true,
  },
};

async function runCli(
  action: "rewrite" | "doctor",
  request: unknown,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["--import", "tsx", main, action], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdin.end(
    typeof request === "string" || Buffer.isBuffer(request)
      ? request
      : JSON.stringify(request),
  );
  const code = await new Promise<number | null>((resolve) =>
    child.once("close", resolve),
  );
  return { code, stdout, stderr };
}

test("CLI rewrite and doctor use bounded versioned JSON", async () => {
  const rewrite = await runCli("rewrite", {
    schema_version: 1,
    text: "Plain short source.",
    backend,
  });
  assert.equal(rewrite.code, 0);
  assert.deepEqual(JSON.parse(rewrite.stdout), {
    schema_version: 1,
    status: "no_change",
    reason: "model",
    completion: { text: "<NO_CHANGE>" },
  });

  const doctor = await runCli("doctor", { schema_version: 1, backend });
  assert.equal(doctor.code, 0);
  assert.deepEqual(JSON.parse(doctor.stdout), {
    schema_version: 1,
    status: "ok",
    backend: "command",
  });
});

test("CLI termination aborts and kills a command backend", async () => {
  const directory = await mkdtemp(join(tmpdir(), "speak-human-signal-"));
  const pidFile = join(directory, "backend.pid");
  const child = spawn(process.execPath, ["--import", "tsx", main, "rewrite"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PID_FILE: pidFile },
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stdin.end(
    JSON.stringify({
      schema_version: 1,
      text: "A source answer with a pending command backend.",
      backend: {
        kind: "command",
        config: {
          executable: process.execPath,
          args: [fake, "linger"],
          env: ["PID_FILE"],
          allowRemoteSource: true,
        },
      },
    }),
  );
  let pid: number | undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      pid = Number(await readFile(pidFile, "utf8"));
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  assert.ok(pid, "backend started");
  child.kill("SIGTERM");
  const code = await Promise.race([
    new Promise<number | null>((resolve) => child.once("close", resolve)),
    new Promise<never>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error("CLI did not settle after SIGTERM")),
        3000,
      ),
    ),
  ]);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(output), {
    schema_version: 1,
    status: "rejected",
    reason: "aborted",
  });
  assert.throws(() => process.kill(pid, 0));
});

test("CLI rejects malformed, unknown, and oversized input without echoing it", async () => {
  const malformedUtf8 = Buffer.concat([
    Buffer.from('{"schema_version":1,"text":"'),
    Buffer.from([0xff]),
    Buffer.from(`","backend":${JSON.stringify(backend)}}`),
  ]);
  for (const request of [
    "{",
    malformedUtf8,
    { schema_version: 1, text: "secret", backend, extra: true },
    "x".repeat(65 * 1024),
  ]) {
    const result = await runCli("rewrite", request);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.includes("secret"), false);
    assert.match(result.stderr, /request rejected/);
  }
});
