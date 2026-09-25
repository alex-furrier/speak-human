# Claude Code display probe

Claude Code 2.1.211 supports display-only response transformation through `MessageDisplay`. It does not replace the persisted assistant message.

## Observed behavior

The isolated hook received one JSON object containing `hook_event_name: "MessageDisplay"`, message and turn identifiers, `index`, `final`, and the newly completed text in `delta`. It returned:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "MessageDisplay",
    "displayContent": "DISPLAY_TRANSFORMED"
  }
}
```

Claude Code printed `DISPLAY_TRANSFORMED`. The temporary session transcript retained the original assistant text and did not contain the replacement marker. This proves display transformation, not canonical transcript replacement.

The probe used a temporary Claude configuration, a trivial response, and no tools. It did not install a persistent hook or inspect a production conversation. Authentication was unavailable in the temporary profile, but the `MessageDisplay` hook still transformed the resulting assistant error message and provided enough evidence to compare display and persistence.

## Support boundary

Speak Human does not ship a Claude Code adapter in V0. A future display adapter could use the shared command-line interface, but it must be labeled display-only. A wrapper that owns `claude -p` output could provide canonical wrapper output without changing Claude Code's interactive transcript.
