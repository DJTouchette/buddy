import type { CommandModule } from "yargs";
import { spawn } from "bun";
import path from "path";

export const mcpCommand: CommandModule = {
  command: "mcp <subcommand>",
  describe: "MCP server commands",
  builder: (yargs) => {
    return yargs
      .command({
        command: "serve",
        describe: "Start the MCP server (for Claude Code integration)",
        handler: async () => {
          // Check if we're running from a compiled executable
          const isCompiled = Bun.main.endsWith(".exe") || !Bun.main.includes("index.ts");

          if (isCompiled) {
            // Running from compiled executable - import and run directly
            const { startMcpServer } = await import("../mcp-server.js");
            await startMcpServer();
          } else {
            // Running from source - spawn bun to run mcp-server.ts
            const serverPath = path.join(import.meta.dir, "..", "mcp-server.ts");

            const proc = spawn({
              cmd: ["bun", serverPath],
              stdio: ["inherit", "inherit", "inherit"],
              env: process.env,
            });

            const exitCode = await proc.exited;
            process.exit(exitCode);
          }
        },
      })
      .demandCommand()
      .help();
  },
  handler: () => {},
};
