import { readFile } from "fs/promises";
import { join } from "path";
import { getModel } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import yaml from "js-yaml";

export interface AgentManifest {
	spec_version: string;
	name: string;
	version: string;
	description: string;
	model: {
		preferred: string;
		fallback: string[];
	};
	tools: string[];
	runtime: {
		max_turns: number;
	};
}

async function readFileOr(path: string, fallback: string): Promise<string> {
	try {
		return await readFile(path, "utf-8");
	} catch {
		return fallback;
	}
}

function parseModelString(modelStr: string): { provider: string; modelId: string } {
	const colonIndex = modelStr.indexOf(":");
	if (colonIndex === -1) {
		throw new Error(
			`Invalid model format: "${modelStr}". Expected "provider:model" (e.g., "anthropic:claude-sonnet-4-5-20250929")`,
		);
	}
	return {
		provider: modelStr.slice(0, colonIndex),
		modelId: modelStr.slice(colonIndex + 1),
	};
}

export interface LoadedAgent {
	systemPrompt: string;
	manifest: AgentManifest;
	model: Model<any>;
}

export async function loadAgent(agentDir: string, modelFlag?: string): Promise<LoadedAgent> {
	// Parse agent.yaml
	const manifestRaw = await readFile(join(agentDir, "agent.yaml"), "utf-8");
	const manifest = yaml.load(manifestRaw) as AgentManifest;

	// Read identity files
	const soul = await readFileOr(join(agentDir, "SOUL.md"), "");
	const rules = await readFileOr(join(agentDir, "RULES.md"), "");

	// Build system prompt
	const parts: string[] = [];

	parts.push(`# ${manifest.name} v${manifest.version}\n${manifest.description}`);

	if (soul) {
		parts.push(soul);
	}

	if (rules) {
		parts.push(rules);
	}

	parts.push(
		`# Memory\n\nYou have a memory file at memory/MEMORY.md. Use the \`memory\` tool to load and save memories. Each save creates a git commit, so your memory has full history. You can also use the \`cli\` tool to run git commands for deeper memory inspection (git log, git diff, git show).`,
	);

	const systemPrompt = parts.join("\n\n");

	// Resolve model
	const modelStr = modelFlag || manifest.model.preferred;
	if (!modelStr) {
		throw new Error(
			'No model configured. Either:\n  - Set model.preferred in agent.yaml (e.g., "anthropic:claude-sonnet-4-5-20250929")\n  - Pass --model provider:model on the command line',
		);
	}

	const { provider, modelId } = parseModelString(modelStr);
	const model = getModel(provider as any, modelId as any);

	return { systemPrompt, manifest, model };
}
