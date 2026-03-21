"use client";

import { useEffect, useRef, useState } from "react";

interface LogViewerProps {
  agentId: string;
}

type AgentStatus = "idle" | "running" | "finished" | "error";
type CopyFeedback = "idle" | "copied" | "error";

// ── Single Source of Truth for log levels ───────────────────
// Add new levels here — type & validation update automatically.
const levelClassName = {
  info: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  error: "border-red-500/30 bg-red-500/10 text-red-400",
  debug: "border-zinc-500/30 bg-zinc-500/10 text-zinc-500",
  system: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
  result: "border-cyan-400/60 bg-cyan-400/10 text-cyan-300",
  agent: "border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
  user: "border-yellow-400/60 bg-yellow-400/10 text-yellow-300",
} as const;

type LogLevel = keyof typeof levelClassName;

export interface LogItem {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toLogId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toLevel(value: unknown): LogLevel {
  if (typeof value === "string" && value in levelClassName) {
    return value as LogLevel;
  }

  return "info";
}

function toTimestamp(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return new Date().toISOString();
}

function toDisplayMessage(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return "undefined";
  }

  try {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized !== undefined) {
      return serialized;
    }
  } catch {
    // Fall through to String() so malformed values are still visible to the user.
  }

  return String(value);
}

function parseEventPayload(data: string): unknown {
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return { message: data };
  }
}

function formatTimestamp(timestamp: string): string {
  const asDate = new Date(timestamp);
  if (Number.isNaN(asDate.getTime())) {
    return timestamp;
  }

  return asDate.toLocaleTimeString("en-GB", { hour12: false });
}

const statusClassName: Record<AgentStatus, string> = {
  idle: "border-zinc-500/40 bg-zinc-500/10 text-zinc-400",
  running: "border-amber-500/40 bg-amber-500/10 text-amber-400 animate-pulse",
  finished: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  error: "border-red-500/40 bg-red-500/10 text-red-400",
};

const maxLogLevelLabelLength = Math.max(...Object.keys(levelClassName).map((level) => level.length));

function formatLogForClipboard(log: LogItem): string {
  const prefix = `[${formatTimestamp(log.timestamp)}] ${log.level.toUpperCase().padEnd(maxLogLevelLabelLength, " ")} `;

  return log.message
    .split("\n")
    .map((line, index) => `${index === 0 ? prefix : " ".repeat(prefix.length)}${line}`)
    .join("\n");
}

export function buildClipboardLogText(logs: LogItem[]): string {
  return logs.map((log) => formatLogForClipboard(log)).join("\n\n");
}

export function LogViewer({ agentId }: LogViewerProps) {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [duration, setDuration] = useState<number | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>("idle");

  const eventSourceRef = useRef<EventSource | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<AgentStatus>("idle");
  const copyFeedbackTimeoutRef = useRef<number | null>(null);

  const setStatusState = (nextStatus: AgentStatus): void => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  };

  const appendLog = (entry: Omit<LogItem, "id">): void => {
    setLogs((currentLogs) => [...currentLogs, { id: toLogId(), ...entry }]);
  };

  const closeStream = (): void => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  };

  const scheduleCopyFeedbackReset = (): void => {
    if (copyFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(copyFeedbackTimeoutRef.current);
    }

    copyFeedbackTimeoutRef.current = window.setTimeout(() => {
      setCopyFeedback("idle");
      copyFeedbackTimeoutRef.current = null;
    }, 2000);
  };

  useEffect(() => {
    const container = logContainerRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [logs]);

  useEffect(() => {
    return () => {
      closeStream();

      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  const handleRun = (): void => {
    closeStream();

    setLogs([]);
    setDuration(null);
    setStatusState("running");
    setIsStopping(false);
    setCopyFeedback("idle");

    const source = new EventSource(`/api/agents/${agentId}/run`);
    eventSourceRef.current = source;

    source.addEventListener("log", (event) => {
      const payload = parseEventPayload((event as MessageEvent<string>).data);
      if (!isRecord(payload)) {
        appendLog({
          timestamp: new Date().toISOString(),
          level: "info",
          message: toDisplayMessage(payload),
        });
        return;
      }

      appendLog({
        timestamp: toTimestamp(payload.timestamp),
        level: toLevel(payload.level),
        message: toDisplayMessage(payload.message),
      });
    });

    source.addEventListener("result", (event) => {
      const payload = parseEventPayload((event as MessageEvent<string>).data);
      if (!isRecord(payload)) {
        appendLog({
          timestamp: new Date().toISOString(),
          level: "result",
          message: toDisplayMessage(payload),
        });
        return;
      }

      appendLog({
        timestamp: toTimestamp(payload.timestamp),
        level: "result",
        message:
          payload.data !== undefined ? toDisplayMessage(payload.data) : toDisplayMessage(payload),
      });
    });

    source.addEventListener("done", (event) => {
      const payload = parseEventPayload((event as MessageEvent<string>).data);
      const doneDuration =
        isRecord(payload) && typeof payload.duration === "number" ? payload.duration : null;

      setDuration(doneDuration);
      setStatusState("finished");

      appendLog({
        timestamp: new Date().toISOString(),
        level: "system",
        message:
          isRecord(payload) && payload.exitCode !== undefined
            ? `Run finished (exitCode: ${String(payload.exitCode)}).`
            : "Run finished.",
      });

      closeStream();
      setIsStopping(false);
    });

    source.addEventListener("error", (event) => {
      const payload = parseEventPayload((event as MessageEvent<string>).data);
      const message =
        isRecord(payload) && typeof payload.message === "string"
          ? payload.message
          : "Agent stream error.";

      appendLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message,
      });
      setStatusState("error");
      closeStream();
      setIsStopping(false);
    });

    source.onerror = () => {
      if (statusRef.current !== "running") {
        return;
      }

      appendLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message: "Connection to stream lost.",
      });
      setStatusState("error");
      closeStream();
      setIsStopping(false);
    };
  };

  const handleStop = async (): Promise<void> => {
    if (statusRef.current !== "running") {
      return;
    }

    setIsStopping(true);

    try {
      const response = await fetch(`/api/agents/${agentId}/stop`, {
        method: "POST",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as unknown;
        const message =
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : `Stop failed with status ${response.status}.`;

        appendLog({
          timestamp: new Date().toISOString(),
          level: "error",
          message,
        });
        setStatusState("error");
        return;
      }

      appendLog({
        timestamp: new Date().toISOString(),
        level: "warn",
        message: "Stop signal sent. Waiting for process to finish...",
      });
    } catch (error: unknown) {
      appendLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message: error instanceof Error ? error.message : "Unable to send stop request.",
      });
      setStatusState("error");
    } finally {
      setIsStopping(false);
    }
  };

  const handleCopyLogs = async (): Promise<void> => {
    if (logs.length === 0) {
      return;
    }

    if (navigator.clipboard?.writeText === undefined) {
      setCopyFeedback("error");
      scheduleCopyFeedbackReset();
      return;
    }

    try {
      await navigator.clipboard.writeText(buildClipboardLogText(logs));
      setCopyFeedback("copied");
    } catch {
      setCopyFeedback("error");
    }

    scheduleCopyFeedbackReset();
  };

  const copyButtonClassName =
    copyFeedback === "copied"
      ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-300"
      : copyFeedback === "error"
        ? "border-red-500/60 bg-red-500/20 text-red-300"
        : "border-[#1b2e1b] bg-black text-[#6b7b6b] hover:border-cyan-400/60 hover:text-cyan-300";

  const copyButtonLabel =
    copyFeedback === "copied" ? "Copied" : copyFeedback === "error" ? "Copy failed" : "Copy logs";

  return (
    <section className="rounded-sm border border-[#1b2e1b] bg-[#0d1117] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm tracking-[0.16em] text-[#c9d1d9]">RUN CONTROL</h2>

        <div className="flex items-center gap-2">
          <span
            className={`rounded-sm border px-2 py-0.5 text-[10px] uppercase tracking-wider ${statusClassName[status]}`}
          >
            {status}
          </span>

          {duration !== null ? (
            <span className="text-[10px] uppercase tracking-wider text-[#6b7b6b]">
              {`duration: ${(duration / 1000).toFixed(2)}s`}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        {status === "running" ? (
          <button
            type="button"
            disabled={isStopping}
            onClick={() => {
              void handleStop();
            }}
            className="rounded-sm border border-amber-500/60 bg-amber-500/20 px-4 py-2 text-xs uppercase tracking-[0.14em] text-amber-300 transition hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isStopping ? "■ Stopping..." : "■ Stop"}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleRun}
            className="rounded-sm border border-emerald-500/60 bg-emerald-500/20 px-4 py-2 text-xs uppercase tracking-[0.14em] text-emerald-300 transition hover:bg-emerald-500/30"
          >
            ▶ Run
          </button>
        )}
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xs uppercase tracking-[0.14em] text-[#6b7b6b]">LOG STREAM</h3>
          <button
            type="button"
            disabled={logs.length === 0}
            onClick={() => {
              void handleCopyLogs();
            }}
            className={`rounded-sm border px-3 py-1 text-[10px] uppercase tracking-[0.14em] transition disabled:cursor-not-allowed disabled:border-[#1b2e1b] disabled:bg-black disabled:text-[#344034] ${copyButtonClassName}`}
          >
            {copyButtonLabel}
          </button>
        </div>
        <div
          ref={logContainerRef}
          className="mt-2 h-[26rem] overflow-y-auto rounded-sm border border-[#1b2e1b] bg-black p-3 text-xs"
        >
          {logs.length === 0 ? (
            <p className="text-[#6b7b6b]">No logs yet.</p>
          ) : (
            <ul className="space-y-2">
              {logs.map((log) => (
                <li
                  key={log.id}
                  className={`rounded-sm border-l-2 p-2 ${levelClassName[log.level]}`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-[10px] text-[#6b7b6b]">{formatTimestamp(log.timestamp)}</span>
                    <span
                      className={`rounded-sm border px-2 py-0.5 text-[10px] uppercase tracking-wider ${levelClassName[log.level]}`}
                    >
                      {log.level}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-[#c9d1d9]">{log.message}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
