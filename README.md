# pi-session-summary

Print token, cache, cost, call, and elapsed-time totals when quitting Pi's TUI.
No model calls, commands, settings, background tasks, or transcript writes.

## Install

Requires **Pi 0.87.1+** and **Node.js 24+**. Development dependencies pin 0.87.1;
newer Pi versions are intended targets, not a guarantee against upstream API changes.

Clone this repository and register the checkout as a local Pi package:

```sh
pi install /absolute/path/to/session-summary
```

Pi loads a local package in place (no copy) and this package has no runtime
dependencies, so no `npm install` is needed to use it. Run `/reload` in existing
Pi instances. Or try it once with `pi -e ./index.ts` from this directory.

To opt out for one run without uninstalling:

```sh
pi --no-session-summary
```

To scope the totals to the current branch instead of the whole session file:

```sh
pi --session-summary-scope branch
```

Unknown scope values fall back to `all`.

## Meaning of the totals

- Tokens and costs cover **all entries in the current session file** by default,
  including other branches and history from before this Pi invocation
  (the header reads "all branches"). Pass `--session-summary-scope branch`
  to count only the current branch's ancestor chain; a null leaf (empty branch
  after `resetLeaf`) reports zeros. Entries that cannot be placed on the chain
  (missing ids) are still counted rather than silently dropped, and an
  unresolvable leaf falls back to all entries with the header
  "all branches (current branch unavailable)". They include assistant responses, nested tool usage,
  compaction, branch summaries, and standalone usage entries such as cache
  warming. Abandoned branches inflate the totals beyond the current leaf path;
  this matches Pi's own `/usage` accounting, which also sums all entries.
- Cache hit percentage is `cacheRead / (input + cacheRead + cacheWrite)`.
  It describes recorded prompt usage, not cache residency or the next request.
  Cache *writes* count toward the "miss (incl. writes)" side of the split.
- Model calls count assistant messages (one message is one response); tool
  calls count completed tool results ("1 tool result" / "2 tool results").
  One assistant message may request several tools, and summary/warming operations contribute usage but no call counts.
  Assistant messages without usage (aborted, errored, or legacy entries) are
  counted but contribute zero tokens rather than crashing or printing NaN.
- Run time starts at the latest `session_start`; it is not cumulative session
  age. When the extension loads mid-session, the load time is the fallback
  start until the next `session_start`.
- Costs are Pi's recorded estimates, not an invoice. Unreported usage is not inferred.

Output goes directly to the terminal on **TUI quit only**. Reload, new/resume/fork,
RPC, print, and JSON modes remain silent. Nothing is added to model context.

Caveat: on ordinary quit Pi stops the TUI (terminal restore) before running
`session_shutdown` handlers, so the summary lands on a restored terminal.
On signal-driven shutdown (SIGTERM/SIGHUP) the order is reversed and the
terminal may be gone; the write is then best-effort and failure-silent by
design. A summary must never interrupt shutdown.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm pack --dry-run
```

The small offline suite checks accounting, quit-only output, runtime reset,
malformed-usage tolerance, shutdown-failure silence, and the opt-out flag.
Only the entry point, README, license, and manifest ship. `node_modules/` and
`package-lock.json` are local development artifacts. No build step is needed;
Pi supplies its SDK at runtime.

[MIT](LICENSE) © 2026 Michael Brunner.
