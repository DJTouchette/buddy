#! /usr/bin/env bun
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// import command modules
import { loginCommand } from "./commands/login";
import { sourceControlCommand } from "./commands/sourceControlCommand";
import { jiraCommand } from "./commands/jiraCommand";
import { prCommand } from "./commands/prCommand";
import { mcpCommand } from "./commands/mcpCommand";
import { configCommand } from "./commands/configCommand";
import { uiCommand } from "./commands/uiCommand";

yargs(hideBin(process.argv))
  .scriptName("bud")
  .command(loginCommand)
  .command(sourceControlCommand)
  .command(jiraCommand)
  .command(prCommand)
  .command(mcpCommand)
  .command(configCommand)
  .command(uiCommand)
  .demandCommand()
  .strict()
  .help()
  .parse();
