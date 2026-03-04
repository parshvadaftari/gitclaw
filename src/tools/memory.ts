import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

const memorySchema = Type.Object({
	action: StringEnum(["load", "save"], { description: "Whether to load or save memory" }),
	content: Type.Optional(Type.String({ description: "Memory content to save (required for save)" })),
	message: Type.Optional(Type.String({ description: "Commit message describing why this memory changed (required for save)" })),
});

const MEMORY_PATH = "memory/MEMORY.md";

export function createMemoryTool(cwd: string): AgentTool<typeof memorySchema> {
	return {
		name: "memory",
		label: "memory",
		description:
			"Git-backed memory. Use 'load' to read current memory, 'save' to update memory and commit to git. Each save creates a git commit, giving you full history of what you've remembered.",
		parameters: memorySchema,
		execute: async (
			_toolCallId: string,
			{ action, content, message }: { action: string; content?: string; message?: string },
			signal?: AbortSignal,
		) => {
			if (signal?.aborted) throw new Error("Operation aborted");

			const memoryFile = join(cwd, MEMORY_PATH);

			if (action === "load") {
				try {
					const text = await readFile(memoryFile, "utf-8");
					const trimmed = text.trim();
					if (!trimmed || trimmed === "# Memory") {
						return {
							content: [{ type: "text", text: "No memories yet." }],
							details: undefined,
						};
					}
					return {
						content: [{ type: "text", text: trimmed }],
						details: undefined,
					};
				} catch {
					return {
						content: [{ type: "text", text: "No memories yet." }],
						details: undefined,
					};
				}
			}

			// action === "save"
			if (!content) {
				throw new Error("content is required for save action");
			}

			const commitMsg = message || "Update memory";

			await writeFile(memoryFile, content, "utf-8");

			try {
				execSync(`git add "${MEMORY_PATH}" && git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, {
					cwd,
					stdio: "pipe",
				});
			} catch (err: any) {
				// If git fails (e.g., not a git repo), still report the write succeeded
				const stderr = err.stderr?.toString() || "";
				return {
					content: [
						{
							type: "text",
							text: `Memory saved to ${MEMORY_PATH} but git commit failed: ${stderr.trim() || "unknown error"}. The file was still written.`,
						},
					],
					details: undefined,
				};
			}

			return {
				content: [{ type: "text", text: `Memory saved and committed: "${commitMsg}"` }],
				details: undefined,
			};
		},
	};
}
