import { readFile } from "fs/promises";
import { resolve } from "path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

const MAX_LINES = 2000;
const MAX_BYTES = 100_000;

function resolvePath(path: string, cwd: string): string {
	return path.startsWith("/") ? path : resolve(cwd, path);
}

function isBinary(buffer: Buffer): boolean {
	// Check first 8KB for null bytes
	const check = buffer.subarray(0, 8192);
	for (let i = 0; i < check.length; i++) {
		if (check[i] === 0) return true;
	}
	return false;
}

export function createReadTool(cwd: string): AgentTool<typeof readSchema> {
	return {
		name: "read",
		label: "read",
		description: `Read the contents of a file. Output is limited to ${MAX_LINES} lines or ~100KB. Use offset/limit for large files.`,
		parameters: readSchema,
		execute: async (
			_toolCallId: string,
			{ path, offset, limit }: { path: string; offset?: number; limit?: number },
			signal?: AbortSignal,
		) => {
			if (signal?.aborted) throw new Error("Operation aborted");

			const absolutePath = resolvePath(path, cwd);
			const buffer = await readFile(absolutePath);

			if (isBinary(buffer)) {
				return {
					content: [{ type: "text", text: `[Binary file: ${path} (${buffer.length} bytes)]` }],
					details: undefined,
				};
			}

			const text = buffer.toString("utf-8");
			const allLines = text.split("\n");
			const totalLines = allLines.length;

			// Apply offset (1-indexed)
			const startLine = offset ? Math.max(0, offset - 1) : 0;
			if (startLine >= totalLines) {
				throw new Error(`Offset ${offset} is beyond end of file (${totalLines} lines)`);
			}

			// Apply limit
			const maxLines = limit ?? MAX_LINES;
			const endLine = Math.min(startLine + maxLines, totalLines);
			let selected = allLines.slice(startLine, endLine).join("\n");

			// Byte limit
			let truncatedByBytes = false;
			if (Buffer.byteLength(selected, "utf-8") > MAX_BYTES) {
				selected = selected.slice(0, MAX_BYTES);
				truncatedByBytes = true;
			}

			let result = selected;
			const shownLines = endLine - startLine;
			const hasMore = endLine < totalLines || truncatedByBytes;

			if (hasMore) {
				const nextOffset = endLine + 1;
				result += `\n\n[Showing lines ${startLine + 1}-${endLine} of ${totalLines}. Use offset=${nextOffset} to continue.]`;
			}

			return {
				content: [{ type: "text", text: result }],
				details: undefined,
			};
		},
	};
}
