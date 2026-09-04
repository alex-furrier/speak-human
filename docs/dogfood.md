# Dogfood results

The V0 dogfood used real Pi 0.84.3 sessions with isolated session directories and the extension loaded explicitly. It retained only content-free results in this repository.

## Local Qwen loopback

Qwen3.5-4B Q4 ran through llama.cpp at a credential-free loopback address. Speak Human accepted a rewrite of deliberately repetitive prose.

- Outcome: rewrite
- Rewrite latency: 1,021 ms
- Source and replacement sizes: 859 and 494 bytes
- Protocol and preservation checks: passed
- Primary assistant metadata: preserved

The rewrite removed repetition, but retained synthetic phrases such as “critical” and “key takeaway.” The backend path works, but this sample was less natural than the Luna rewrite.

## Pi-native Luna

The Pi adapter selected the explicitly configured `openai-codex/gpt-5.6-luna` model through `ctx.modelRegistry.complete()` without changing the active primary model. Speak Human accepted its rewrite of the same source.

- Outcome: rewrite
- Rewrite latency: 3,171 ms
- Source and replacement sizes: 859 and 369 bytes
- Secondary usage: 371 input tokens, 114 output tokens, and $0.000211
- Protocol and preservation checks: passed
- Primary assistant metadata and usage: preserved

The result removed the repeated setup and kept the source's recommendation, uncertainty, and operating concerns. This was the stronger rewrite in the paired sample.

## Session behavior

Resuming the Luna session restored automatic mode from the active branch. After disabling rewriting, the next primary-model turn quoted the first sentence of the rewritten response rather than the streamed original. This shows that Pi persisted the replacement as canonical conversation context.

A remote procedure call (RPC) abort sent while Qwen rewriting was active produced an `aborted` telemetry outcome after 3 ms. Pi persisted the original assistant response with `stopReason: stop` and applied no replacement.

The session files contained one assistant message for each completed turn. Custom telemetry contained hashes, buckets, route, latency, outcome, and available secondary usage without source or replacement prose.

## Friction and remaining evidence

The first Qwen trial failed because a single user message carrying JSON source encouraged the model to return `<NO_CHANGE>` followed by the source object. Splitting the contract into a system prompt and a bounded source message fixed the protocol behavior and matched the earlier Qwen experiment.

A 50% minimum compression ratio rejected a useful Luna rewrite of highly repetitive prose. Lowering the bound to 30% admitted the candidate while retaining exact protected-content checks. This threshold remains a heuristic safety bound, not semantic proof.

The automated RPC runs do not establish whether the streamed-original-to-replacement transition feels distracting in a real terminal. That visual judgment remains a manual pre-release check.

## Decision

The core Pi path is ready for review with one manual terminal user interface (TUI) follow-up. Both required model routes performed real accepted rewrites, failure preserved the original, session resume restored state, and the next turn observed canonical rewritten context.
