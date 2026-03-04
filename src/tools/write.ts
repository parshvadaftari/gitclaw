import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

const writeSchema = Type.Object({
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Content to write to the file" }),
	createDirs: Type.Optional(Type.Boolean({ description: "Create parent directories if needed (default: true)" })),
});

function resolvePath(path: string, cwd: string): string {
	return path.startsWith("/") ? path : resolve(cwd, path);
}

export function createWriteTool(cwd: string): AgentTool<typeof writeSchema> {
	return {
		name: "write",
		label: "write",
		description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Parent directories are created automatically.",
		parameters: writeSchema,
		execute: async (
			_toolCallId: string,
			{ path, content, createDirs }: { path: string; content: string; createDirs?: boolean },
			signal?: AbortSignal,
		) => {
			if (signal?.aborted) throw new Error("Operation aborted");

			const absolutePath = resolvePath(path, cwd);

			if (createDirs !== false) {
				await mkdir(dirname(absolutePath), { recursive: true });
			}

			await writeFile(absolutePath, content, "utf-8");

			const bytes = Buffer.byteLength(content, "utf-8");
			return {
				content: [{ type: "text", text: `Wrote ${bytes} bytes to ${path}` }],
				details: undefined,
			};
		},
	};
}
