import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
    typeof request === "string" ? request : JSON.stringify(request),
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

test("CLI rejects malformed, unknown, and oversized input without echoing it", async () => {
  for (const request of [
    "{",
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
