import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { SourceControlService } from "../services/sourceControlService";

interface BranchArgs {
  name: string;
  checkout: boolean;
}

interface AddArgs {
  files: string[];
}

interface PushArgs {
  setUpstream: boolean;
}

interface WorkflowArgs {
  branch: string;
  message?: string;
  files: string[];
}

export const sourceControlCommand: CommandModule = {
  command: "sc <command>",
  describe: "Source control operations",
  builder: (yargs) =>
    yargs
      .command({
        command: "branch <name>",
        describe: "Create a new branch",
        builder: (y) =>
          y
            .positional("name", {
              type: "string",
              describe: "Name of the branch to create",
              demandOption: true,
            })
            .option("checkout", {
              alias: "c",
              type: "boolean",
              default: true,
              describe: "Checkout the branch after creating it",
            })
            .strict(),
        handler: async (argv: ArgumentsCamelCase<BranchArgs>) => {
          try {
            const git = await SourceControlService.create();
            await git.createBranch(argv.name, argv.checkout);
          } catch (error) {
            console.error(`Error creating branch: ${error}`);
            process.exit(1);
          }
        },
      })
      .command({
        command: "add [files..]",
        describe: "Stage files for commit",
        builder: (y) =>
          y
            .positional("files", {
              type: "string",
              array: true,
              default: ["."],
              describe: "Files to add (defaults to all files)",
            })
            .strict(),
        handler: async (argv: ArgumentsCamelCase<AddArgs>) => {
          try {
            const git = await SourceControlService.create();
            await git.addFiles(argv.files);
          } catch (error) {
            console.error(`Error adding files: ${error}`);
            process.exit(1);
          }
        },
      })
      .command({
        command: "push",
        describe: "Push current branch to remote",
        builder: (y) =>
          y
            .option("set-upstream", {
              alias: "u",
              type: "boolean",
              default: true,
              describe: "Set upstream branch",
            })
            .strict(),
        handler: async (argv: ArgumentsCamelCase<PushArgs>) => {
          try {
            const git = await SourceControlService.create();
            await git.push(argv.setUpstream);
          } catch (error) {
            console.error(`Error pushing: ${error}`);
            process.exit(1);
          }
        },
      })
      .command({
        command: "workflow <branch>",
        describe: "Create branch, add files, commit, and push",
        builder: (y) =>
          y
            .positional("branch", {
              type: "string",
              describe: "Name of the branch to create",
              demandOption: true,
            })
            .option("message", {
              alias: "m",
              type: "string",
              describe: "Commit message",
            })
            .option("files", {
              alias: "f",
              type: "array",
              default: ["."],
              describe: "Files to add",
            })
            .strict(),
        handler: async (argv: ArgumentsCamelCase<WorkflowArgs>) => {
          try {
            const git = await SourceControlService.create();

            // Check if branch already exists
            const exists = await git.branchExists(argv.branch);
            if (exists) {
              console.error(`Branch '${argv.branch}' already exists`);
              process.exit(1);
            }

            // Create and checkout branch
            await git.createBranch(argv.branch);

            // Add files
            await git.addFiles(argv.files as string[]);

            // Commit
            const message = argv.message || `feat: ${argv.branch}`;
            await git.commit(message);

            // Push with upstream
            await git.push(true);

            console.log(`\n✓ Workflow complete!`);
          } catch (error) {
            console.error(`Error in workflow: ${error}`);
            process.exit(1);
          }
        },
      })
      .demandCommand()
      .strict(),
  handler: () => {},
};
