# Command-line protocol

The `speak-human` command reads one bounded UTF-8 JSON object from standard input and writes one JSON object to standard output. It never accepts source text in arguments or environment values.

## Check a backend

```sh
speak-human doctor
```

Input:

```json
{
  "schema_version": 1,
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

A valid configuration returns:

```json
{ "schema_version": 1, "status": "ok", "backend": "loopback" }
```

`doctor` validates configuration only. It does not contact the backend.

## Rewrite text

```sh
speak-human rewrite
```

Add a `text` string to the doctor envelope. A successful invocation returns `schema_version: 1` plus the bounded rewrite outcome. The outcome status is `rewrite`, `no_change`, or `rejected`.

Input larger than 64 KiB, malformed JSON, unknown fields, invalid configuration, or an unsupported action returns a nonzero exit and a fixed error on standard error. Errors never echo the request, source, completion, executable path, or environment.

The portable CLI supports loopback and generic command backends. Pi-native completion belongs to the Pi extension because it requires the active Pi model registry and authentication context.
