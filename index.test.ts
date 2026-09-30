import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import register from "./index.ts";

function harness(
	t: test.TestContext,
	entries: unknown[] = [],
	mode = "tui",
	options: {
		getEntriesThrows?: boolean;
		flag?: boolean | string;
		flags?: Record<string, boolean | string | undefined>;
		leafId?: string | null;
		noLeafMethod?: boolean;
	} = {},
) {
	const handlers = new Map<string, (event: any, ctx: ExtensionContext) => void>();
	register({
		on: (name: string, handler: any) => {
			handlers.set(name, handler);
		},
		registerFlag: () => {},
		getFlag: (name: string) => {
			if (options.flags && name in options.flags) return options.flags[name];
			if (name === "no-session-summary") return options.flag;
			return undefined;
		},
	} as unknown as ExtensionAPI);
	let output = "";
	const writeMock = t.mock.method(process.stdout, "write", (text: string) => {
		output += text;
		return true;
	});
	const sessionManager: Record<string, unknown> = {
			getEntries: () => {
				if (options.getEntriesThrows) throw new Error("boom");
				return entries as SessionEntry[];
			},
		};
		if (!options.noLeafMethod) sessionManager.getLeafId = () => options.leafId ?? null;
		const ctx = {
			mode,
			sessionManager,
		} as unknown as ExtensionContext;
	return {
		emit: (name: string, event: unknown) => handlers.get(name)!(event, ctx),
		output: () => output,
		writeMock,
	};
}

const usage = {
	input: 10,
	output: 20,
	cacheRead: 30,
	cacheWrite: 40,
	totalTokens: 100,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.1 },
};

test("counts assistant, nested tool, summary, and standalone usage without inventing calls", (t) => {
	const h = harness(t, [
		{ type: "message", message: { role: "assistant", usage } },
		{
			type: "message",
			message: {
				role: "toolResult",
				usage,
				// Parent usage already includes nested calls; diagnostics are not additional usage.
				nestedCalls: { complete: true, calls: [{ id: "parent/1", name: "nested", status: "ok", usage }] },
				details: { calls: [{ usage, cost: usage.cost }] },
			},
		},
		{ type: "message", message: { role: "toolResult" } },
		{ type: "message", message: { role: "user", usage } },
		{ type: "compaction", usage },
		{ type: "branch_summary", usage },
		{ type: "usage", kind: "cache_warm", usage },
		{ type: "usage", kind: "another-operation", usage },
		{ type: "custom", data: { usage } },
	]);
	h.emit("session_shutdown", { reason: "quit" });
	assert.match(h.output(), /Tokens: 600 total \(480 prompt, 120 output\)/);
	assert.match(h.output(), /Cache: 37\.5% hit, 62\.5% miss/);
	assert.match(h.output(), /Cost: \$0\.6000/);
	assert.match(h.output(), /Calls: 1 model, 2 tool/);
});

test("empty sessions report no cache observation and runtime starts at session_start", (t) => {
	let now = 0;
	t.mock.method(Date, "now", () => now);
	const h = harness(t);
	now = 10_000;
	h.emit("session_start", {});
	now += 3_661_000;
	h.emit("session_shutdown", { reason: "quit" });
	assert.match(h.output(), /Tokens: 0 total/);
	assert.match(h.output(), /Cache: n\/a/);
	assert.match(h.output(), /Run time: 1h 1m 1s/);
});

test("does not write on session replacement or reload", (t) => {
	const h = harness(t);
	for (const reason of ["reload", "new", "resume", "fork"]) h.emit("session_shutdown", { reason });
	assert.equal(h.output(), "");
});

for (const mode of ["rpc", "json", "print"]) {
	test(`does not pollute ${mode} output`, (t) => {
		const h = harness(t, [], mode);
		h.emit("session_shutdown", { reason: "quit" });
		assert.equal(h.output(), "");
	});
}

test("ignores assistant messages without usage instead of crashing", (t) => {
	const h = harness(t, [
		{ type: "message", message: { role: "assistant" } },
		{ type: "message", message: { role: "assistant", usage } },
		{ type: "message", message: { role: "toolResult" } },
		{ type: "compaction" },
		{ type: "branch_summary" },
		{ type: "usage", kind: "cache_warm" },
		{ type: "custom", data: { usage } },
		{ type: "message", message: { role: "user" } },
	]);
	h.emit("session_shutdown", { reason: "quit" });
	assert.match(h.output(), /Tokens: 100 total \(80 prompt, 20 output\)/);
	assert.match(h.output(), /Cost: \$0\.1000/);
	assert.match(h.output(), /Calls: 2 model, 1 tool/);
});

test("tolerates malformed usage without NaN", (t) => {
	const h = harness(t, [
		{
			type: "message",
			message: {
				role: "assistant",
				usage: { input: "10", output: Number.NaN, cacheRead: undefined, cacheWrite: null, totalTokens: 50 },
			},
		},
		{ type: "message", message: { role: "toolResult", usage: "garbage" } },
		{ type: "usage", kind: "x", usage: { input: 5, cost: { total: "bad" } } },
	]);
	h.emit("session_shutdown", { reason: "quit" });
	assert.match(h.output(), /Tokens: 50 total/);
	assert.match(h.output(), /Cost: \$0\.0000/);
	assert.doesNotMatch(h.output(), /NaN/);
});

test("never throws when getEntries fails", (t) => {
	const h = harness(t, [], "tui", { getEntriesThrows: true });
	assert.doesNotThrow(() => h.emit("session_shutdown", { reason: "quit" }));
	assert.equal(h.output(), "");
});

test("never throws when stdout fails", (t) => {
	const h = harness(t);
	h.writeMock.mock.restore();
	t.mock.method(process.stdout, "write", () => {
		throw new Error("EPIPE");
	});
	assert.doesNotThrow(() => h.emit("session_shutdown", { reason: "quit" }));
});

test("never throws when stdout fails asynchronously", (t) => {
	const h = harness(t);
	let captured: ((error?: Error) => void) | undefined;
	h.writeMock.mock.restore();
	t.mock.method(process.stdout, "write", (_text: string, callback?: (error?: Error) => void) => {
		captured = callback;
		return true;
	});
	assert.doesNotThrow(() => h.emit("session_shutdown", { reason: "quit" }));
	// An async EPIPE delivered to the write callback must not throw either.
	assert.ok(captured, "write callback not captured");
	assert.doesNotThrow(() => captured!(new Error("EPIPE")));
});

test("respects --no-session-summary flag", (t) => {
	const h = harness(t, [{ type: "message", message: { role: "assistant", usage } }], "tui", { flag: true });
	h.emit("session_shutdown", { reason: "quit" });
	assert.equal(h.output(), "");
});

test("formats long durations with days and omits zero parts", (t) => {
	let now = 0;
	t.mock.method(Date, "now", () => now);
	const h = harness(t);
	now = 1_000;
	h.emit("session_start", {});
	// 2d 3h 5s, with zero minutes omitted.
	now += (2 * 86_400 + 3 * 3_600 + 5) * 1_000;
	h.emit("session_shutdown", { reason: "quit" });
	assert.match(h.output(), /Run time: 2d 3h 5s/);
});

test("groups large token counts instead of compact notation", (t) => {
	const big = { ...usage, input: 1_234_567, totalTokens: 1_234_587 };
	const h = harness(t, [{ type: "message", message: { role: "assistant", usage: big } }]);
	h.emit("session_shutdown", { reason: "quit" });
	assert.match(h.output(), /1,234,637 prompt/);
	assert.doesNotMatch(h.output(), /1\.2M/);
});

test("branch scope excludes abandoned branch entries", (t) => {
	const onBranch = { ...usage, totalTokens: 100 };
	const offBranch = { ...usage, totalTokens: 900 };
	const entries = [
		{ type: "message", id: "a", parentId: null, message: { role: "assistant", usage: onBranch } },
		{ type: "message", id: "b", parentId: "a", message: { role: "assistant", usage: offBranch } },
		{ type: "message", id: "c", parentId: "a", message: { role: "assistant", usage: onBranch } },
	];
	const h = harness(t, entries, "tui", {
		flags: { "session-summary-scope": "branch" },
		leafId: "c",
	});
	h.emit("session_shutdown", { reason: "quit" });
	assert.match(h.output(), /Session summary \(current branch\)/);
	assert.match(h.output(), /Tokens: 200 total/);
	assert.doesNotMatch(h.output(), /1,000 total/);
});

test("branch scope stops at cycles and includes ID-less usage", (t) => {
	const h = harness(t, [
		{ type: "message", id: "a", parentId: "b", message: { role: "assistant", usage } },
		{ type: "message", id: "b", parentId: "a", message: { role: "assistant", usage } },
		{ type: "message", id: "off", parentId: null, message: { role: "assistant", usage } },
		{ type: "usage", usage },
	], "tui", {
		flags: { "session-summary-scope": "branch" },
		leafId: "b",
	});
	h.emit("session_shutdown", { reason: "quit" });
	assert.match(h.output(), /Session summary \(current branch\)/);
	assert.match(h.output(), /Tokens: 300 total \(240 prompt, 60 output\)/);
	assert.match(h.output(), /Cost: \$0\.3000/);
	assert.match(h.output(), /Calls: 2 model, 0 tool results/);
});

test("branch scope falls back to all entries when the leaf is unknown", (t) => {
	const entries = [
		{ type: "message", id: "a", parentId: null, message: { role: "assistant", usage } },
		{ type: "message", id: "b", parentId: "a", message: { role: "assistant", usage } },
	];
	const h = harness(t, entries, "tui", {
		flags: { "session-summary-scope": "branch" },
		leafId: "missing-leaf",
	});
	h.emit("session_shutdown", { reason: "quit" });
	assert.match(h.output(), /Session summary \(all branches \(current branch unavailable\)\)/);
	assert.match(h.output(), /Tokens: 200 total/);
});

test("branch scope with a null leaf reports an empty current branch", (t) => {
	const entries = [
		{ type: "message", id: "a", parentId: null, message: { role: "assistant", usage } },
	];
	const h = harness(t, entries, "tui", {
		flags: { "session-summary-scope": "branch" },
		leafId: null,
	});
	h.emit("session_shutdown", { reason: "quit" });
	assert.match(h.output(), /Session summary \(current branch\)/);
	assert.match(h.output(), /Tokens: 0 total/);
	assert.match(h.output(), /Calls: 0 model, 0 tool results/);
});

test("branch scope without getLeafId falls back and says so", (t) => {
	const entries = [
		{ type: "message", id: "a", parentId: null, message: { role: "assistant", usage } },
	];
	const h = harness(t, entries, "tui", {
		flags: { "session-summary-scope": "branch" },
		noLeafMethod: true,
	});
	h.emit("session_shutdown", { reason: "quit" });
	assert.match(h.output(), /Session summary \(all branches \(current branch unavailable\)\)/);
	assert.match(h.output(), /Tokens: 100 total/);
});

test("unknown scope values fall back to all branches", (t) => {
	const h = harness(t, [{ type: "message", message: { role: "assistant", usage } }], "tui", {
		flags: { "session-summary-scope": "everything" },
	});
	h.emit("session_shutdown", { reason: "quit" });
	assert.match(h.output(), /Session summary \(all branches\)/);
});

test("a string flag value never suppresses the summary", (t) => {
	const h = harness(t, [{ type: "message", message: { role: "assistant", usage } }], "tui", {
		flags: { "no-session-summary": "false" as unknown as boolean },
	});
	h.emit("session_shutdown", { reason: "quit" });
	assert.match(h.output(), /Session summary/);
});

test("uses singular tool result noun for a single result", (t) => {
	const h = harness(t, [{ type: "message", message: { role: "toolResult" } }]);
	h.emit("session_shutdown", { reason: "quit" });
	assert.match(h.output(), /Calls: 0 model, 1 tool result\n/);
});
