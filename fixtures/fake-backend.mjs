import { spawn } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";

const mode = process.argv[2];
if (mode === "marker") {
  writeFileSync(process.env.MARKER_FILE, "spawned");
} else if (mode === "invalid") {
  process.stdout.write(
    JSON.stringify({
      schema_version: 1,
      completion: "<NO_CHANGE>",
      extra: true,
    }),
  );
} else if (mode === "invalid-metadata") {
  process.stdout.write(
    JSON.stringify({
      schema_version: 1,
      completion: "<NO_CHANGE>",
      route: { provider: "", model: "m" },
      usage: { input: -1 },
    }),
  );
} else if (mode === "timeout") {
  setInterval(() => {}, 1000);
} else if (mode === "child") {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore",
  });
  child.unref();
  if (process.env.PID_FILE)
    writeFileSync(process.env.PID_FILE, String(child.pid));
  process.stdout.write(
    JSON.stringify({ schema_version: 1, completion: "<NO_CHANGE>" }),
  );
} else if (mode === "overflow") {
  process.stdout.write("x".repeat(40000));
} else if (mode === "utf8") {
  process.stdout.write(Buffer.from([0xff, 0xfe]));
} else if (mode === "nonzero") {
  process.exit(7);
} else if (mode === "env") {
  process.stdin.resume();
  process.stdin.on("end", () =>
    process.stdout.write(
      JSON.stringify({
        schema_version: 1,
        completion: process.env.SECRET ? "<REWRITE>\nleak" : "<NO_CHANGE>",
      }),
    ),
  );
} else if (mode === "inspect") {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    const request = JSON.parse(input);
    const leakedOutsideStdin =
      process.argv.includes(request.prompt) ||
      Object.values(process.env).includes(request.prompt) ||
      readdirSync(process.cwd()).length > 0;
    process.stdout.write(
      JSON.stringify({
        schema_version: 1,
        completion: leakedOutsideStdin ? "<REWRITE>\nleak" : "<NO_CHANGE>",
      }),
    );
  });
} else {
  process.stdin.resume();
  process.stdin.on("end", () =>
    process.stdout.write(
      JSON.stringify({ schema_version: 1, completion: "<NO_CHANGE>" }),
    ),
  );
}
