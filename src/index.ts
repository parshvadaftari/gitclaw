#!/usr/bin/env node

import { createInterface } from "readline";
import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { loadAgent } from "./loader.js";
import { createCliTool } from "./tools/cli.js";
import { createReadTool } from "./tools/read.js";
import { createWriteTool } from "./tools/write.js";
import { createMemoryTool } from "./tools/memory.js";
import { readFile } from "fs/promises";
import { join } from "path";

// ANSI helpers
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

function parseArgs(argv: string[]): { model?: string; dir: string; prompt?: string } {
	const args = argv.slice(2);
	let model: string | undefined;
	let dir = process.cwd();
	let prompt: string | undefined;

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--model":
			case "-m":
				model = args[++i];
				break;
			case "--dir":
			case "-d":
				dir = args[++i];
				break;
			case "--prompt":
			case "-p":
				prompt = args[++i];
				break;
			default:
				if (!args[i].startsWith("-")) {
					prompt = args[i];
				}
				break;
		}
	}

	return { model, dir, prompt };
}

function handleEvent(event: AgentEvent): void {
	switch (event.type) {
		case "message_update": {
			const e = event.assistantMessageEvent;
			if (e.type === "text_delta") {
				process.stdout.write(e.delta);
			}
			break;
		}
		case "message_end":
			process.stdout.write("\n");
			break;
		case "tool_execution_start":
			process.stdout.write(dim(`\n▶ ${event.toolName}(${summarizeArgs(event.args)})\n`));
			break;
		case "tool_execution_end": {
			if (event.isError) {
				process.stdout.write(red(`✗ ${event.toolName} failed\n`));
			} else {
				const result = event.result;
				const text = result?.content?.[0]?.text || "";
				const preview = text.length > 200 ? text.slice(0, 200) + "…" : text;
				if (preview) {
					process.stdout.write(dim(preview) + "\n");
				}
			}
			break;
		}
		case "agent_end":
			break;
	}
}

function summarizeArgs(args: any): string {
	if (!args) return "";
	const entries = Object.entries(args);
	if (entries.length === 0) return "";

	return entries
		.map(([k, v]) => {
			const str = typeof v === "string" ? v : JSON.stringify(v);
			const short = str.length > 60 ? str.slice(0, 60) + "…" : str;
			return `${k}: ${short}`;
		})
		.join(", ");
}

async function main(): Promise<void> {
	const { model, dir, prompt } = parseArgs(process.argv);

	let loaded;
	try {
		loaded = await loadAgent(dir, model);
	} catch (err: any) {
		console.error(red(`Error: ${err.message}`));
		process.exit(1);
	}

	const { systemPrompt, manifest } = loaded;

	const agent = new Agent({
		initialState: {
			systemPrompt,
			model: loaded.model,
			tools: [
				createCliTool(dir),
				createReadTool(dir),
				createWriteTool(dir),
				createMemoryTool(dir),
			],
		},
	});

	agent.subscribe(handleEvent);

	console.log(bold(`${manifest.name} v${manifest.version}`));
	console.log(dim(`Model: ${loaded.model.provider}:${loaded.model.id}`));
	console.log(dim(`Tools: ${manifest.tools.join(", ")}`));
	console.log(dim('Type /memory to view memory, /quit to exit\n'));

	// Single-shot mode
	if (prompt) {
		await agent.prompt(prompt);
		return;
	}

	// REPL mode
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const ask = (): void => {
		rl.question(green("→ "), async (input) => {
			const trimmed = input.trim();

			if (!trimmed) {
				ask();
				return;
			}

			if (trimmed === "/quit" || trimmed === "/exit") {
				rl.close();
				process.exit(0);
			}

			if (trimmed === "/memory") {
				try {
					const mem = await readFile(join(dir, "memory/MEMORY.md"), "utf-8");
					console.log(dim("--- memory ---"));
					console.log(mem.trim() || "(empty)");
					console.log(dim("--- end ---"));
				} catch {
					console.log(dim("(no memory file)"));
				}
				ask();
				return;
			}

			try {
				await agent.prompt(trimmed);
			} catch (err: any) {
				console.error(red(`Error: ${err.message}`));
			}

			ask();
		});
	};

	// Handle Ctrl+C during streaming
	rl.on("SIGINT", () => {
		if (agent.state.isStreaming) {
			agent.abort();
		} else {
			console.log("\nBye!");
			rl.close();
			process.exit(0);
		}
	});

	ask();
}

main().catch((err) => {
	console.error(red(`Fatal: ${err.message}`));
	process.exit(1);
});
