import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Play,
  RefreshCw,
  Package,
  Server,
  Code,
  FileCode,
  CheckCircle,
  XCircle,
  Circle,
  Loader2,
  Rocket,
  GitCompare,
  FileSearch,
  Trash2,
  AlertTriangle,
  Search,
  Cloud,
  Hammer,
  ShieldAlert,
} from "lucide-react";
import { JobOutput } from "../components/JobOutput";
import { LambdaDetailModal } from "../components/LambdaDetailModal";

interface Lambda {
  name: string;
  type: "dotnet" | "js" | "python" | "typescript-edge";
  path: string;
  outputPath: string;
  hasDeploymentZip: boolean;
}

interface Job {
  id: string;
  type: string;
  target: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  output: string[];
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}

interface Stack {
  name: string;
  status: string;
  lastUpdated: string | null;
  stackType: string;
}

interface BuildInfo {
  [name: string]: {
    lastBuiltAt: number | null;
    lastBuildStatus: string | null;
    deploymentZipExists: boolean;
  };
}

interface DirtyInfo {
  [name: string]: {
    isDirty: boolean;
    reason?: string;
  };
}

interface AwsLambda {
  functionName: string;
  localName: string | null;
  runtime: string | null;
  memorySize: number | null;
  timeout: number | null;
  lastModified: string | null;
  codeSize: number | null;
  handler: string | null;
  description: string | null;
  environment: string | null;
  stackType: string | null;
}

type TabType = "build" | "aws-lambdas";

const TYPE_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  dotnet: { label: ".NET Lambdas", icon: Server },
  js: { label: "JavaScript Lambdas", icon: FileCode },
  python: { label: "Python Lambdas", icon: Code },
  "typescript-edge": { label: "TypeScript Edge Lambdas", icon: Code },
};

// Helper to persist job state across navigation
const ACTIVE_JOB_KEY = "buddy-active-job";
const BUILDING_LAMBDAS_KEY = "buddy-building-lambdas";

function saveJobState(jobId: string | null, buildingLambdas: Set<string>) {
  if (jobId) {
    localStorage.setItem(ACTIVE_JOB_KEY, jobId);
    localStorage.setItem(BUILDING_LAMBDAS_KEY, JSON.stringify([...buildingLambdas]));
  } else {
    localStorage.removeItem(ACTIVE_JOB_KEY);
    localStorage.removeItem(BUILDING_LAMBDAS_KEY);
  }
}

function loadJobState(): { jobId: string | null; buildingLambdas: Set<string> } {
  const jobId = localStorage.getItem(ACTIVE_JOB_KEY);
  const buildingLambdasJson = localStorage.getItem(BUILDING_LAMBDAS_KEY);
  const buildingLambdas = buildingLambdasJson ? new Set<string>(JSON.parse(buildingLambdasJson)) : new Set<string>();
  return { jobId, buildingLambdas };
}

export function InfraPage() {
  const [lambdas, setLambdas] = useState<Lambda[]>([]);
  const [stacks, setStacks] = useState<Stack[]>([]);
  const [buildInfo, setBuildInfo] = useState<BuildInfo>({});
  const [dirtyInfo, setDirtyInfo] = useState<DirtyInfo>({});
  const [currentEnv, setCurrentEnv] = useState<string | null>(null);
  const [isEnvProtected, setIsEnvProtected] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [infraPath, setInfraPath] = useState<string | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const [buildingLambdas, setBuildingLambdas] = useState<Set<string>>(new Set());
  const [completedLambdas, setCompletedLambdas] = useState<Set<string>>(new Set());

  // New state for tabs and AWS lambdas
  const [activeTab, setActiveTab] = useState<TabType>("build");
  const [awsLambdas, setAwsLambdas] = useState<AwsLambda[]>([]);
  const [awsLambdasLoading, setAwsLambdasLoading] = useState(false);
  const [awsSearch, setAwsSearch] = useState("");
  const [selectedAwsLambda, setSelectedAwsLambda] = useState<AwsLambda | null>(null);
  const [localLambdaNames, setLocalLambdaNames] = useState<string[]>([]);
  const [activeJobLambdaName, setActiveJobLambdaName] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setError(null);

    try {
      // Fetch lambdas, stacks, build info, current env, and dirty status in parallel
      const [lambdasRes, stacksRes, buildsRes, envRes, dirtyRes] = await Promise.all([
        fetch("/api/infra/lambdas"),
        fetch("/api/infra/stacks"),
        fetch("/api/jobs/builds"),
        fetch("/api/infra/environments/current"),
        fetch("/api/infra/lambdas/dirty"),
      ]);

      const lambdasData = await lambdasRes.json();
      const stacksData = await stacksRes.json();
      const buildsData = await buildsRes.json();
      const envData = await envRes.json();
      const dirtyData = await dirtyRes.json();

      if (lambdasData.error) {
        setError(lambdasData.error);
      } else {
        setLambdas(lambdasData.lambdas || []);
        setInfraPath(lambdasData.infraPath || null);
      }

      setStacks(stacksData.stacks || []);
      setBuildInfo(buildsData.builds || {});
      setDirtyInfo(dirtyData.dirty || {});
      setCurrentEnv(envData.currentEnvironment);
      setIsEnvProtected(envData.isProtected || false);
    } catch (err) {
      setError("Failed to load infrastructure data");
    } finally {
      setInitialLoading(false);
    }
  }, []);

  const fetchJobs = useCallback(async (restoreFromStorage = false) => {
    try {
      const res = await fetch("/api/jobs?active=false");
      const data = await res.json();
      setRecentJobs(data.jobs || []);

      // On initial load, try to restore persisted job
      if (restoreFromStorage && !activeJobIdRef.current) {
        const persisted = loadJobState();
        if (persisted.jobId) {
          const persistedJob = data.jobs?.find((j: Job) => j.id === persisted.jobId);
          if (persistedJob && (persistedJob.status === "pending" || persistedJob.status === "running")) {
            // Job is still running - restore it
            activeJobIdRef.current = persistedJob.id;
            setActiveJob(persistedJob);
            setBuildingLambdas(persisted.buildingLambdas);
            return;
          } else {
            // Job finished while we were away - clear persisted state
            saveJobState(null, new Set());
          }
        }
      }

      // Auto-detect new jobs if we're not currently showing one
      if (!activeJobIdRef.current) {
        const active = data.jobs?.find(
          (j: Job) => j.status === "pending" || j.status === "running"
        );
        if (active) {
          activeJobIdRef.current = active.id;
          setActiveJob(active);
        }
      }
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    }
  }, []);

  const fetchAwsLambdas = useCallback(async (forceRefresh = false) => {
    if (!currentEnv) return;

    setAwsLambdasLoading(true);
    try {
      const url = forceRefresh ? "/api/infra/aws-lambdas?refresh=true" : "/api/infra/aws-lambdas";
      const res = await fetch(url);
      const data = await res.json();
      setAwsLambdas(data.lambdas || []);
      setLocalLambdaNames(data.localLambdas || []);
    } catch (err) {
      console.error("Failed to fetch AWS lambdas:", err);
    } finally {
      setAwsLambdasLoading(false);
    }
  }, [currentEnv]);

  // Fetch AWS lambdas when tab changes or environment changes
  useEffect(() => {
    if (activeTab === "aws-lambdas" && currentEnv) {
      fetchAwsLambdas();
    }
  }, [activeTab, currentEnv, fetchAwsLambdas]);

  useEffect(() => {
    fetchData();
    fetchJobs(true); // Restore from storage on initial load

    // Poll jobs every 2 seconds
    const interval = setInterval(() => fetchJobs(false), 2000);
    return () => clearInterval(interval);
  }, [fetchData, fetchJobs]);

  // Listen for environment changes from the EnvironmentSelector
  useEffect(() => {
    const handleEnvChange = () => {
      fetchData();
      // Also refresh AWS lambdas if on that tab
      if (activeTab === "aws-lambdas") {
        fetchAwsLambdas(true);
      }
    };

    window.addEventListener("environment-changed", handleEnvChange);
    return () => window.removeEventListener("environment-changed", handleEnvChange);
  }, [fetchData, fetchAwsLambdas, activeTab]);

  // Poll build info during active builds to show real-time progress
  useEffect(() => {
    if (buildingLambdas.size === 0) return;

    const pollBuildInfo = async () => {
      try {
        const res = await fetch("/api/jobs/builds");
        const data = await res.json();
        const newBuildInfo = data.builds || {};
        setBuildInfo(newBuildInfo);

        // Check which lambdas have completed
        const newCompleted = new Set(completedLambdas);
        for (const name of buildingLambdas) {
          const info = newBuildInfo[name];
          if (info?.lastBuiltAt && info.lastBuiltAt > (activeJob?.startedAt || 0)) {
            newCompleted.add(name);
          }
        }
        if (newCompleted.size !== completedLambdas.size) {
          setCompletedLambdas(newCompleted);
        }
      } catch (err) {
        console.error("Failed to poll build info:", err);
      }
    };

    const interval = setInterval(pollBuildInfo, 1000);
    return () => clearInterval(interval);
  }, [buildingLambdas, completedLambdas, activeJob?.startedAt]);

  const startJob = async (type: string, target: string) => {
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, target }),
      });

      const data = await res.json();
      if (data.job) {
        activeJobIdRef.current = data.job.id;
        setActiveJob(data.job);

        // If this is a build job, mark lambdas as building
        let lambdaNames = new Set<string>();
        if (type === "build") {
          if (target === "all") {
            lambdas.forEach((l) => lambdaNames.add(l.name));
          } else if (["dotnet", "js", "python", "typescript-edge"].includes(target)) {
            lambdas.filter((l) => l.type === target).forEach((l) => lambdaNames.add(l.name));
          } else {
            lambdaNames.add(target);
          }
          setBuildingLambdas(lambdaNames);
          setCompletedLambdas(new Set());
        }

        // Persist job state for navigation recovery
        saveJobState(data.job.id, lambdaNames);
      } else if (data.error) {
        setError(data.error);
      }
    } catch (err) {
      setError("Failed to start job");
    }
  };

  const startDeployLambda = async (localName: string, awsFunctionName: string) => {
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "deploy-lambda",
          target: localName,
          awsFunctionName,
        }),
      });

      const data = await res.json();
      if (data.job) {
        activeJobIdRef.current = data.job.id;
        setActiveJob(data.job);
        const lambdaNames = new Set([localName]);
        setBuildingLambdas(lambdaNames);
        setCompletedLambdas(new Set());
        setSelectedAwsLambda(null); // Close modal
        saveJobState(data.job.id, lambdaNames);
      } else if (data.error) {
        setError(data.error);
      }
    } catch (err) {
      setError("Failed to start deploy job");
    }
  };

  const startTailLogs = async (awsFunctionName: string, lambdaName?: string) => {
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "tail-logs",
          target: awsFunctionName,
        }),
      });

      const data = await res.json();
      if (data.job) {
        activeJobIdRef.current = data.job.id;
        setActiveJob(data.job);
        setActiveJobLambdaName(lambdaName || awsFunctionName);
        saveJobState(data.job.id, new Set());
      } else if (data.error) {
        setError(data.error);
      }
    } catch (err) {
      setError("Failed to start log tail job");
    }
  };

  const cancelJob = async (jobId: string) => {
    try {
      await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      saveJobState(null, new Set()); // Clear persisted state
      fetchJobs(false);
    } catch (err) {
      console.error("Failed to cancel job:", err);
    }
  };

  const forceClearJobs = async () => {
    try {
      await fetch("/api/jobs/clear", { method: "POST" });
      activeJobIdRef.current = null;
      setActiveJob(null);
      setBuildingLambdas(new Set());
      setCompletedLambdas(new Set());
      saveJobState(null, new Set()); // Clear persisted state
      fetchJobs(false);
      fetchData();
    } catch (err) {
      console.error("Failed to force clear jobs:", err);
    }
  };

  // Group lambdas by type
  const lambdasByType = lambdas.reduce((acc, lambda) => {
    if (!acc[lambda.type]) acc[lambda.type] = [];
    acc[lambda.type].push(lambda);
    return acc;
  }, {} as Record<string, Lambda[]>);

  const getLambdaStatus = (lambda: Lambda): { status: string; dirtyReason?: string } => {
    const info = buildInfo[lambda.name];
    const dirty = dirtyInfo[lambda.name];

    // Check if this lambda is part of a batch build
    if (buildingLambdas.has(lambda.name)) {
      // Check if it completed during this build
      if (completedLambdas.has(lambda.name)) {
        if (info?.lastBuildStatus === "failed") return { status: "failed" };
        if (info?.deploymentZipExists) return { status: "built" };
      }
      return { status: "queued" }; // Still waiting or currently building
    }

    // Check if currently building (single lambda build)
    if (activeJob?.target === lambda.name && activeJob.status === "running") {
      return { status: "building" };
    }

    // Check build info
    if (info?.lastBuildStatus === "failed") return { status: "failed" };

    // Check if built but dirty (has changes since last build)
    if ((lambda.hasDeploymentZip || info?.deploymentZipExists) && dirty?.isDirty) {
      return { status: "dirty", dirtyReason: dirty.reason };
    }

    if (lambda.hasDeploymentZip || info?.deploymentZipExists) return { status: "built" };

    // Not built yet
    if (dirty?.isDirty) {
      return { status: "not-built", dirtyReason: dirty.reason };
    }

    return { status: "not-built" };
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "built":
        return <CheckCircle className="w-4 h-4 status-success" />;
      case "dirty":
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case "failed":
        return <XCircle className="w-4 h-4 status-error" />;
      case "building":
        return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
      case "queued":
        return <Loader2 className="w-4 h-4 animate-spin text-gray-400" />;
      default:
        return <Circle className="w-4 h-4 text-gray-400" />;
    }
  };

  if (initialLoading) {
    return (
      <div className="page-loading">
        <Loader2 className="w-8 h-8 animate-spin" />
        <span>Loading infrastructure...</span>
      </div>
    );
  }

  return (
    <div className="infra-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Infrastructure</h1>
          {currentEnv && (
            <p className="text-muted">
              Environment: <strong>{currentEnv}</strong>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {(activeJob || buildingLambdas.size > 0) && (
            <button className="btn-danger" onClick={forceClearJobs} title="Force kill all jobs and processes">
              <Trash2 className="w-4 h-4" />
              Force Clear
            </button>
          )}
          <button className="btn-secondary" onClick={fetchData}>
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <XCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="infra-tabs">
        <button
          className={`infra-tab ${activeTab === "build" ? "active" : ""}`}
          onClick={() => setActiveTab("build")}
        >
          <Hammer className="w-4 h-4" />
          Build
        </button>
        <button
          className={`infra-tab ${activeTab === "aws-lambdas" ? "active" : ""}`}
          onClick={() => setActiveTab("aws-lambdas")}
        >
          <Cloud className="w-4 h-4" />
          AWS Lambdas
        </button>
      </div>

      {/* Protected Environment Warning */}
      {isEnvProtected && (
        <div className="alert alert-warning" style={{ marginBottom: "1rem" }}>
          <ShieldAlert className="w-4 h-4" />
          <span>
            Environment <strong>{currentEnv}</strong> is protected. Deployments are disabled.
          </span>
        </div>
      )}

      {activeTab === "build" && (
        <>
          {/* Stacks Section */}
          {stacks.length > 0 && (
            <section className="infra-section">
              <h2 className="section-title">
                <Server className="w-5 h-5" />
                Deployed Stacks
              </h2>
          <div className="stack-grid">
            {stacks.map((stack) => (
              <div key={stack.name} className="stack-card">
                <div className="stack-card-header">
                  <span className="stack-name">{stack.stackType}</span>
                  <span className={`badge badge-${getStackStatusColor(stack.status)}`}>
                    {stack.status}
                  </span>
                </div>
                {stack.lastUpdated && (
                  <div className="stack-card-meta">
                    Updated: {new Date(stack.lastUpdated).toLocaleString()}
                  </div>
                )}
                <div className="stack-card-actions">
                  <button
                    className="btn-sm"
                    onClick={() => startJob("diff", stack.stackType)}
                    disabled={!!activeJob}
                    title="Show changes"
                  >
                    <GitCompare className="w-3 h-3" />
                    Diff
                  </button>
                  <button
                    className="btn-sm btn-primary"
                    onClick={() => startJob("deploy", stack.stackType)}
                    disabled={!!activeJob || isEnvProtected}
                    title={isEnvProtected ? `Cannot deploy to protected environment "${currentEnv}"` : "Deploy stack"}
                  >
                    <Rocket className="w-3 h-3" />
                    Deploy
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Lambdas Section */}
      <section className="infra-section">
        <div className="section-header">
          <h2 className="section-title">
            <Package className="w-5 h-5" />
            Lambdas ({lambdas.length})
          </h2>
          <button
            className="btn-primary"
            onClick={() => startJob("build", "all")}
            disabled={!!activeJob}
          >
            <Play className="w-4 h-4" />
            Build All
          </button>
        </div>

        {Object.entries(lambdasByType).map(([type, typeLambdas]) => {
          const typeInfo = TYPE_LABELS[type] || { label: type, icon: Code };
          const Icon = typeInfo.icon;

          return (
            <div key={type} className="lambda-type-section">
              <div className="lambda-type-header">
                <div className="lambda-type-title">
                  <Icon className="w-4 h-4" />
                  <span>{typeInfo.label}</span>
                  <span className="text-muted">({typeLambdas.length})</span>
                </div>
                <button
                  className="btn-sm"
                  onClick={() => startJob("build", type)}
                  disabled={!!activeJob}
                >
                  <Play className="w-3 h-3" />
                  Build All {typeInfo.label.split(" ")[0]}
                </button>
              </div>
              <div className="lambda-grid">
                {typeLambdas.map((lambda) => {
                  const statusInfo = getLambdaStatus(lambda);
                  return (
                    <div
                      key={lambda.name}
                      className={`lambda-card ${statusInfo.status}`}
                    >
                      <div className="lambda-card-status">
                        {getStatusIcon(statusInfo.status)}
                      </div>
                      <div className="lambda-card-name">{lambda.name}</div>
                      <button
                        className="lambda-card-build"
                        onClick={() => startJob("build", lambda.name)}
                        disabled={!!activeJob}
                        title="Build this lambda"
                      >
                        <Play className="w-3 h-3" />
                      </button>
                      {statusInfo.dirtyReason && (
                        <div className="lambda-tooltip">
                          <AlertTriangle className="w-3 h-3" />
                          <span>{statusInfo.dirtyReason}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
        </>
      )}

      {activeTab === "aws-lambdas" && (
        <section className="infra-section">
          <div className="section-header">
            <h2 className="section-title">
              <Cloud className="w-5 h-5" />
              AWS Lambda Functions
            </h2>
            <div className="flex gap-2 items-center">
              <div className="aws-lambda-search">
                <Search className="w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search lambdas..."
                  value={awsSearch}
                  onChange={(e) => setAwsSearch(e.target.value)}
                />
              </div>
              <button
                className="btn-secondary"
                onClick={() => fetchAwsLambdas(true)}
                disabled={awsLambdasLoading}
                title="Refresh from AWS"
              >
                <RefreshCw className={`w-4 h-4 ${awsLambdasLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {awsLambdasLoading ? (
            <div className="page-loading" style={{ padding: "2rem" }}>
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>Loading AWS lambdas...</span>
            </div>
          ) : !currentEnv ? (
            <div className="alert alert-warning">
              <AlertTriangle className="w-5 h-5" />
              <span>Select an environment to view AWS lambdas</span>
            </div>
          ) : awsLambdas.length === 0 ? (
            <div className="text-muted" style={{ padding: "1rem" }}>
              No Lambda functions found. Make sure you have AWS credentials configured.
            </div>
          ) : (
            <div className="aws-lambda-table">
              <div className="aws-lambda-table-header">
                <span>Function Name</span>
                <span>Local Name</span>
                <span>Environment</span>
                <span>Runtime</span>
                <span>Memory</span>
              </div>
              {awsLambdas
                .filter((l) => {
                  if (!awsSearch) return true;
                  const search = awsSearch.toLowerCase();
                  return (
                    l.functionName.toLowerCase().includes(search) ||
                    l.localName?.toLowerCase().includes(search) ||
                    l.environment?.toLowerCase().includes(search)
                  );
                })
                .map((lambda) => {
                  const isCurrentEnv = lambda.environment?.toLowerCase() === currentEnv?.toLowerCase();
                  const hasLocalMatch = lambda.localName && localLambdaNames.some(
                    (local) => local.toLowerCase() === lambda.localName?.toLowerCase()
                  );
                  return (
                    <div
                      key={lambda.functionName}
                      className={`aws-lambda-row ${isCurrentEnv ? "current-env" : ""}`}
                      onClick={() => setSelectedAwsLambda(lambda)}
                    >
                      <span className="aws-lambda-name">{lambda.functionName}</span>
                      <span className={`aws-lambda-local ${hasLocalMatch ? "matched" : ""}`}>
                        {lambda.localName || "-"}
                      </span>
                      <span className={`aws-lambda-env ${isCurrentEnv ? "current" : ""}`}>
                        {lambda.environment || "-"}
                      </span>
                      <span>{lambda.runtime || "-"}</span>
                      <span>{lambda.memorySize ? `${lambda.memorySize} MB` : "-"}</span>
                    </div>
                  );
                })}
            </div>
          )}
        </section>
      )}

      {/* Active Job Output */}
      {activeJob && (
        <JobOutput
          job={activeJob}
          lambdaName={activeJobLambdaName || undefined}
          onClose={() => {
            activeJobIdRef.current = null;
            setActiveJob(null);
            setBuildingLambdas(new Set());
            setCompletedLambdas(new Set());
            setActiveJobLambdaName(null);
            saveJobState(null, new Set()); // Clear persisted state
          }}
          onCancel={() => cancelJob(activeJob.id)}
          onComplete={() => {
            fetchData();
            fetchJobs(false);
            saveJobState(null, new Set()); // Clear persisted state on completion
          }}
        />
      )}

      {/* Recent Jobs */}
      {recentJobs.length > 0 && !activeJob && (
        <section className="infra-section">
          <h2 className="section-title">
            <FileSearch className="w-5 h-5" />
            Recent Jobs
          </h2>
          <div className="job-history">
            {recentJobs.slice(0, 5).map((job) => (
              <div key={job.id} className={`job-history-item ${job.status}`}>
                <div className="job-history-info">
                  <span className="job-history-type">{job.type}</span>
                  <span className="job-history-target">{job.target}</span>
                </div>
                <div className="job-history-meta">
                  <span className={`badge badge-${getJobStatusColor(job.status)}`}>
                    {job.status}
                  </span>
                  <span className="text-muted text-xs">
                    {new Date(job.startedAt).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Lambda Detail Modal */}
      {selectedAwsLambda && (
        <LambdaDetailModal
          lambda={selectedAwsLambda}
          onClose={() => setSelectedAwsLambda(null)}
          onBuild={(localName) => {
            setSelectedAwsLambda(null);
            startJob("build", localName);
          }}
          onDeploy={(localName, awsFunctionName) => {
            startDeployLambda(localName, awsFunctionName);
          }}
          onTailLogs={(awsFunctionName, lambdaName) => {
            startTailLogs(awsFunctionName, lambdaName);
          }}
          isJobRunning={!!activeJob}
          localLambdas={localLambdaNames}
          isEnvProtected={isEnvProtected}
          currentEnv={currentEnv}
        />
      )}
    </div>
  );
}

function getStackStatusColor(status: string): string {
  if (status.includes("COMPLETE")) return "green";
  if (status.includes("FAILED") || status.includes("ROLLBACK")) return "red";
  if (status.includes("IN_PROGRESS")) return "blue";
  return "gray";
}

function getJobStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return "green";
    case "failed":
      return "red";
    case "running":
      return "blue";
    case "cancelled":
      return "gray";
    default:
      return "gray";
  }
}
