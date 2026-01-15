import type { ApiContext } from "./context";
import { RepoService } from "../../services/repoService";

// Base branches with descriptions
const BASE_BRANCH_INFO: Record<string, string> = {
  nextrelease: "New features or prepping for QA",
  master: "Bug fixes only",
};

export function gitRoutes(ctx: ApiContext) {
  return {
    // GET /api/git/base-branches - Get base branches with descriptions
    "/api/git/base-branches": {
      GET: async () => {
        try {
          const baseBranches = await ctx.configService.getBaseBranches();
          const branches = baseBranches.map((branch) => ({
            name: branch,
            description: BASE_BRANCH_INFO[branch.toLowerCase()] || null,
          }));
          return Response.json({ branches });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // POST /api/git/checkout-base - Checkout a base branch
    "/api/git/checkout-base": {
      POST: async (req: Request) => {
        try {
          const selectedRepo = ctx.cacheService.getSelectedRepo();
          if (!selectedRepo) {
            return Response.json(
              { error: "No repository selected. Go to Git page and select a repo first." },
              { status: 400 }
            );
          }

          const body = (await req.json()) as { branch: string };

          if (!body.branch) {
            return Response.json({ error: "Missing branch name" }, { status: 400 });
          }

          const repoService = new RepoService();
          const result = await repoService.checkoutBaseBranch(selectedRepo.path, body.branch);

          if (!result.success) {
            return Response.json({ error: result.error }, { status: 500 });
          }

          return Response.json({
            success: true,
            branch: body.branch,
            repoName: selectedRepo.name,
          });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/git/current-branch - Current branch of selected repo
    "/api/git/current-branch": {
      GET: async () => {
        try {
          const selectedRepo = ctx.cacheService.getSelectedRepo();
          if (!selectedRepo) {
            return Response.json({ branch: null, repo: null });
          }

          const repoService = new RepoService();
          const branch = await repoService.getCurrentBranch(selectedRepo.path);

          return Response.json({
            branch,
            repo: selectedRepo,
          });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // POST /api/git/checkout-ticket - Checkout a ticket (create new branch)
    "/api/git/checkout-ticket": {
      POST: async (req: Request) => {
        try {
          const selectedRepo = ctx.cacheService.getSelectedRepo();
          if (!selectedRepo) {
            return Response.json(
              { error: "No repository selected. Go to Git page and select a repo first." },
              { status: 400 }
            );
          }

          const body = (await req.json()) as {
            ticketKey: string;
            ticketTitle: string;
            baseBranch: string;
          };

          if (!body.ticketKey || !body.ticketTitle || !body.baseBranch) {
            return Response.json({ error: "Missing required fields" }, { status: 400 });
          }

          const repoService = new RepoService();
          const result = await repoService.checkoutTicket(
            selectedRepo.path,
            body.ticketKey,
            body.ticketTitle,
            body.baseBranch
          );

          if (!result.success) {
            return Response.json({ error: result.error }, { status: 500 });
          }

          return Response.json({
            success: true,
            branchName: result.branchName,
            repoName: selectedRepo.name,
            repoPath: selectedRepo.path,
          });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // POST /api/git/checkout-pr - Checkout a PR branch
    "/api/git/checkout-pr": {
      POST: async (req: Request) => {
        try {
          const selectedRepo = ctx.cacheService.getSelectedRepo();
          if (!selectedRepo) {
            return Response.json(
              { error: "No repository selected. Go to Git page and select a repo first." },
              { status: 400 }
            );
          }

          const body = (await req.json()) as { branchName: string };

          if (!body.branchName) {
            return Response.json({ error: "Missing branch name" }, { status: 400 });
          }

          const repoService = new RepoService();
          const result = await repoService.checkoutPR(selectedRepo.path, body.branchName);

          if (!result.success) {
            return Response.json({ error: result.error }, { status: 500 });
          }

          return Response.json({
            success: true,
            branchName: body.branchName,
            repoName: selectedRepo.name,
            repoPath: selectedRepo.path,
          });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },
  };
}
