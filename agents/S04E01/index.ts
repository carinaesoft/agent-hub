import path from "path";
import OpenAI from "openai";
import { readConfig, log, result } from "../../src/lib/agent-helpers";

// ── Config type ─────────────────────────────────────────────
// Extend params with your agent-specific settings
interface AgentConfig {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  env: string[];
  params: Record<string, unknown>;
}

// ── Helpers ─────────────────────────────────────────────────
const agentDir = path.dirname(new URL(import.meta.url).pathname);
const resolveLocal = (file: string) => path.join(agentDir, file);
void resolveLocal;

function createClient(baseURL: string): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY ?? "missing-openrouter-api-key",
    baseURL,
  });
}

// ── Main ────────────────────────────────────────────────────
async function main(): Promise<void> {
  const config = await readConfig<AgentConfig>();
  const params = (config.params as Record<string, unknown> | undefined) ?? {};
  log("info", "Agent started");

  // OpenAI client (remove if agent doesn't use LLM)
  const baseURL =
    typeof params.openrouterBaseURL === "string"
      ? params.openrouterBaseURL
      : "https://openrouter.ai/api/v1";
  const client = createClient(baseURL);
  void client;

  // TODO: implement your agent logic here
  //
  // Use log() to report progress:
  //   log("info", "Processing data...")
  //   log("warn", "Something looks off")
  //   log("error", "Something failed")
  //
  // Use config.params for agent-specific settings:
  //   const endpoint = config.params.verifyEndpoint as string
  //
  // Use resolveLocal() for files in agent folder:
  //   const data = fs.readFileSync(resolveLocal("data.csv"), "utf-8")
  //
  // Use process.env for secrets:
  //   const apiKey = process.env.API_KEY
  //
  // When done, emit result:
  //   result({ answer: "..." })

  log("info", "Agent finished");
  result({ status: "ok" });
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    log("error", err instanceof Error ? err.message : "Unknown error");
    process.exit(1);
  });
