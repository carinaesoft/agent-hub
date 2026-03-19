import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return isRecord(error) && typeof error.code === "string";
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function readAgentIdArg(): string {
  const agentId = process.argv[2]?.trim();
  if (!agentId) {
    throw new Error("Usage: npx tsx scripts/new-agent.ts <AGENT_ID>");
  }

  return agentId;
}

async function createAgentFromTemplate(agentId: string): Promise<void> {
  const repositoryRoot = process.cwd();
  const templateDir = path.join(repositoryRoot, "agents", "_template");
  const agentDir = path.join(repositoryRoot, "agents", agentId);
  const templateFiles = ["agent.config.json", "index.ts", "README.md"] as const;

  const templateExists = await pathExists(templateDir);
  if (!templateExists) {
    throw new Error("Template folder not found: agents/_template");
  }

  const agentDirExists = await pathExists(agentDir);
  if (agentDirExists) {
    throw new Error(`Agent folder already exists: agents/${agentId}`);
  }

  try {
    await mkdir(agentDir, { recursive: false });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown mkdir error";
    throw new Error(`Failed to create agents/${agentId}: ${message}`);
  }

  const createdPaths = [path.join("agents", agentId)];
  for (const templateFile of templateFiles) {
    const sourcePath = path.join(templateDir, templateFile);
    const destinationPath = path.join(agentDir, templateFile);

    try {
      await copyFile(sourcePath, destinationPath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown copy error";
      throw new Error(`Failed to copy ${templateFile}: ${message}`);
    }

    createdPaths.push(path.join("agents", agentId, templateFile));
  }

  for (const createdPath of createdPaths) {
    console.log(`Created ${createdPath}`);
  }
}

async function main(): Promise<void> {
  const agentId = readAgentIdArg();
  await createAgentFromTemplate(agentId);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Error: ${message}`);
  process.exit(1);
});
