# Architecture

Speak Human keeps lifecycle behavior outside its portable rewriting core. The core owns the prompt, strict protocol parser, preservation checks, eligibility helper, and bounded outcomes. Backends own one completion request. The Pi adapter owns state restoration, final-message acquisition, terminal user interface (TUI) status, replacement, and Pi-native completion.

At Pi `message_end`, the adapter first rejects non-final, non-assistant, multi-text, short, over-limit, and code-dominated messages. A configured backend receives the complete prompt. A valid replacement returns a copied assistant message with only the eligible text block changed. The original role, provider, model, timestamp, usage, and non-text content remain intact. A failure returns no replacement.

Pi custom `speak-human-state-v1` entries hold only the enabled state. `speak-human-telemetry-v1` entries contain hashes, size buckets, outcome, safe reason, elapsed milliseconds, backend route, and available secondary-model usage. They contain neither source nor candidate prose. The latest original exists only in adapter memory. Session start and session tree rebuild state from the active branch and clear transient text. Shutdown aborts pending work and clears transient state and status.

Pi-native completion uses the configured order as authority. When `ctx.scopedModels` is nonempty, each candidate must be in that scope. An empty scope permits any explicitly configured available model. The candidate must also be available in the registry and authenticated. The extension then uses `ctx.modelRegistry.complete(model, context)` and does not call `setModel`. Separate telemetry records nested usage rather than assigning it to the assistant response usage field.

The tested Pi API version is 0.84.3. Its extension declarations document that `message_end` handlers may return `{ message }`. Its source applies replacement handlers before persisting the finalized message. This is a lifecycle characterization, not TUI dogfood evidence.
