# Speak Human specification

Speak Human rewrites one finalized Pi assistant text block only after the user enables automatic mode. The source is authoritative data. The backend must return exactly `<NO_CHANGE>` or `<REWRITE>\n` plus a complete replacement.

## Safety contract

Failures, cancellation, malformed protocol, and failed exact preservation checks retain the original byte-for-byte. The checks preserve URLs, Markdown destinations, code, numbers, paths, flags, commands, fences, and bounded size. A candidate with the same normalized word sequence is also rejected because punctuation or formatting alone is not a material rewrite. These are exact checks, not semantic proof.

Configuration is JSON with `schemaVersion: 1`, read from `~/.config/speak-human/config.json` or `SPEAK_HUMAN_CONFIG_PATH`. The configuration validator rejects unknown fields. Every backend supports an optional positive integer `timeoutMs`. A missing or invalid file leaves commands loaded, disabled, and diagnosable with `/speak-human doctor`. Loopback routes must be credential-free local HTTP. Command and Pi-native routes require `allowRemoteSource: true`. Pi-native routes don't infer locality.

Loopback responses must contain exactly one choice whose message has string `content`. Optional `model` must be a nonempty string, and recognized token counts must be nonnegative finite numbers. Speak Human ignores other OpenAI-compatible response metadata. The V0 command backend supports Unix-like systems. Command responses use Speak Human's own strict protocol and reject unknown fields. Optional route provider/model values must be nonempty, and optional usage values must be nonnegative finite numbers.

Telemetry contains hashes, buckets, trusted configured or Pi-registry route identifiers, backend, outcome, checks, latency, and available secondary usage only. It never persists backend-returned route labels, source prose, or candidate prose and uses custom entries.
