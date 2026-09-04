# Speak Human

Speak Human is a Pi package that can replace an eligible finalized assistant response with a bounded rewrite. It starts disabled. A failed rewrite always leaves the original response unchanged.

## Install

Pi can install Speak Human from Git or a local checkout. This project isn't published to the npm registry.

```sh
pi install git:github.com/safurrier/speak-human
```

For local development:

```sh
pi install /path/to/speak-human
```

Restart Pi after installation, then run `/speak-human doctor`. The package manifest loads `extensions/speak-human.ts`. The repository's verification suite also packs the project, performs a production-only install in a temporary directory, and confirms through Pi's remote procedure call (RPC) API that the installed extension registers `/speak-human`.

## Configure and check

Create `~/.config/speak-human/config.json`, or set `SPEAK_HUMAN_CONFIG_PATH` to an explicit JSON file:

```json
{
  "schemaVersion": 1,
  "enabledByDefault": false,
  "backend": {
    "kind": "loopback",
    "config": {
      "url": "http://127.0.0.1:8080",
      "model": "local-model",
      "timeoutMs": 10000
    }
  }
}
```

Run `/speak-human doctor` first. It validates configuration and route availability without sending source text. Then use `/speak-human on` and `/speak-human status`. Status reports the enabled state, backend, safe route, disclosure boundary, timeout, and prior outcome. `/speak-human show-original` exposes only the latest in-memory original and clears on lifecycle changes.

Loopback is credential-free local HTTP only. Command and Pi-native backends require `allowRemoteSource: true` because the route may be remote. Pi-native selection uses only the explicit ordered model list, session scope, availability, and configured auth. It never changes the active model.

## Development

```sh
npm ci
npm run check
npm run verify
```

`npm run check` runs strict TypeScript, formatting, and deterministic tests. `npm run verify` also checks the package contents, performs an isolated production install, and confirms Pi extension discovery over RPC. Tests do not call Qwen, Luna, or another provider.

## Support

| Runtime     | Status                                                                |
| ----------- | --------------------------------------------------------------------- |
| Pi 0.84.3   | Supported package target. Deterministic lifecycle behavior is tested. |
| Claude Code | Display probe only. Canonical replacement is unverified.              |
| Codex       | No native replacement support.                                        |

Read [SPEC.md](SPEC.md) for the protocol and privacy boundary. Exact preservation checks are not semantic or factual proof. Real Pi terminal user interface (TUI) persistence and real-provider dogfood remain manual validation.
