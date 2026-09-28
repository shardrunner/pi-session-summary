# pi-session-summary

Print token, cache, cost, call, and elapsed-time totals when quitting Pi's TUI.
No model calls, commands, settings, background tasks, or transcript writes.

## Install

Requires **Pi 0.86.1+** and **Node.js 24+**. Development dependencies pin 0.86.1;
newer Pi versions are intended targets, not a guarantee against upstream API changes.

Clone this repository and register the checkout as a local Pi package:

```sh
pi install /absolute/path/to/session-summary
```

Pi loads a local package in place (no copy) and this package has no runtime
dependencies, so no `npm install` is needed to use it. Run `/reload` in existing
Pi instances. Or try it once with `pi -e ./index.ts` from this directory.

## Meaning of the totals

- Tokens and costs cover **all entries in the current session file**, including
  other branches and history from before this Pi invocation. They include
  assistant responses, nested tool usage, compaction, branch summaries, and
  standalone usage entries such as cache warming.
- Cache hit percentage is `cacheRead / (input + cacheRead + cacheWrite)`.
  It describes recorded prompt usage, not cache residency or the next request.
- Model calls count assistant messages; tool calls count tool results. Nested
  calls and summary/warming operations contribute usage but not extra call counts.
- Run time starts at the latest `session_start`; it is not cumulative session age.
- Costs are Pi's recorded estimates, not an invoice. Unreported usage is not inferred.

Output goes directly to the terminal on **TUI quit only**. Reload, new/resume/fork,
RPC, print, and JSON modes remain silent. Nothing is added to model context.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm pack --dry-run
```

The small offline suite checks accounting, quit-only output, and runtime reset.
Only the entry point, README, license, and manifest ship. No build step is needed;
Pi supplies its SDK at runtime.

[MIT](LICENSE) © 2026 Michael Brunner.
