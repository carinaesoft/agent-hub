import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  hasConfig: boolean;
}

interface AgentConfigMetadata {
  name?: string;
  description?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return isRecord(error) && typeof error.code === "string";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function readConfigMetadata(configPath: string): Promise<AgentConfigMetadata> {
  try {
    const configContent = await readFile(configPath, "utf8");

    try {
      const parsed = JSON.parse(configContent) as unknown;
      if (!isRecord(parsed)) {
        return {};
      }

      return {
        name: typeof parsed.name === "string" ? parsed.name : undefined,
        description: typeof parsed.description === "string" ? parsed.description : undefined,
      };
    } catch {
      return {};
    }
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

export async function scanAgents(): Promise<AgentInfo[]> {
  const agentsPath = path.join(process.cwd(), "agents");
  let entries: Array<{ name: string; isDirectory: () => boolean }>;

  try {
    entries = await readdir(agentsPath, { withFileTypes: true });
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const directories = entries.filter((entry) => entry.isDirectory());
  const scannedAgents = await Promise.all(
    directories.map(async (directory): Promise<AgentInfo | null> => {
      const id = directory.name;
      const agentDir = path.join(agentsPath, id);
      const entryFilePath = path.join(agentDir, "index.ts");
      const configPath = path.join(agentDir, "agent.config.json");

      const hasEntryFile = await fileExists(entryFilePath);
      if (!hasEntryFile) {
        return null;
      }

      const hasConfig = await fileExists(configPath);
      const configMetadata = hasConfig ? await readConfigMetadata(configPath) : {};

      return {
        id,
        name: configMetadata.name && configMetadata.name.length > 0 ? configMetadata.name : id,
        description: configMetadata.description ?? "",
        hasConfig,
      };
    }),
  );

  return scannedAgents
    .filter((agent): agent is AgentInfo => agent !== null)
    .sort((left, right) => left.id.localeCompare(right.id));
}
