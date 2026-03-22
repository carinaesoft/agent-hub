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

// ── Tool: zmail ──────────────────────────────────────────────

async function callZmail(
  apiKey: string,
  zmailUrl: string,
  action: string,
  params: Record<string, unknown>
): Promise<string> {
  const body: Record<string, unknown> = {
    apikey: apiKey,
    action,
    ...params,
  };

  const res = await fetch(zmailUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return await res.text();
}

// ── Tool: send_answer ────────────────────────────────────────

async function sendAnswer(
  apiKey: string,
  verifyUrl: string,
  task: string,
  answer: Record<string, string>
): Promise<string> {
  const res = await fetch(verifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: apiKey,
      task,
      answer,
    }),
  });

  return await res.text();
}

// ── Tool definitions ─────────────────────────────────────────

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "zmail",
      description:
        "Call the zmail API. First call with action 'help' to discover all actions and their exact parameters. Then use actions like getInbox, getThread, getMessages, search with the correct params.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description:
              "API action: help, getInbox, getThread, getMessages, search, reset",
          },
          params: {
            type: "object",
            description:
              "Additional params for the action — pass exactly what the API expects (e.g. threadID, ids, query, page, perPage). Check 'help' first to learn valid params.",
          },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_answer",
      description:
        "Send the final answer to the hub. Provide all three values. Use hub feedback to fix incorrect values.",
      parameters: {
        type: "object",
        properties: {
          password: {
            type: "string",
            description: "Password to the employee system",
          },
          date: {
            type: "string",
            description: "Attack date in YYYY-MM-DD format",
          },
          confirmation_code: {
            type: "string",
            description:
              "Security ticket confirmation code (SEC- + 32 chars = 36 total)",
          },
        },
        required: ["password", "date", "confirmation_code"],
      },
    },
  },
];

// ── Tool executor ────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  apiKey: string,
  zmailUrl: string,
  verifyUrl: string,
  task: string
): Promise<string> {
  switch (name) {
    case "zmail": {
      const action = args.action as string;
      const params = (args.params as Record<string, unknown>) ?? {};
      return await callZmail(apiKey, zmailUrl, action, params);
    }
    case "send_answer": {
      const answer: Record<string, string> = {};
      if (args.password) answer.password = args.password as string;
      if (args.date) answer.date = args.date as string;
      if (args.confirmation_code)
        answer.confirmation_code = args.confirmation_code as string;
      return await sendAnswer(apiKey, verifyUrl, task, answer);
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
  zmailUrl: string,
  verifyUrl: string,
  task: string,
  maxIterations: number
): Promise<string | undefined> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: config.systemPrompt },
    {
      role: "user",
      content: [
        "Search the operator's mailbox to find three pieces of information:",
        "1. DATE - when the security department plans to attack our power plant (format YYYY-MM-DD)",
        "2. PASSWORD - password to the employee system, still somewhere in this mailbox",
        "3. CONFIRMATION_CODE - confirmation code from a security department ticket (format: SEC- + 32 chars = 36 total)",
        "",
        "What we know:",
        "- Wiktor sent a tip from a proton.me domain",
        "- The mailbox is active — new messages may arrive while you work",
        "- Start by calling zmail with action 'help' to learn available API actions and their exact parameters",
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
        `Tool: ${fnName}(${JSON.stringify(fnArgs).substring(0, 200)})`
      );

      const toolResult = await executeTool(
        fnName,
        fnArgs,
        apiKey,
        zmailUrl,
        verifyUrl,
        task
      );

      log(
        "info",
        `  → ${toolResult.substring(0, 300)}${toolResult.length > 300 ? "..." : ""}`
      );

      if (fnName === "send_answer" && toolResult.includes("FLG:")) {
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
  const zmailUrl =
    (params.zmailUrl as string) ?? "https://hub.ag3nts.org/api/zmail";
  const verifyUrl =
    (params.verifyUrl as string) ?? "https://hub.ag3nts.org/verify";
  const task = (params.task as string) ?? "mailbox";
  const baseURL =
    (params.openrouterBaseURL as string) ?? "https://openrouter.ai/api/v1";
  const maxIterations = (params.maxIterations as number) ?? 25;

  log("info", "Agent started — Mailbox Search");

  const client = createClient(baseURL);
  const flagResponse = await runAgent(
    client,
    config,
    apiKey,
    zmailUrl,
    verifyUrl,
    task,
    maxIterations
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