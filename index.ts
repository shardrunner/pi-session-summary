import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Usage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: { total: number };
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

function formatTokens(tokens: number): string {
	return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(tokens);
}

function formatDuration(milliseconds: number): string {
	const seconds = Math.floor(milliseconds / 1_000);
	const hours = Math.floor(seconds / 3_600);
	const minutes = Math.floor((seconds % 3_600) / 60);
	const remainingSeconds = seconds % 60;

	if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`;
	if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
	return `${remainingSeconds}s`;
}

function addUsage(totals: Totals, usage: Usage): void {
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cacheRead += usage.cacheRead;
	totals.cacheWrite += usage.cacheWrite;
	totals.totalTokens += usage.totalTokens;
	totals.cost += usage.cost.total;
}

export default function (pi: ExtensionAPI) {
	let startedAt = Date.now();

	pi.on("session_start", () => {
		startedAt = Date.now();
	});

	pi.on("session_shutdown", (event, ctx) => {
		if (event.reason !== "quit" || ctx.mode !== "tui") return;

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

		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				addUsage(totals, entry.message.usage as Usage);
				totals.modelCalls++;
			} else if (entry.type === "message" && entry.message.role === "toolResult") {
				totals.toolCalls++;
				if (entry.message.usage) addUsage(totals, entry.message.usage as Usage);
			} else if ((entry.type === "branch_summary" || entry.type === "compaction" || entry.type === "usage") && entry.usage) {
				addUsage(totals, entry.usage as Usage);
			}
		}

		const promptTokens = totals.input + totals.cacheRead + totals.cacheWrite;
		const cache = promptTokens === 0
			? "n/a"
			: `${(totals.cacheRead / promptTokens * 100).toFixed(1)}% hit, ${((totals.input + totals.cacheWrite) / promptTokens * 100).toFixed(1)}% miss`;

		process.stdout.write(
			`\nSession summary\n` +
			`  Tokens: ${formatTokens(totals.totalTokens)} total ` +
			`(${formatTokens(promptTokens)} prompt, ${formatTokens(totals.output)} output)\n` +
			`  Cache: ${cache}\n` +
			`  Cost: $${totals.cost.toFixed(4)}\n` +
			`  Calls: ${totals.modelCalls} model, ${totals.toolCalls} tool\n` +
			`  Run time: ${formatDuration(Date.now() - startedAt)}\n\n`,
		);
	});
}
