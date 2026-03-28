import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { readConfig, log, result } from "../../src/lib/agent-helpers";

// ── Config ──────────────────────────────────────────────────
interface AgentConfig {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  env: string[];
  params: {
    shellUrl: string;
    verifyUrl: string;
    task: string;
    maxIterations: number;
    banRetryDelayMs: number;
    maxBanRetries: number;
    maxResponseChar?: number;

  };
}

// ── Shell API types ─────────────────────────────────────────
interface ShellResponse {
  code: number;
  message: string;
  data?: unknown;
  path?: string;
  maxResponseChars?: number;
  ban?: {
    command: string;
    reason: string;
    ttl_seconds?: number;
    seconds_left?: number;
  };
  reboot?: boolean;
}

// ── Tool implementations ────────────────────────────────────
async function shellCommand(
  cmd: string,
  apiKey: string,
  shellUrl: string,
  banRetryDelayMs: number,
  maxBanRetries: number,
  maxResponseChar: number,
): Promise<string> {
  log("info", `Shell> ${cmd}`);

  for (let attempt = 0; attempt <= maxBanRetries; attempt++) {
    const res = await fetch(shellUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: apiKey, cmd }),
    });

    if (!res.ok) {
      const text = await res.text();
      return `HTTP error ${res.status}: ${text}`;
    }

    const data = (await res.json()) as ShellResponse;

    // Ban — wait and retry
    if (data.code === -733 || data.code === -735) {
      const waitSec = data.ban?.seconds_left ?? data.ban?.ttl_seconds ?? 25;
      const waitMs = Math.max(waitSec * 1000, banRetryDelayMs);
      log("warn", `Ban detected (code ${data.code}): ${data.ban?.reason ?? data.message}. Waiting ${Math.ceil(waitMs / 1000)}s...`);

      if (data.reboot) {
        log("warn", "VM was rebooted due to security violation.");
      }

      await new Promise((r) => setTimeout(r, waitMs));

      if (attempt < maxBanRetries) {
        log("info", `Retrying command after ban (attempt ${attempt + 2}/${maxBanRetries + 1})...`);
        continue;
      }

      return `BANNED: Could not execute after ${maxBanRetries + 1} attempts. Last reason: ${data.ban?.reason ?? data.message}`;
    }

    // Format response for LLM
    const parts: string[] = [`[code: ${data.code}] ${data.message}`];

    if (data.path) {
      parts.push(`Path: ${data.path}`);
    }

    if (data.data !== undefined) {
      if (Array.isArray(data.data)) {
        parts.push(data.data.join("\n"));
      } else if (typeof data.data === "string") {
        parts.push(data.data);
      } else {
        parts.push(JSON.stringify(data.data, null, 2));
      }
    }

    const output = parts.join("\n");
    log("info", `Shell result:\n${output}`);

    // Truncate huge responses to protect context window
    if (output.length > maxResponseChar) {
      const truncated = output.slice(0, maxResponseChar);
      log("warn", `Response truncated from ${output.length} to ${maxResponseChar} chars`);
      return truncated + `\n\n[TRUNCATED — response was ${output.length} chars. This is likely a binary file, don't cat it.]`;
    }

    return output;
  }

  return "BANNED: Max retries exceeded.";
}

async function verifyAnswer(
  confirmation: string,
  apiKey: string,
  verifyUrl: string,
  task: string,
): Promise<string> {
  log("info", `Verifying answer: ${confirmation}`);

  const res = await fetch(verifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: apiKey,
      task,
      answer: { confirmation },
    }),
  });

  const data = await res.json();
  const output = JSON.stringify(data, null, 2);
  log("info", `Verify response:\n${output}`);
  return output;
}

// ── Tool definitions ────────────────────────────────────────
const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "shell_command",
      description:
        "Execute a command on the restricted Linux VM. Available: help, ls, cat, cd, pwd, rm, editline, find, reboot, date, uptime, history, whoami. NO flags (e.g. ls -la won't work). NEVER access /etc, /root, /proc or files listed in .gitignore.",
      parameters: {
        type: "object",
        properties: {
          cmd: {
            type: "string",
            description: "The command to execute, e.g. 'ls /opt/firmware/cooler' or 'editline /path/file 3 new content'",
          },
        },
        required: ["cmd"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "verify_answer",
      description: "Send the ECCS confirmation code to the verification endpoint. Use when you have the code in format ECCS-xxxx...",
      parameters: {
        type: "object",
        properties: {
          confirmation: {
            type: "string",
            description: "The ECCS confirmation code obtained from running cooler.bin",
          },
        },
        required: ["confirmation"],
      },
    },
  },
];

// ── Agent loop ──────────────────────────────────────────────
async function main(): Promise<void> {
  const config = await readConfig<AgentConfig>();

  if (!config.model || !config.params?.shellUrl) {
    throw new Error("Missing required config fields (model, params.shellUrl)");
  }

  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API_KEY env var is required");

  const params = config.params;

  log("info", `Starting S03E02 — Firmware Debugger (model: ${config.model})`);

  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY ?? "missing",
    baseURL: "https://openrouter.ai/api/v1",
  });

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: config.systemPrompt },
    {
      role: "user",
      content:
        "Start debugging the ECCS cooler firmware. Your goal is to get /opt/firmware/cooler/cooler.bin running and extract the ECCS confirmation code. Begin by exploring the system.",
    },
  ];

  let flagFound = false;

  for (let i = 0; i < params.maxIterations; i++) {
    log("info", `── Iteration ${i + 1}/${params.maxIterations} ──`);

    const response = await client.chat.completions.create({
      model: config.model,
      messages,
      tools,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    });

    const choice = response.choices[0];
    if (!choice) {
      log("error", "No choice in LLM response");
      break;
    }

    const assistantMessage = choice.message;
    messages.push(assistantMessage);

    // Log any text the model says
    if (assistantMessage.content) {
      log("agent", assistantMessage.content);
    }

    // No tool calls — model is done talking
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      if (choice.finish_reason === "stop" && !flagFound) {
        const nudgeDelayMs = params.banRetryDelayMs ?? 5000;
        log("info", `Model stopped without tool calls — waiting ${nudgeDelayMs / 1000}s then nudging to continue.`);
        await new Promise((r) => setTimeout(r, nudgeDelayMs));
        messages.push({
          role: "user",
          content: "Continue working. If you were banned, the ban has now expired. Keep exploring and fix the firmware. You haven't found the ECCS code yet.",
        });
        continue;
      }
      continue;
    }

    // Execute tool calls
    for (const toolCall of assistantMessage.tool_calls) {

      if (toolCall.type !== "function") continue;

      const args = JSON.parse(toolCall.function.arguments) as Record<string, string>;
      let toolResult: string;

      if (toolCall.function.name === "shell_command") {
        toolResult = await shellCommand(
          args.cmd,
          apiKey,
          params.shellUrl,
          params.banRetryDelayMs,
          params.maxBanRetries,
          params.maxResponseChar ?? 2000,  // ← dodaj to

        );
      } else if (toolCall.function.name === "verify_answer") {
        toolResult = await verifyAnswer(
          args.confirmation,
          apiKey,
          params.verifyUrl,
          params.task,
        );

        if (toolResult.includes("FLG:")) {
          flagFound = true;
        }
      } else {
        toolResult = `Unknown tool: ${toolCall.function.name}`;
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolResult,
      });
    }

    if (flagFound) {
      log("info", "Flag found! Agent complete.");
      break;
    }
  }

  if (!flagFound) {
    log("warn", "Agent finished without finding the flag.");
  }

  result({ flagFound });
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    log("error", err instanceof Error ? `${err.message}\n${err.stack}` : String(err));
    process.exit(1);
  });