import type { CommandModule, ArgumentsCamelCase } from "yargs";

interface LoginArgs {
  env: string;
}

export const loginCommand: CommandModule<unknown, LoginArgs> = {
  command: "login",
  describe: "Authenticate with BI services",
  builder: y =>
    y
      .option("env", {
        alias: "e",
        type: "string",
        choices: ["dev", "prod"] as const,
        default: "prod",
        describe: "Environment to log in to",
      })
      .strict(),

  handler: async (argv: ArgumentsCamelCase<LoginArgs>) => {
    console.log(`Logging in to ${argv.env}...`);
    // argv.env is string here, but only "dev"/"prod" are allowed at runtime
  },
};
