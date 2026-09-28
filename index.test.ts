import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import register from "./index.ts";

function harness(t: test.TestContext, entries: unknown[] = [], mode = "tui") {
	const handlers = new Map<string, (event: any, ctx: ExtensionContext) => void>();
	register({ on: (name: string, handler: any) => { handlers.set(name, handler); } } as ExtensionAPI);
	let output = "";
	t.mock.method(process.stdout, "write", (text: string) => { output += text; return true; });
	const ctx = {
		mode,
		sessionManager: { getEntries: () => entries as SessionEntry[] },
	} as ExtensionContext;
	return {
		emit: (name: string, event: unknown) => handlers.get(name)!(event, ctx),
		output: () => output,
	};
}

const usage = {
	input: 10, output: 20, cacheRead: 30, cacheWrite: 40, totalTokens: 100,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.1 },
};

test("counts assistant, nested tool, summary, and standalone usage without inventing calls", (t) => {
	const h = harness(t, [
		{ type: "message", message: { role: "assistant", usage } },
		{ type: "message", message: { role: "toolResult", usage } },
		{ type: "message", message: { role: "toolResult" } },
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
