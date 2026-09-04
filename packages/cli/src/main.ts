#!/usr/bin/env -S node --import tsx
import { rewrite } from "@speak-human/core";
import {
  commandCompletion,
  isCommandConfig,
  isLoopbackConfig,
  loopbackCompletion,
  type CommandConfig,
  type LoopbackConfig,
} from "./index.ts";

const INPUT_LIMIT = 64 * 1024;
type PortableBackend =
  | { kind: "loopback"; config: LoopbackConfig }
  | { kind: "command"; config: CommandConfig };

function hasOnly(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}
function parseBackend(value: unknown): PortableBackend | undefined {
  if (!value || typeof value !== "object") return undefined;
  const backend = value as Record<string, unknown>;
  if (!hasOnly(backend, ["kind", "config"])) return undefined;
  if (backend.kind === "loopback" && isLoopbackConfig(backend.config))
    return { kind: "loopback", config: backend.config };
  if (backend.kind === "command" && isCommandConfig(backend.config))
    return { kind: "command", config: backend.config };
  return undefined;
}
function safeWrite(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
function fail(): void {
  process.stderr.write("speak-human: request rejected\n");
  process.exitCode = 1;
}

let input = "";
let oversized = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  if (oversized) return;
  input += chunk;
  if (Buffer.byteLength(input) > INPUT_LIMIT) {
    oversized = true;
    input = "";
  }
});
process.stdin.on("end", async () => {
  try {
    if (oversized) throw new Error("request-too-large");
    const request: unknown = JSON.parse(input);
    if (!request || typeof request !== "object")
      throw new Error("request-invalid");
    const body = request as Record<string, unknown>;
    const action = process.argv[2] ?? "rewrite";
    const allowed =
      action === "doctor"
        ? ["schema_version", "backend"]
        : ["schema_version", "text", "backend"];
    if (!hasOnly(body, allowed) || body.schema_version !== 1)
      throw new Error("request-invalid");
    const backend = parseBackend(body.backend);
    if (!backend) throw new Error("backend-invalid");
    const complete =
      backend.kind === "loopback"
        ? loopbackCompletion(backend.config)
        : commandCompletion(backend.config);
    if (action === "doctor") {
      safeWrite({ schema_version: 1, status: "ok", backend: backend.kind });
      return;
    }
    if (action !== "rewrite" || typeof body.text !== "string")
      throw new Error("request-invalid");
    const outcome = await rewrite(
      body.text,
      complete,
      new AbortController().signal,
    );
    safeWrite({ schema_version: 1, ...outcome });
  } catch {
    fail();
  }
});
