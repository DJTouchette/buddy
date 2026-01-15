import type { ApiContext } from "./context";

export function jiraRoutes(ctx: ApiContext) {
  return {
    // GET /api/jira/search - Search Jira issues
    "/api/jira/search": {
      GET: async (req: Request) => {
        try {
          const url = new URL(req.url);
          const query = url.searchParams.get("q") || "";

          if (!query.trim()) {
            return Response.json({ issues: [], error: "Query is required" }, { status: 400 });
          }

          const { jiraService, jiraConfig } = await ctx.getServices();

          // Build JQL query - search in summary, description, or key
          // If query looks like a ticket key (e.g., CAS-123), search by key
          const isTicketKey = /^[A-Z]+-\d+$/i.test(query.trim());
          let jql: string;

          if (isTicketKey) {
            jql = `key = "${query.trim().toUpperCase()}"`;
          } else {
            // Search in summary and description, escape quotes
            const escapedQuery = query.replace(/"/g, '\\"');
            jql = `summary ~ "${escapedQuery}" OR description ~ "${escapedQuery}" ORDER BY updated DESC`;
          }

          const issues = await jiraService.searchIssues(jql, 25);

          return Response.json({
            issues,
            jiraHost: jiraConfig.host,
            query,
          });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET/PUT /api/jira/config - JIRA configuration (board ID)
    "/api/jira/config": {
      GET: async () => {
        try {
          const jiraConfig = await ctx.configService.getJiraConfig();
          return Response.json({
            boardId: jiraConfig?.boardId || null,
            hasConfig: !!(jiraConfig?.host && jiraConfig?.email && jiraConfig?.apiToken),
          });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
      PUT: async (req: Request) => {
        try {
          const body = (await req.json()) as { boardId?: number | null };
          const jiraConfig = await ctx.configService.getJiraConfig();

          await ctx.configService.setJiraConfig({
            ...jiraConfig,
            boardId: body.boardId ?? undefined,
          });

          // Invalidate cache since board order might change
          ctx.cacheService.invalidateAll();

          return Response.json({ success: true, boardId: body.boardId });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/jira/attachment/* - Proxy JIRA attachments
    "/api/jira/attachment/*": {
      GET: async (req: Request) => {
        try {
          const jiraConfig = await ctx.configService.getJiraConfig();
          if (!jiraConfig?.host || !jiraConfig?.email || !jiraConfig?.apiToken) {
            return Response.json({ error: "JIRA not configured" }, { status: 500 });
          }

          // Get the attachment path from the URL
          const url = new URL(req.url);
          const pathParts = url.pathname.split("/api/jira/attachment/");
          if (pathParts.length < 2) {
            return Response.json({ error: "Invalid attachment path" }, { status: 400 });
          }

          const attachmentPath = pathParts[1];
          const attachmentUrl = `${jiraConfig.host}/rest/api/3/attachment/content/${attachmentPath}`;

          // Fetch with auth
          const auth = btoa(`${jiraConfig.email}:${jiraConfig.apiToken}`);
          const response = await fetch(attachmentUrl, {
            headers: {
              Authorization: `Basic ${auth}`,
            },
          });

          if (!response.ok) {
            return new Response("Attachment not found", { status: response.status });
          }

          // Return the attachment with proper content type
          const contentType = response.headers.get("content-type") || "application/octet-stream";
          const data = await response.arrayBuffer();

          return new Response(data, {
            headers: {
              "Content-Type": contentType,
              "Cache-Control": "private, max-age=3600",
            },
          });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/jira/thumbnail/:id - Proxy JIRA thumbnails
    "/api/jira/thumbnail/:id": {
      GET: async (req: Request & { params: { id: string } }) => {
        try {
          const jiraConfig = await ctx.configService.getJiraConfig();
          if (!jiraConfig?.host || !jiraConfig?.email || !jiraConfig?.apiToken) {
            return Response.json({ error: "JIRA not configured" }, { status: 500 });
          }

          const attachmentId = req.params.id;
          const thumbnailUrl = `${jiraConfig.host}/rest/api/3/attachment/thumbnail/${attachmentId}`;

          // Fetch with auth
          const auth = btoa(`${jiraConfig.email}:${jiraConfig.apiToken}`);
          const response = await fetch(thumbnailUrl, {
            headers: {
              Authorization: `Basic ${auth}`,
            },
          });

          if (!response.ok) {
            return new Response("Thumbnail not found", { status: response.status });
          }

          // Return the thumbnail with proper content type
          const contentType = response.headers.get("content-type") || "image/png";
          const data = await response.arrayBuffer();

          return new Response(data, {
            headers: {
              "Content-Type": contentType,
              "Cache-Control": "private, max-age=3600",
            },
          });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },
  };
}
