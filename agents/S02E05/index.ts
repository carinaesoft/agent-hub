import path from "path";
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { readConfig, log, result } from "../../src/lib/agent-helpers";

// ── Types ────────────────────────────────────────────────────

interface AgentConfig {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  env: string[];
  params: Record<string, unknown>;
}

// ── Helpers ──────────────────────────────────────────────────

const agentDir = path.dirname(new URL(import.meta.url).pathname);
const resolveLocal = (file: string) => path.join(agentDir, file);
void resolveLocal;

function createClient(baseURL: string): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY ?? "missing-openrouter-api-key",
    baseURL,
  });
}

// ── Step 1: Vision — analyze map to find dam sector ──────────

async function analyzeMap(
  client: OpenAI,
  visionModel: string,
  mapUrl: string
): Promise<string> {
  log("info", `Analyzing map with ${visionModel}...`);

  const response = await client.chat.completions.create({
    model: visionModel,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "This aerial photo has a RED grid overlay. Count the red lines carefully:",
              "- How many VERTICAL red lines divide the image? That gives you columns.",
              "- How many HORIZONTAL red lines divide the image? That gives you rows.",
              "Note: this image is landscape (wider than tall), so there are FEWER columns than rows.",
              "The dam has bright turquoise/cyan water — it's at the very BOTTOM CENTER of the image.",
              "",
              "Respond ONLY: COLUMNS: n, ROWS: n, DAM_SECTOR: x,y",
            ].join("\n"),
          },
          {
            type: "image_url",
            image_url: { url: mapUrl },
          },
        ],
      },
    ],
    max_tokens: 200,
  });

  const answer = response.choices[0]?.message?.content ?? "";
  log("info", `Vision response: ${answer}`);
  return answer;
}

// ── Tool: send_instructions ──────────────────────────────────

async function sendInstructions(
  apiKey: string,
  verifyUrl: string,
  task: string,
  instructions: string[]
): Promise<string> {
  const res = await fetch(verifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: apiKey,
      task,
      answer: { instructions },
    }),
  });

  return await res.text();
}

// ── Tool definitions ─────────────────────────────────────────

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "send_instructions",
      description:
        "Send an array of drone API instructions to the hub. Returns the drone's response or error messages. Use feedback to fix and retry.",
      parameters: {
        type: "object",
        properties: {
          instructions: {
            type: "array",
            items: { type: "string" },
            description:
              'Array of drone instruction strings, e.g. ["setDestinationObject(PWR6132PL)", "set(2,4)", "set(engineON)", "flyToLocation"]',
          },
        },
        required: ["instructions"],
      },
    },
  },
];

// ── Tool executor ────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  apiKey: string,
  verifyUrl: string,
  task: string
): Promise<string> {
  switch (name) {
    case "send_instructions": {
      const instructions = args.instructions as string[];
      return await sendInstructions(apiKey, verifyUrl, task, instructions);
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// ── Agent loop ───────────────────────────────────────────────

async function runAgent(
  client: OpenAI,
  config: AgentConfig,
  apiKey: string,
  verifyUrl: string,
  task: string,
  maxIterations: number,
  mapAnalysis: string
): Promise<string | undefined> {
  const droneApiDocs = `
DRONE API REFERENCE (DRN-BMB7):
- setDestinationObject(ID) — set flight target. ID format: [A-Z]{3}[0-9]+[A-Z]{2}, e.g. PWR6132PL
- set(x,y) — set landing sector on target map. x=column, y=row. Top-left is 1,1.
- set(engineON) / set(engineOFF) — toggle engines
- set(power%) — engine power 0%-100%, e.g. set(100%)
- set(Xm) — flight altitude 1m-100m, e.g. set(50m)
- flyToLocation — execute flight (requires altitude, destination, sector set first)
- set(destroy) — mission goal: destroy target
- set(video) / set(image) / set(return) — other mission goals
- selfCheck — run diagnostics
- getConfig — get current config
- hardReset — factory reset
- calibrateCompass / calibrateGPS — calibration

Multiple mission goals can be set. Order doesn't matter — drone AI executes them correctly.
  `.trim();

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: config.systemPrompt },
    {
      role: "user",
      content: [
        "MISSION: Program the drone to officially fly to power plant PWR6132PL to destroy it,",
        "but actually drop the bomb on the nearby DAM to release water for the cooling system.",
        "",
        `MAP ANALYSIS (from vision model): ${mapAnalysis}`,
        "",
        droneApiDocs,
        "",
        "The destination object must be the power plant (PWR6132PL).",
        "The landing sector must be the dam's sector from the map analysis.",
        "Set up the drone and send instructions. Read API error messages carefully and adjust.",
      ].join("\n"),
    },
  ];

  for (let i = 0; i < maxIterations; i++) {
    log("info", `── Iteration ${i + 1}/${maxIterations} ──`);

    const response = await client.chat.completions.create({
      model: config.model,
      messages,
      tools,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    });

    const choice = response.choices[0];
    if (!choice) break;

    const assistantMessage = choice.message;
    messages.push(assistantMessage);

    if (
      !assistantMessage.tool_calls ||
      assistantMessage.tool_calls.length === 0
    ) {
      log(
        "info",
        `Agent says: ${assistantMessage.content?.substring(0, 200) ?? "(empty)"}`
      );
      break;
    }

    for (const toolCall of assistantMessage.tool_calls) {
      if (toolCall.type !== "function") continue;

      const fnName = toolCall.function.name;
      const fnArgs = JSON.parse(toolCall.function.arguments) as Record<
        string,
        unknown
      >;

      log(
        "info",
        `Tool: ${fnName}(${JSON.stringify(fnArgs).substring(0, 300)})`
      );

      const toolResult = await executeTool(
        fnName,
        fnArgs,
        apiKey,
        verifyUrl,
        task
      );

      log(
        "info",
        `  → ${toolResult.substring(0, 400)}${toolResult.length > 400 ? "..." : ""}`
      );

      if (toolResult.includes("FLG:")) {
        log("info", "FLAG FOUND!");
        return toolResult;
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolResult,
      });
    }
  }

  return undefined;
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = await readConfig<AgentConfig>();
  const params = config.params ?? {};
  const apiKey = process.env.API_KEY ?? "";
  const verifyUrl =
    (params.verifyUrl as string) ?? "https://hub.ag3nts.org/verify";
  const task = (params.task as string) ?? "drone";
  const baseURL =
    (params.openrouterBaseURL as string) ?? "https://openrouter.ai/api/v1";
  const maxIterations = (params.maxIterations as number) ?? 15;
  const visionModel =
    (params.visionModel as string) ?? "openai/gpt-4o";
  const mapUrl = `https://hub.ag3nts.org/data/${apiKey}/drone.png`;

  log("info", "Agent started — Drone Mission");

  const client = createClient(baseURL);

  // Step 1: Analyze map with vision model to find dam sector
  const mapAnalysis = await analyzeMap(client, visionModel, mapUrl);

  // Step 2: Agent loop — build instructions, send, iterate on feedback
  const flagResponse = await runAgent(
    client,
    config,
    apiKey,
    verifyUrl,
    task,
    maxIterations,
    mapAnalysis
  );

  if (flagResponse) {
    log("info", `Done! ${flagResponse.substring(0, 300)}`);
    result({ status: "done", response: flagResponse });
  } else {
    log("warn", "Agent finished without flag");
    result({ status: "done", flag: null });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    log("error", err instanceof Error ? err.message : "Unknown error");
    process.exit(1);
  });