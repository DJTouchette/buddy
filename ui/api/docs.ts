import { readdir, stat } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import type { ApiContext } from "./context";
import { handler, errorResponse } from "./helpers";

const DOCS_BASE = resolve(
  process.env.HOME || "/home/djtouchette",
  "work/cassadol/docs/agents"
);

interface TreeEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeEntry[];
}

async function buildTree(dir: string): Promise<TreeEntry[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const result: TreeEntry[] = [];

  for (const entry of entries.sort((a, b) => {
    // Directories first, then files
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  })) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(DOCS_BASE, fullPath);

    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: relPath,
        type: "directory",
        children: await buildTree(fullPath),
      });
    } else if (entry.name.endsWith(".md")) {
      result.push({
        name: entry.name,
        path: relPath,
        type: "file",
      });
    }
  }

  return result;
}

function isPathSafe(requestedPath: string): boolean {
  const resolved = resolve(DOCS_BASE, requestedPath);
  return resolved.startsWith(DOCS_BASE);
}

export function docsRoutes(_ctx: ApiContext) {
  return {
    "/api/docs/tree": {
      GET: handler(async () => {
        const tree = await buildTree(DOCS_BASE);
        return Response.json({ tree, basePath: DOCS_BASE });
      }),
    },

    "/api/docs/file": {
      GET: handler(async (req: Request) => {
        const url = new URL(req.url);
        const filePath = url.searchParams.get("path");
        if (!filePath) {
          return errorResponse("path parameter is required", 400);
        }
        if (!isPathSafe(filePath)) {
          return errorResponse("Invalid path", 403);
        }

        const fullPath = resolve(DOCS_BASE, filePath);
        const file = Bun.file(fullPath);
        if (!(await file.exists())) {
          return errorResponse("File not found", 404);
        }

        const content = await file.text();
        return Response.json({ path: filePath, content });
      }),

      PUT: handler(async (req: Request) => {
        const body = (await req.json()) as { path: string; content: string };
        if (!body.path || typeof body.content !== "string") {
          return errorResponse("path and content are required", 400);
        }
        if (!isPathSafe(body.path)) {
          return errorResponse("Invalid path", 403);
        }

        const fullPath = resolve(DOCS_BASE, body.path);
        await Bun.write(fullPath, body.content);
        return Response.json({ path: body.path, saved: true });
      }),
    },
  };
}
