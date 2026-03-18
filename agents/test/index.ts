import { log, readConfig, result } from "../../src/lib/agent-helpers";

interface TestAgentConfig {
  model?: string;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function main(): Promise<void> {
  const config = await readConfig<TestAgentConfig>();

  log("info", "Agent testowy uruchomiony");
  log("info", `Otrzymany model: ${config.model}`);

  await sleep(2000);

  log("info", "Przetwarzanie zakończone");
  result({ answer: "Hello from test agent!", model: config.model });

  process.exit(0);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  log("error", message);
  process.exit(1);
});
