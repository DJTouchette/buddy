import type { ApiContext } from "./context";
import { handler } from "./helpers";

type ActivityEventType =
  | "pr_comment"
  | "pr_created"
  | "pr_completed"
  | "build_completed"
  | "job_completed"
  | "ticket_transition"
  | "ticket_comment";

interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  timestamp: string;
  title: string;
  description?: string;
  author?: string;
  source: "jira" | "azure" | "jobs";
  link?: { type: "ticket" | "pr" | "job"; path?: string; url?: string };
  metadata?: Record<string, any>;
}

// Cache activity for 5 minutes
const ACTIVITY_CACHE_TTL = 5 * 60 * 1000;
let activityCache: { data: { events: ActivityEvent[]; cachedAt: number }; timestamp: number } | null = null;

/**
 * Extract plain text from JIRA ADF (Atlassian Document Format)
 */
function extractTextFromADF(adf: any): string {
  if (!adf) return "";
  if (typeof adf === "string") return adf;

  let text = "";
  if (adf.text) text += adf.text;
  if (adf.content && Array.isArray(adf.content)) {
    for (const node of adf.content) {
      text += extractTextFromADF(node);
    }
  }
  return text.trim();
}

export function activityRoutes(ctx: ApiContext) {
  return {
    "/api/activity": {
      GET: handler(async (req: Request) => {
        const url = new URL(req.url);
        const forceRefresh = url.searchParams.get("refresh") === "true";
        const typeFilter = url.searchParams.get("type");
        const limit = parseInt(url.searchParams.get("limit") || "50", 10);

        // Check cache
        if (!forceRefresh && activityCache && Date.now() - activityCache.timestamp < ACTIVITY_CACHE_TTL) {
          let events = activityCache.data.events;
          if (typeFilter) {
            const types = new Set(typeFilter.split(","));
            events = events.filter((e) => types.has(e.type));
          }
          return Response.json({ events: events.slice(0, limit), cachedAt: activityCache.data.cachedAt });
        }

        const { jiraService, azureDevOpsService } = await ctx.getServices();
        const allEvents: ActivityEvent[] = [];

        // Fetch from all sources in parallel, each wrapped in try/catch
        const [prResults, buildResults, jobResults, ticketResults] = await Promise.all([
          // PR comments + PR created
          (async () => {
            const events: ActivityEvent[] = [];
            try {
              const myPRs = await azureDevOpsService.getMyPullRequests();

              // PR created events
              for (const pr of myPRs) {
                events.push({
                  id: `pr_created_${pr.pullRequestId}`,
                  type: "pr_created",
                  timestamp: pr.creationDate || new Date().toISOString(),
                  title: `Created PR #${pr.pullRequestId}: ${pr.title}`,
                  description: pr.sourceRefName.replace("refs/heads/", "") + " → " + pr.targetRefName.replace("refs/heads/", ""),
                  author: pr.createdBy?.displayName,
                  source: "azure",
                  link: { type: "pr", path: `/prs/${pr.pullRequestId}` },
                });
              }

              // PR comment events from first 5 PRs
              for (const pr of myPRs.slice(0, 5)) {
                try {
                  const threads = await azureDevOpsService.getPRThreads(pr.pullRequestId);
                  for (const thread of threads) {
                    const firstComment = thread.comments[0];
                    if (firstComment && firstComment.content) {
                      events.push({
                        id: `pr_comment_${pr.pullRequestId}_${thread.id}`,
                        type: "pr_comment",
                        timestamp: firstComment.publishedDate,
                        title: `${firstComment.author.displayName} commented on PR #${pr.pullRequestId}`,
                        description: firstComment.content.slice(0, 200),
                        author: firstComment.author.displayName,
                        source: "azure",
                        link: {
                          type: "pr",
                          path: `/prs/${pr.pullRequestId}`,
                          url: azureDevOpsService.getPRThreadUrl(pr.pullRequestId, thread.id),
                        },
                      });
                    }
                  }
                } catch {
                  // Skip PR if threads fail
                }
              }

              // Completed PRs
              try {
                const completedPRs = await azureDevOpsService.getCompletedPullRequests(30);
                for (const pr of completedPRs.slice(0, 10)) {
                  events.push({
                    id: `pr_completed_${pr.pullRequestId}`,
                    type: "pr_completed",
                    timestamp: pr.closedDate || pr.creationDate || new Date().toISOString(),
                    title: `PR #${pr.pullRequestId} completed: ${pr.title}`,
                    author: pr.createdBy?.displayName,
                    source: "azure",
                    link: { type: "pr", path: `/prs/${pr.pullRequestId}` },
                  });
                }
              } catch {
                // Skip completed PRs
              }
            } catch (err) {
              console.error("[Activity] Failed to fetch PR events:", err);
            }
            return events;
          })(),

          // Builds
          (async () => {
            const events: ActivityEvent[] = [];
            try {
              const builds = await azureDevOpsService.getBuilds(undefined, 20);
              for (const build of builds) {
                if (build.finishTime) {
                  // Check if build was triggered by a PR (sourceBranch = refs/pull/{id}/merge)
                  const prMatch = build.sourceBranch?.match(/^refs\/pull\/(\d+)\/merge$/);
                  const prId = prMatch ? prMatch[1] : null;

                  events.push({
                    id: `build_${build.id}`,
                    type: "build_completed",
                    timestamp: build.finishTime,
                    title: prId
                      ? `Build #${build.buildNumber} ${build.result || build.status} (PR #${prId})`
                      : `Build #${build.buildNumber} ${build.result || build.status}`,
                    description: build.result === "succeeded" ? "Build passed" : `Build ${build.result || build.status}`,
                    source: "azure",
                    link: prId
                      ? { type: "pr" as const, path: `/prs/${prId}`, url: azureDevOpsService.getBuildUrl(build.id) }
                      : { type: "job" as const, url: azureDevOpsService.getBuildUrl(build.id) },
                    metadata: { buildId: build.id, result: build.result, prId },
                  });
                }
              }
            } catch (err) {
              console.error("[Activity] Failed to fetch build events:", err);
            }
            return events;
          })(),

          // Local jobs
          (async () => {
            const events: ActivityEvent[] = [];
            try {
              const jobs = ctx.jobService.getRecentJobs(30);
              for (const job of jobs) {
                events.push({
                  id: `job_${job.id}`,
                  type: "job_completed",
                  timestamp: job.completedAt
                    ? new Date(job.completedAt).toISOString()
                    : new Date(job.startedAt).toISOString(),
                  title: `Job: ${job.type} ${job.target} — ${job.status}`,
                  description: job.error || `${job.type} job ${job.status}`,
                  source: "jobs",
                  link: { type: "job", path: `/jobs` },
                  metadata: { jobId: job.id, status: job.status },
                });
              }
            } catch (err) {
              console.error("[Activity] Failed to fetch job events:", err);
            }
            return events;
          })(),

          // Ticket transitions + comments
          (async () => {
            const events: ActivityEvent[] = [];
            try {
              const myIssues = await jiraService.getMyIssues();
              const sevenDaysAgo = new Date();
              sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

              for (const issue of myIssues.slice(0, 10)) {
                // Changelog (transitions)
                try {
                  const changelog = await jiraService.getIssueChangelog(issue.key);
                  for (const entry of changelog) {
                    if (new Date(entry.created) >= sevenDaysAgo) {
                      events.push({
                        id: `ticket_transition_${issue.key}_${entry.id}`,
                        type: "ticket_transition",
                        timestamp: entry.created,
                        title: `${issue.key} moved ${entry.fromString} → ${entry.toString}`,
                        description: entry.issueSummary,
                        author: entry.author,
                        source: "jira",
                        link: { type: "ticket", path: `/tickets/${issue.key}` },
                      });
                    }
                  }
                } catch {
                  // Skip if changelog fails
                }

                // Comments
                try {
                  const comments = await jiraService.getIssueComments(issue.key);
                  for (const comment of comments) {
                    if (new Date(comment.created) >= sevenDaysAgo) {
                      const bodyText = extractTextFromADF(comment.body);
                      events.push({
                        id: `ticket_comment_${issue.key}_${comment.id}`,
                        type: "ticket_comment",
                        timestamp: comment.created,
                        title: `${comment.author} commented on ${issue.key}`,
                        description: bodyText.slice(0, 200),
                        author: comment.author,
                        source: "jira",
                        link: { type: "ticket", path: `/tickets/${issue.key}` },
                      });
                    }
                  }
                } catch {
                  // Skip if comments fail
                }
              }
            } catch (err) {
              console.error("[Activity] Failed to fetch ticket events:", err);
            }
            return events;
          })(),
        ]);

        allEvents.push(...prResults, ...buildResults, ...jobResults, ...ticketResults);

        // Sort by timestamp descending
        allEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        const cacheData = { events: allEvents, cachedAt: Date.now() };
        activityCache = { data: cacheData, timestamp: Date.now() };

        // Apply filters
        let events = allEvents;
        if (typeFilter) {
          const types = new Set(typeFilter.split(","));
          events = events.filter((e) => types.has(e.type));
        }

        return Response.json({ events: events.slice(0, limit), cachedAt: cacheData.cachedAt });
      }),
    },

    "/api/activity/cache-info": {
      GET: handler(async () => {
        if (!activityCache) {
          return Response.json({ cached: false });
        }

        const age = Date.now() - activityCache.timestamp;
        const ttlRemaining = Math.max(0, ACTIVITY_CACHE_TTL - age);

        return Response.json({
          cached: true,
          cachedAt: new Date(activityCache.timestamp).toISOString(),
          ageMinutes: Math.floor(age / 60000),
          ttlRemainingMinutes: Math.floor(ttlRemaining / 60000),
        });
      }),
    },
  };
}
