import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import path from "node:path";

export interface RunOptions {
  agentId: string;
  config: Record<string, unknown>;
}

export interface AgentProcess {
  stop: () => void;
  events: EventEmitter;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function emitFallbackLog(events: EventEmitter, rawLine: string): void {
  events.emit("log", {
    type: "log",
    level: "info",
    message: rawLine,
    timestamp: new Date().toISOString(),
  });
}

function emitParsedOutput(events: EventEmitter, rawLine: string): void {
  const line = rawLine.trim();
  if (!line) {
    return;
  }

  try {
    const parsed = JSON.parse(line) as unknown;

    if (isRecord(parsed) && parsed.type === "log") {
      events.emit("log", parsed);
      return;
    }

    if (isRecord(parsed) && parsed.type === "result") {
      events.emit("result", parsed);
      return;
    }

    emitFallbackLog(events, rawLine);
  } catch {
    emitFallbackLog(events, rawLine);
  }
}

export function runAgent(options: RunOptions): AgentProcess {
  const events = new EventEmitter();
  const agentPath = path.join(process.cwd(), "agents", options.agentId, "index.ts");

  if (!existsSync(agentPath)) {
    queueMicrotask(() => {
      events.emit("error", { message: `Agent entry file not found: ${agentPath}` });
    });

    return {
      stop: () => undefined,
      events,
    };
  }

  const child = spawn("npx", ["tsx", agentPath], {
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const startTime = Date.now();
  let stdoutBuffer = "";

  try {
    child.stdin.write(JSON.stringify(options.config));
    child.stdin.end();
  } catch (error: unknown) {
    events.emit("error", { message: getErrorMessage(error) });
  }

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      emitParsedOutput(events, line);
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const message = chunk.toString().trimEnd();
    if (!message) {
      return;
    }

    events.emit("log", {
      type: "log",
      level: "error",
      message,
      timestamp: new Date().toISOString(),
    });
  });

  child.on("close", (exitCode) => {
    if (stdoutBuffer.trim().length > 0) {
      emitParsedOutput(events, stdoutBuffer);
    }

    events.emit("done", {
      exitCode,
      duration: Date.now() - startTime,
    });
  });

  child.on("error", (error) => {
    events.emit("error", { message: error.message });
  });

  return {
    stop: () => {
      child.kill("SIGTERM");
    },
    events,
  };
}
