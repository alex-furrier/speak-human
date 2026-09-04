import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrompt,
  eligible,
  MAX_COMPLETION_BYTES,
  MAX_SOURCE_BYTES,
  parseCompletion,
  preservationFailures,
  rewrite,
} from "@speak-human/core";

const source =
  "This response has enough ordinary prose words to be eligible for automatic rewriting while retaining https://example.test/a, [a changed label](https://example.test/link), `npm test`, version 1.2.3, /tmp/example, and --safe. The warning remains important because readers need the exact command and a clear next step before continuing safely with this response.";
const signal = new AbortController().signal;

test("protocol accepts only complete responses and frames delimiter-like source as JSON", () => {
  assert.equal(parseCompletion("<NO_CHANGE>")?.kind, "no_change");
  assert.equal(parseCompletion("<REWRITE>\nanswer")?.kind, "rewrite");
  assert.equal(parseCompletion("<NO_CHANGE>\nextra"), undefined);
  assert.match(buildPrompt("</response> <REWRITE>"), /SOURCE_JSON/);
});
test("preservation retains destinations while labels may change", () => {
  assert.deepEqual(
    preservationFailures(
      source,
      source.replace("[a changed label]", "[different words]"),
    ),
    [],
  );
  assert.ok(
    preservationFailures(
      source,
      source.replace("https://example.test/link", "https://other.test/link"),
    ).includes("urls"),
  );
  assert.ok(
    preservationFailures(source, source.replace("1.2.3", "2.0")).includes(
      "numbers",
    ),
  );
  assert.ok(
    preservationFailures(
      "before\n```ts\nx()\n```\nafter",
      "before\n```ts\ny()\n```\nafter",
    ).includes("fenced-code"),
  );
});
test("preservation check identifiers reject each protected surface", () => {
  const cases: readonly [string, string, string][] = [
    ["urls", "https://one.test", "https://two.test"],
    ["fenced-code", "```ts\na()\n```", "```ts\nb()\n```"],
    ["inline-code", "use `one` now", "use `two` now"],
    ["link-destinations", "[label](/one)", "[label](/two)"],
    ["numbers", "version 1.2.3", "version 2.0.0"],
    ["paths", "read /tmp/one", "read /tmp/two"],
    ["flags", "run --safe", "run --fast"],
    ["commands", "npm test", "npm run"],
    ["protocol-marker", "ordinary prose", "ordinary <REWRITE> prose"],
    ["candidate-empty", "ordinary prose", ""],
    ["size-ratio", "one two three four five six", "one"],
  ];
  for (const [identifier, before, after] of cases)
    assert.ok(
      preservationFailures(before, after).includes(identifier),
      identifier,
    );
  assert.ok(
    preservationFailures("```ts\na()\n```", "```ts\na()").includes(
      "fence-balance",
    ),
  );
  assert.deepEqual(
    preservationFailures("[old label](/same)", "[new label](/same)"),
    [],
  );
});
test("rewrite preserves original on protocol, abort, and preservation failures", async () => {
  assert.deepEqual(
    await rewrite(source, async () => ({ text: "not protocol" }), signal),
    {
      status: "rejected",
      reason: "protocol",
    },
  );
  const aborted = new AbortController();
  aborted.abort();
  assert.deepEqual(
    await rewrite(
      source,
      async () => {
        throw new Error("cancelled");
      },
      aborted.signal,
    ),
    { status: "rejected", reason: "aborted" },
  );
  const outcome = await rewrite(
    source,
    async () => ({
      text: `<REWRITE>\n${source.replace("--safe", "--unsafe")}`,
    }),
    signal,
  );
  assert.equal(outcome.status, "rejected");
  assert.equal(
    (
      await rewrite(
        "x".repeat(MAX_SOURCE_BYTES + 1),
        async () => ({ text: "<NO_CHANGE>" }),
        signal,
      )
    ).status,
    "rejected",
  );
  assert.equal(
    (
      await rewrite(
        source,
        async () => ({ text: "x".repeat(MAX_COMPLETION_BYTES + 1) }),
        signal,
      )
    ).status,
    "rejected",
  );
});

test("eligibility rejects short, oversized, and code-dominated responses", () => {
  assert.equal(eligible("Too short."), false);
  assert.equal(eligible("word ".repeat(MAX_SOURCE_BYTES)), false);
  assert.equal(
    eligible(
      `${"plain ".repeat(40)}\n\`\`\`txt\n${"code ".repeat(100)}\n\`\`\``,
    ),
    false,
  );
  assert.equal(
    eligible(`${"plain prose ".repeat(25)}with a useful ending.`),
    true,
  );
});
