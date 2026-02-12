import type { CommandModule } from "yargs";
import { RepoService } from "../services/repoService";

export const repoCommand: CommandModule = {
  command: "repo <command>",
  describe: "Repository scanning and management",
  builder: (yargs) => {
    return yargs
      .command({
        command: "scan",
        describe: "Scan for git repositories and list what was found",
        handler: async () => {
          try {
            const repoService = new RepoService();
            console.log("Scanning for repositories...\n");

            const repos = await repoService.scanForRepos((msg) => {
              console.log(`  ${msg}`);
            });

            console.log("");

            if (repos.length === 0) {
              console.log("No repositories found.");
            } else {
              console.log(`Found ${repos.length} repositor${repos.length === 1 ? "y" : "ies"}:\n`);
              for (const repo of repos) {
                const branch = await repoService.getCurrentBranch(repo.path);
                const branchStr = branch ? ` (${branch})` : "";
                console.log(`  ${repo.name}${branchStr}`);
                console.log(`    ${repo.path}`);
              }
            }
          } catch (error) {
            console.error(`Error: ${error}`);
            process.exit(1);
          }
        },
      })
      .demandCommand()
      .help();
  },
  handler: () => {},
};
