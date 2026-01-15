import type { ApiContext } from "./context";
import { RepoService } from "../../services/repoService";

export function reposRoutes(ctx: ApiContext) {
  return {
    // GET /api/repos - Get all repos
    "/api/repos": {
      GET: async () => {
        try {
          const repos = ctx.cacheService.getRepos();
          const selectedRepo = ctx.cacheService.getSelectedRepo();
          return Response.json({ repos, selectedRepo });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // POST /api/repos/scan - Scan for repos
    "/api/repos/scan": {
      POST: async () => {
        try {
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
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET/PUT /api/repos/selected - Selected repo
    "/api/repos/selected": {
      GET: async () => {
        try {
          const selectedRepo = ctx.cacheService.getSelectedRepo();
          return Response.json({ selectedRepo });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
      PUT: async (req: Request) => {
        try {
          const body = (await req.json()) as { repoId: number | null };
          ctx.cacheService.setSelectedRepoId(body.repoId);
          const selectedRepo = ctx.cacheService.getSelectedRepo();
          return Response.json({ selectedRepo });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/repos/:id/status - Repo git status
    "/api/repos/:id/status": {
      GET: async (req: Request & { params: { id: string } }) => {
        try {
          const repoId = parseInt(req.params.id);
          const repos = ctx.cacheService.getRepos();
          const repo = repos.find((r) => r.id === repoId);

          if (!repo) {
            return Response.json({ error: "Repo not found" }, { status: 404 });
          }

          const repoService = new RepoService();
          const status = await repoService.getRepoStatus(repo.path);
          const branch = await repoService.getCurrentBranch(repo.path);

          return Response.json({ status, branch, repo });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },
  };
}
