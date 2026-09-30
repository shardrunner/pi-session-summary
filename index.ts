import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// NOTE: Pi does not re-export the `Usage` type or the `usage-totals`
// helpers from the extension SDK entry point, so this extension keeps a
// small structural, tolerance-first copy instead of deep-importing SDK
// internals (which would couple us to its dist layout). Field access is
// defensive: old session files, aborted/errored responses, and future SDK
// shapes must never crash quit or poison totals with NaN.

type UsageLike = {
	input?: unknown;
	output?: unknown;
	cacheRead?: unknown;
	cacheWrite?: unknown;
	totalTokens?: unknown;
	cost?: unknown;
};

type Totals = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: number;
	modelCalls: number;
	toolCalls: number;
};

const FLAG_OFF = "no-session-summary";
const FLAG_SCOPE = "session-summary-scope";

type Scope = "all" | "branch";

function toNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function costTotal(usage: UsageLike): number {
	const cost = usage.cost;
	if (isRecord(cost)) return toNumber(cost.total);
	return toNumber(cost);
}

function addUsage(totals: Totals, usage: unknown): void {
	if (!isRecord(usage)) return;
	const u = usage as UsageLike;
	totals.input += toNumber(u.input);
	totals.output += toNumber(u.output);
	totals.cacheRead += toNumber(u.cacheRead);
	totals.cacheWrite += toNumber(u.cacheWrite);
	totals.totalTokens += toNumber(u.totalTokens);
	totals.cost += costTotal(u);
}

function formatTokens(tokens: number): string {
	return new Intl.NumberFormat("en-US", { useGrouping: true, maximumFractionDigits: 0 }).format(
		Math.round(toNumber(tokens)),
	);
}

function formatDuration(milliseconds: number): string {
	const totalSeconds = Math.max(0, Math.floor(toNumber(milliseconds) / 1_000));
	const days = Math.floor(totalSeconds / 86_400);
	const hours = Math.floor((totalSeconds % 86_400) / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	const seconds = totalSeconds % 60;

	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
	return parts.join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function collectTotals(entries: unknown, leafId?: unknown, branchOnly = false): { totals: Totals; effectiveScope: Scope } {
	const totals: Totals = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: 0,
		modelCalls: 0,
		toolCalls: 0,
	};
	if (!Array.isArray(entries)) return { totals, effectiveScope: branchOnly && leafId === null ? "branch" : "all" };

	// Explicit null leaf means Pi reset the leaf pointer (empty current
	// branch): there is nothing to count, which is distinct from an unknown
	// leaf where scoping is impossible and we fall back to all entries.
	if (branchOnly && leafId === null) return { totals, effectiveScope: "branch" };

	// Branch scope: keep only entries on the current leaf's ancestor chain.
	// Entries without usable id/parentId links (legacy shapes) opt out of
	// filtering and are counted, since dropping them would under-report.
	let allowed: Set<string> | null = null;
	if (branchOnly && typeof leafId === "string" && leafId.length > 0) {
		const byId = new Map<string, Record<string, unknown>>();
		for (const item of entries) {
			if (isRecord(item) && typeof item.id === "string") byId.set(item.id, item);
		}
		if (byId.has(leafId)) {
			allowed = new Set<string>();
			let current: string | null = leafId;
			while (typeof current === "string" && !allowed.has(current)) {
				allowed.add(current);
				const node = byId.get(current);
				const parent = node?.parentId;
				current = typeof parent === "string" ? parent : null;
			}
		}
	}
	// Without an ancestor set, an unknown or unusable leaf falls back to all entries.

	for (const item of entries) {
		if (!isRecord(item)) continue;
		if (allowed !== null) {
			if (typeof item.id === "string") {
				if (!allowed.has(item.id)) continue;
		}
		// ID-less entries cannot be placed on the chain; count them rather
		// than silently dropping billable usage.
		}
		const type = item.type;
		if (type === "message") {
			const message = isRecord(item.message) ? item.message : undefined;
			if (message?.role === "assistant") {
				// One assistant message is one model response. Usage may be
				// absent (aborted/errored/legacy entries): count the response,
				// add usage only when present.
				totals.modelCalls++;
			} else if (message?.role === "toolResult") {
				// One toolResult message is one completed tool execution.
				// A single assistant message may request several tools, so
				// this is a message count, not a distinct-tool count.
				totals.toolCalls++;
			} else {
				continue;
			}
			addUsage(totals, message.usage);
		} else if (type === "branch_summary" || type === "compaction" || type === "usage") {
			addUsage(totals, item.usage);
		}
		// All other entry types (user messages, custom state, labels,
		// session_info, model/thinking changes) carry no billable usage.
	}

	return { totals, effectiveScope: allowed === null ? "all" : "branch" };
}

export default function (pi: ExtensionAPI) {
	let startedAt = Date.now();

	pi.registerFlag(FLAG_OFF, {
		description: "Suppress the session summary printed on TUI quit.",
		type: "boolean",
		default: false,
	});

	pi.registerFlag(FLAG_SCOPE, {
		description: "Session summary scope: 'all' entries in the session file or 'branch' for the current branch only.",
		type: "string",
		default: "all",
	});

	pi.on("session_start", () => {
		startedAt = Date.now();
	});

	pi.on("session_shutdown", (event, ctx) => {
		// Cosmetic feature: never break quit, reload, or session switching.
		try {
			if (event?.reason !== "quit" || ctx?.mode !== "tui") return;
			// Strict === true: a string "false" must never suppress output.
			if (pi.getFlag(FLAG_OFF) === true) return;
			const branchRequested = pi.getFlag(FLAG_SCOPE) === "branch";

			let leafId: unknown;
			if (branchRequested) {
				try {
					leafId = ctx.sessionManager.getLeafId?.();
				} catch {
					leafId = undefined;
				}
			}
			const { totals, effectiveScope } = collectTotals(ctx.sessionManager.getEntries(), leafId, branchRequested);

			const promptTokens = totals.input + totals.cacheRead + totals.cacheWrite;
			const cache =
				promptTokens === 0
					? "n/a"
					: `${((totals.cacheRead / promptTokens) * 100).toFixed(1)}% hit, ${(((totals.input + totals.cacheWrite) / promptTokens) * 100).toFixed(1)}% miss (incl. writes)`;

			// Ordering (verified in Pi 0.86.1 interactive-mode.js): on ordinary
			// quit Pi stops the TUI (terminal restore) before disposing the
			// extension host, so this write lands on a restored terminal.
			// On signal-driven shutdown (SIGTERM/SIGHUP) the order is reversed
			// and the terminal may be gone, so the write is best-effort.
			const scopeLabel =
				effectiveScope === "branch"
					? "current branch"
					: branchRequested
						? "all branches (current branch unavailable)"
						: "all branches";
			const toolNoun = totals.toolCalls === 1 ? "tool result" : "tool results";
			const summary =
				`\nSession summary (${scopeLabel})\n` +
				`  Tokens: ${formatTokens(totals.totalTokens)} total ` +
				`(${formatTokens(promptTokens)} prompt, ${formatTokens(totals.output)} output)\n` +
				`  Cache: ${cache}\n` +
				`  Cost: $${totals.cost.toFixed(4)}\n` +
				`  Calls: ${totals.modelCalls} model, ${totals.toolCalls} ${toolNoun}\n` +
				`  Run time: ${formatDuration(Date.now() - startedAt)}\n\n`;
			const out = process.stdout;
			if (out.destroyed) return;
			// Node can emit 'error' after invoking the failed write's callback.
			// Protect this write without replacing existing host error handlers.
			const ignoreError = () => undefined;
			const cleanup = () => out.removeListener("error", ignoreError);
			out.once("error", ignoreError);
			try {
				out.write(summary, (error) => {
					if (error) setImmediate(cleanup).unref();
					else cleanup();
				});
			} catch {
				cleanup();
			}
		} catch {
			// Intentionally silent: a summary must never interrupt shutdown.
		}
	});
}
