import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { startUIServer } from "../ui/server";

interface UIArgs {
  port?: number;
}

export const uiCommand: CommandModule<{}, UIArgs> = {
  command: "ui",
  describe: "Launch web UI for viewing tickets and PRs",
  builder: (yargs) =>
    yargs
      .option("port", {
        alias: "p",
        type: "number",
        default: 8080,
        describe: "Port to run the web server on",
      })
      .strict(),
  handler: async (argv: ArgumentsCamelCase<UIArgs>) => {
    const port = argv.port || 8080;
    console.log(`Starting Buddy UI on http://localhost:${port}`);
    await startUIServer(port);
  },
};
