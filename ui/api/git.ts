import type { ApiContext } from "./context";
import { CACHE_KEY_PRS } from "./context";
import { RepoService } from "../../services/repoService";
import { handler, errorResponse } from "./helpers";

// Base branches with descriptions
const BASE_BRANCH_INFO: Record<string, string> = {
  nextrelease: "New features or prepping for QA",
  master: "Bug fixes only",
};

export function gitRoutes(ctx: ApiContext) {
  return {
    // GET /api/git/pr-info - Get info needed for PR creation
    "/api/git/pr-info": {
      GET: handler(async (req: Request) => {
        const selectedRepo = ctx.cacheService.getSelectedRepo();
        if (!selectedRepo) {
          return errorResponse("No repository selected. Go to Git page and select a repo first.", 400);
        }

        const url = new URL(req.url);
        const targetBranch = url.searchParams.get("target");

        const repoService = new RepoService();
        const currentBranch = await repoService.getCurrentBranch(selectedRepo.path);

        if (!currentBranch) {
          return errorResponse("Could not determine current branch", 500);
        }

        // Get upstream/tracking branch
        const upstreamBranch = await repoService.getUpstreamBranch(selectedRepo.path);

        // Get remote branches for target selector
        const remoteBranches = await repoService.getRemoteBranches(selectedRepo.path);

        // Get base branches from config
        const baseBranches = await ctx.configService.getBaseBranches();

        // Get the parent branch (closest base branch the current branch was created from)
        const parentBranch = await repoService.getParentBranch(selectedRepo.path, baseBranches);

        // Check if branch is pushed
        const isPushed = await repoService.isBranchPushed(selectedRepo.path, currentBranch);

        // If target is specified, get the diff info
        let changedFiles = null;
        let commits = null;

        if (targetBranch) {
          changedFiles = await repoService.getChangedFiles(selectedRepo.path, targetBranch);
          commits = await repoService.getCommits(selectedRepo.path, targetBranch);
        }

        return Response.json({
          repo: selectedRepo,
          currentBranch,
          upstreamBranch,
          parentBranch,
          isPushed,
          remoteBranches,
          baseBranches,
          targetBranch,
          changedFiles,
          commits,
        });
      }),
    },

    // GET /api/git/diff - Get diff for a target branch
    "/api/git/diff": {
      GET: handler(async (req: Request) => {
        const selectedRepo = ctx.cacheService.getSelectedRepo();
        if (!selectedRepo) {
          return errorResponse("No repository selected", 400);
        }

        const url = new URL(req.url);
        const targetBranch = url.searchParams.get("target");
        const filePath = url.searchParams.get("file");

        if (!targetBranch) {
          return errorResponse("Target branch is required", 400);
        }

        const repoService = new RepoService();

        let diff: string | null;
        if (filePath) {
          diff = await repoService.getFileDiff(selectedRepo.path, targetBranch, filePath);
        } else {
          diff = await repoService.getDiff(selectedRepo.path, targetBranch);
        }

        if (diff === null) {
          return errorResponse("Failed to get diff", 500);
        }

        return Response.json({ diff });
      }),
    },

    // POST /api/git/push - Push current branch to remote
    "/api/git/push": {
      POST: handler(async () => {
        const selectedRepo = ctx.cacheService.getSelectedRepo();
        if (!selectedRepo) {
          return errorResponse("No repository selected", 400);
        }

        const repoService = new RepoService();
        const currentBranch = await repoService.getCurrentBranch(selectedRepo.path);

        if (!currentBranch) {
          return errorResponse("Could not determine current branch", 500);
        }

        const result = await repoService.pushBranch(selectedRepo.path, currentBranch);

        if (!result.success) {
          return errorResponse(result.error!, 500);
        }

        return Response.json({ success: true, branch: currentBranch });
      }),
    },

    // POST /api/git/create-pr - Create a pull request
    "/api/git/create-pr": {
      POST: handler(async (req: Request) => {
        const selectedRepo = ctx.cacheService.getSelectedRepo();
        if (!selectedRepo) {
          return errorResponse("No repository selected", 400);
        }

        const body = await req.json() as {
          title: string;
          description: string;
          targetBranch: string;
          isDraft: boolean;
        };

        if (!body.title || !body.targetBranch) {
          return errorResponse("Title and target branch are required", 400);
        }

        const repoService = new RepoService();
        const currentBranch = await repoService.getCurrentBranch(selectedRepo.path);

        if (!currentBranch) {
          return errorResponse("Could not determine current branch", 500);
        }

        // Make sure branch is pushed
        const isPushed = await repoService.isBranchPushed(selectedRepo.path, currentBranch);
        if (!isPushed) {
          const pushResult = await repoService.pushBranch(selectedRepo.path, currentBranch);
          if (!pushResult.success) {
            return errorResponse(`Failed to push branch: ${pushResult.error}`, 500);
          }
        }

        // Create PR using Azure DevOps service
        const { azureDevOpsService } = await ctx.getServices();
        const pr = await azureDevOpsService.createPullRequest(
          currentBranch,
          body.targetBranch,
          body.title,
          body.description,
          body.isDraft
        );

        // Invalidate PR cache
        ctx.cacheService.invalidate(CACHE_KEY_PRS);

        return Response.json({ success: true, pr });
      }),
    },

    // GET /api/git/base-branches - Get base branches with descriptions
    "/api/git/base-branches": {
      GET: handler(async () => {
        const baseBranches = await ctx.configService.getBaseBranches();
        const branches = baseBranches.map((branch) => ({
          name: branch,
          description: BASE_BRANCH_INFO[branch.toLowerCase()] || null,
        }));
        return Response.json({ branches });
      }),
    },

    // POST /api/git/checkout-base - Checkout a base branch
    "/api/git/checkout-base": {
      POST: handler(async (req: Request) => {
        const selectedRepo = ctx.cacheService.getSelectedRepo();
        if (!selectedRepo) {
          return errorResponse("No repository selected. Go to Git page and select a repo first.", 400);
        }

        const body = (await req.json()) as { branch: string };

        if (!body.branch) {
          return errorResponse("Missing branch name", 400);
        }

        const repoService = new RepoService();
        const result = await repoService.checkoutBaseBranch(selectedRepo.path, body.branch);

        if (!result.success) {
          return errorResponse(result.error!, 500);
        }

        return Response.json({
          success: true,
          branch: body.branch,
          repoName: selectedRepo.name,
        });
      }),
    },

    // GET /api/git/current-branch - Current branch of selected repo
    "/api/git/current-branch": {
      GET: handler(async () => {
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
      }),
    },

    // POST /api/git/checkout-ticket - Checkout a ticket (create new branch)
    "/api/git/checkout-ticket": {
      POST: handler(async (req: Request) => {
        const selectedRepo = ctx.cacheService.getSelectedRepo();
        if (!selectedRepo) {
          return errorResponse("No repository selected. Go to Git page and select a repo first.", 400);
        }

        const body = (await req.json()) as {
          ticketKey: string;
          ticketTitle: string;
          baseBranch: string;
        };

        if (!body.ticketKey || !body.ticketTitle || !body.baseBranch) {
          return errorResponse("Missing required fields", 400);
        }

        const repoService = new RepoService();
        const result = await repoService.checkoutTicket(
          selectedRepo.path,
          body.ticketKey,
          body.ticketTitle,
          body.baseBranch
        );

        if (!result.success) {
          return errorResponse(result.error!, 500);
        }

        return Response.json({
          success: true,
          branchName: result.branchName,
          repoName: selectedRepo.name,
          repoPath: selectedRepo.path,
        });
      }),
    },

    // POST /api/git/checkout-pr - Checkout a PR branch
    "/api/git/checkout-pr": {
      POST: handler(async (req: Request) => {
        const selectedRepo = ctx.cacheService.getSelectedRepo();
        if (!selectedRepo) {
          return errorResponse("No repository selected. Go to Git page and select a repo first.", 400);
        }

        const body = (await req.json()) as { branchName: string };

        if (!body.branchName) {
          return errorResponse("Missing branch name", 400);
        }

        const repoService = new RepoService();
        const result = await repoService.checkoutPR(selectedRepo.path, body.branchName);

        if (!result.success) {
          return errorResponse(result.error!, 500);
        }

        return Response.json({
          success: true,
          branchName: body.branchName,
          repoName: selectedRepo.name,
          repoPath: selectedRepo.path,
        });
      }),
    },

    // GET /api/git/ticket-branch/:ticketKey - Find existing branch for ticket
    "/api/git/ticket-branch/:ticketKey": {
      GET: handler(async (req: Request) => {
        const selectedRepo = ctx.cacheService.getSelectedRepo();
        if (!selectedRepo) {
          return Response.json({ branch: null, repo: null });
        }

        const url = new URL(req.url);
        const ticketKey = url.pathname.split("/").pop();

        if (!ticketKey) {
          return errorResponse("Missing ticket key", 400);
        }

        const repoService = new RepoService();
        const branch = await repoService.findBranchForTicket(selectedRepo.path, ticketKey);

        return Response.json({
          branch,
          repo: selectedRepo,
        });
      }),
    },
  };
}
