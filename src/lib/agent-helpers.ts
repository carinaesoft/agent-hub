export type LogLevel = "info" | "warn" | "error" | "debug";

type AgentEvent =
  | {
      type: "log";
      level: LogLevel;
      message: string;
      timestamp: string;
    }
  | {
      type: "result";
      data: unknown;
      timestamp: string;
    };

function writeJsonLine(event: AgentEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

export async function readConfig<T>(): Promise<T> {
  const chunks: string[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }

  const input = chunks.join("").trim();
  if (!input) {
    return {} as T;
  }

  try {
    return JSON.parse(input) as T;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid JSON input";
    throw new Error(`Failed to parse stdin JSON: ${message}`);
  }
}

export function log(level: LogLevel, message: string): void {
  writeJsonLine({
    type: "log",
    level,
    message,
    timestamp: new Date().toISOString(),
  });
}

export function result(data: unknown): void {
  writeJsonLine({
    type: "result",
    data,
    timestamp: new Date().toISOString(),
  });
}
