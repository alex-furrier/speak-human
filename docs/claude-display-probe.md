# Claude display probe

This is a disposable capability probe, not an adapter. Use a temporary Claude configuration directory and a single test session. Do not install a persistent hook, edit an existing hook file, or send a production conversation.

1. Configure a `MessageDisplay` hook that adds a visible marker to one assistant display message.
2. Run one isolated session that produces a known short response.
3. Close it, then inspect only that temporary session transcript and configuration.
4. Remove the temporary directory.

Record whether the marker appeared in the display and whether it appeared in the persisted transcript. If rendering changes but persistence does not, classify the result as display transformation only. If the hook schema or persistence behavior differs from this procedure, do not claim canonical replacement.
