import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface AgentConfig {
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  env: string[];
  params: Record<string, unknown>;
}

export const DEFAULT_CONFIG: AgentConfig = {
  name: "",
  description: "",
  model: "gpt-4o-mini",
  systemPrompt: "You are a helpful assistant.",
  temperature: 0.7,
  maxTokens: 4096,
  env: [],
  params: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return isRecord(error) && typeof error.code === "string";
}

function getConfigPath(agentId: string): string {
  return path.join(process.cwd(), "agents", agentId, "agent.config.json");
}

export async function getConfig(agentId: string): Promise<AgentConfig> {
  const configPath = getConfigPath(agentId);

  try {
    const configContent = await readFile(configPath, "utf8");

    try {
      const parsed = JSON.parse(configContent) as unknown;
      if (!isRecord(parsed)) {
        return { ...DEFAULT_CONFIG };
      }

      return { ...DEFAULT_CONFIG, ...(parsed as Partial<AgentConfig>) };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return { ...DEFAULT_CONFIG, name: agentId };
    }

    throw error;
  }
}

export async function saveConfig(agentId: string, config: AgentConfig): Promise<void> {
  const agentPath = path.join(process.cwd(), "agents", agentId);
  const configPath = getConfigPath(agentId);
  const payload = JSON.stringify(config, null, 2);

  await mkdir(agentPath, { recursive: true });
  await writeFile(configPath, payload, "utf8");
}
