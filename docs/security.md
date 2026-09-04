# Security and data boundary

The response is authoritative input, not a request for fact gathering. No backend failure triggers another backend. The original response remains byte-for-byte unchanged unless a candidate passes the parser and preservation checks.

Loopback transport is credential-free and local-only by URL validation. Command transport is treated as potentially remote. It cannot receive response prose unless configuration sets `allowRemoteSource` to true. The host cannot prevent a trusted command from logging or transmitting its input after that consent.

Speak Human does not write source or candidate prose to telemetry, logs, errors, process arguments, environment variables, or temporary prompt files. Preservation checks detect selected exact changes but do not prove semantic equivalence, factual correctness, or safe interpretation.
