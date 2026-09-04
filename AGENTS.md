# AGENTS.md

- Keep source text out of logs, argv, environment values, and telemetry.
- Automatic rewriting is off unless a versioned config enables it.
- Preserve the primary Pi message metadata and usage. Secondary usage is telemetry only.
- Run `npm run check` before changing documentation claims and `npm run verify` before release or PR handoff. Do not make provider calls in tests.
- Use Writing Core for technical prose, README Improver for `README.md`, PR Description for PR copy, and the matching Writing Check profile on each final candidate. Vale findings are advisory and cannot override technical or safety language.
