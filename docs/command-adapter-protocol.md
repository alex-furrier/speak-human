# Command adapter protocol

A command backend receives one UTF-8 JSON object on standard input:

```json
{ "schema_version": 1, "prompt": "application-owned complete prompt" }
```

It must write one UTF-8 JSON object to standard output:

```json
{ "schema_version": 1, "completion": "<NO_CHANGE>" }
```

The completion may instead use `<REWRITE>` followed by a newline and complete replacement text. Extra JSON fields, malformed UTF-8, malformed JSON, output larger than 32 KiB, a nonzero exit, timeout, or cancellation reject the attempt.

The host requires an absolute executable and literal arguments, never invokes a shell, starts in a neutral temporary directory, forwards only named allowlisted environment variables, and starts a separate process group. One deadline covers the exchange. Cleanup kills the group so descendants do not outlive an attempt. Errors are stable codes and do not include prompt, output, executable path, or environment values.
