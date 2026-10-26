# pi-session-summary

> **Disclaimer:** This extension is vibe coded for personal use. Use at your own risk.

See what a [Pi](https://pi.dev) session used when you quit: tokens, cache usage,
estimated cost, model calls, tool results and run time, printed to the terminal.

## Why

- Once a session ends, it's easy to lose track of what it actually used in tokens, cache and cost.
- Seeing the numbers on every quit builds a feel for typical sessions and how they change over time.

## Features

- A summary printed when you quit the TUI.
- Covers the whole session file, or only the current branch if you ask for it.
- Totals match Pi's own `/usage` numbers.
- No model calls, commands, settings, background tasks or changes to the transcript.
- Never blocks or interrupts shutdown.

## Installation

Requires **Pi 0.87.1+** and **Node.js 24+**.

```sh
pi install git:github.com/shardrunner/pi-session-summary
```

Run `/reload` in open Pi sessions. Update with `pi update --extensions`.
For local development, install a checkout instead
(`pi install /absolute/path/to/pi-session-summary`) or try it once with
`pi -e ./index.ts`. No runtime dependencies, no build step.

## Usage

Quit Pi normally to see the summary. Options:

```sh
pi --no-session-summary                 # skip the summary for this run
pi --session-summary-scope branch       # count only the current branch
```

Unknown scope values fall back to `all`.

## Behavior and limitations

- **Scope:** by default, every entry in the session file is counted, including other
  branches and earlier runs (shown as "all branches"). Abandoned branches therefore add
  to the totals. With `branch`, only the path to the current entry is counted. If that
  path can't be worked out, the summary falls back to all entries and says so in the
  header.
- **Cache hit rate** is `cacheRead / (input + cacheRead + cacheWrite)`. Cache writes
  count as misses. It describes past usage, not what is cached now.
- **Calls:** model calls are assistant messages; tool calls are completed tool results.
  Summaries and cache warming add tokens but no calls. Messages without usage data count
  as zero instead of breaking the totals.
- **Run time** starts at the latest session start, not when the session was created.
- **Costs** are Pi's recorded estimates, not an invoice.
- **When it prints:** only when you quit the TUI. Reload, new/resume/fork, RPC, print
  and JSON modes print nothing, and nothing is added to the model context. On a normal
  quit the terminal is restored before the summary prints. On a signal (SIGTERM/SIGHUP)
  the terminal may already be gone, so printing is best-effort and fails silently.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm pack --dry-run
```

Requires Node.js 24+. The offline test suite covers the totals, printing only on quit,
run-time resets, broken usage data, silent failure at shutdown and the opt-out flag.
Only the entry point, README, license and manifest are published.

## License

[MIT](LICENSE) © 2026 Michael Brunner
