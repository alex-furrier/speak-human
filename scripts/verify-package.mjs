import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "speak-human-package-"));
const archiveDirectory = join(temporary, "archive");
const extracted = join(temporary, "package");
const isolatedConfig = join(temporary, "pi-config");
const isolatedSessions = join(temporary, "sessions");
const realSettings = join(
  process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
  "settings.json",
);
const beforeSettings = await readFile(realSettings).catch(() => undefined);

function checked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed: ${result.stderr || result.stdout || result.error}`,
    );
  }
  return result.stdout;
}

async function getCommands(piPath) {
  const child = spawn(
    piPath,
    [
      "--mode",
      "rpc",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "-e",
      extracted,
    ],
    {
      cwd: temporary,
      env: {
        ...process.env,
        HOME: temporary,
        PI_CODING_AGENT_DIR: isolatedConfig,
        PI_CODING_AGENT_SESSION_DIR: isolatedSessions,
        PI_OFFLINE: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let buffer = "";
  const response = new Promise((resolveResponse, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Pi RPC timed out")),
      15_000,
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.type === "response" && message.command === "get_commands") {
          clearTimeout(timer);
          resolveResponse(message);
        }
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code && code !== 0) reject(new Error(`Pi RPC exited ${code}`));
    });
  });
  child.stdin.end('{"id":"commands","type":"get_commands"}\n');
  try {
    return await response;
  } finally {
    child.kill("SIGTERM");
  }
}

try {
  checked("mkdir", ["-p", archiveDirectory]);
  const packOutput = checked("npm", [
    "pack",
    "--json",
    "--pack-destination",
    archiveDirectory,
  ]);
  const [{ filename }] = JSON.parse(packOutput);
  checked("tar", ["-xzf", join(archiveDirectory, filename), "-C", temporary]);
  checked("npm", ["install", "--omit=dev", "--ignore-scripts"], {
    cwd: extracted,
  });

  for (const path of [
    "README.md",
    "SPEC.md",
    "docs/architecture.md",
    "docs/command-adapter-protocol.md",
    "docs/security.md",
    "extensions/speak-human.ts",
  ]) {
    await readFile(join(extracted, path));
  }

  const piPath = join(root, "node_modules", ".bin", "pi");
  const rpc = await getCommands(piPath);
  if (!rpc.success) throw new Error(`get_commands failed: ${rpc.error}`);
  const commands = rpc.data?.commands;
  if (
    !Array.isArray(commands) ||
    !commands.some(
      (command) =>
        command?.name === "speak-human" && command?.source === "extension",
    )
  ) {
    throw new Error("packed extension did not register /speak-human");
  }

  const afterSettings = await readFile(realSettings).catch(() => undefined);
  if (
    !Buffer.from(beforeSettings ?? []).equals(Buffer.from(afterSettings ?? []))
  ) {
    throw new Error(
      "real Pi settings changed during isolated package verification",
    );
  }
  console.log(
    "package extraction, production install, and Pi RPC discovery passed",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
