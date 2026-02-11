import type { ApiContext } from "./context";
import { RepoService } from "../../services/repoService";
import { handler, errorResponse } from "./helpers";

export function reposRoutes(ctx: ApiContext) {
  return {
    // GET /api/repos - Get all repos
    "/api/repos": {
      GET: handler(async () => {
        const repos = ctx.cacheService.getRepos();
        const selectedRepo = ctx.cacheService.getSelectedRepo();
        return Response.json({ repos, selectedRepo });
      }),
    },

    // POST /api/repos/scan - Scan for repos
    "/api/repos/scan": {
      POST: handler(async () => {
        const repoService = new RepoService();
        const repos = await repoService.scanForRepos();

        // Clear existing and save new repos
        ctx.cacheService.clearRepos();
        ctx.cacheService.saveRepos(
          repos.map((r) => ({
            path: r.path,
            name: r.name,
            isWsl: r.isWsl,
            lastScanned: Date.now(),
          }))
        );

        const savedRepos = ctx.cacheService.getRepos();
        return Response.json({ repos: savedRepos, count: savedRepos.length });
      }),
    },

    // GET/PUT /api/repos/selected - Selected repo
    "/api/repos/selected": {
      GET: handler(async () => {
        const selectedRepo = ctx.cacheService.getSelectedRepo();
        return Response.json({ selectedRepo });
      }),
      PUT: handler(async (req: Request) => {
        const body = (await req.json()) as { repoId: number | null };
        ctx.cacheService.setSelectedRepoId(body.repoId);
        const selectedRepo = ctx.cacheService.getSelectedRepo();
        return Response.json({ selectedRepo });
      }),
    },

    // GET /api/repos/:id/status - Repo git status
    "/api/repos/:id/status": {
      GET: handler(async (req: Request) => {
        const repoId = parseInt((req as any).params.id);
        const repos = ctx.cacheService.getRepos();
        const repo = repos.find((r) => r.id === repoId);

        if (!repo) {
          return errorResponse("Repo not found", 404);
        }

        const repoService = new RepoService();
        const status = await repoService.getRepoStatus(repo.path);
        const branch = await repoService.getCurrentBranch(repo.path);

        return Response.json({ status, branch, repo });
      }),
    },
  };
}
