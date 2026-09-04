#!/usr/bin/env node
import { rewrite } from "@speak-human/core";
import { commandCompletion, loopbackCompletion } from "./index.ts";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  input += chunk;
});
process.stdin.on("end", async () => {
  try {
    const request: unknown = JSON.parse(input);
    if (!request || typeof request !== "object")
      throw new Error("request-invalid");
    const { text, backend } = request as { text?: unknown; backend?: unknown };
    if (typeof text !== "string" || !backend || typeof backend !== "object")
      throw new Error("request-invalid");
    const kind = (backend as { kind?: unknown }).kind;
    const complete =
      kind === "loopback"
        ? loopbackCompletion(backend as never)
        : kind === "command"
          ? commandCompletion(backend as never)
          : undefined;
    if (!complete) throw new Error("backend-invalid");
    process.stdout.write(
      JSON.stringify(
        await rewrite(text, complete, new AbortController().signal),
      ),
    );
  } catch {
    process.stderr.write("speak-human: request rejected\n");
    process.exitCode = 1;
  }
});
