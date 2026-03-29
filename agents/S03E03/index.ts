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
    verifyUrl: string;
    task: string;
    maxIterations: number;
    maxResponseChars?: number;
  };
}

// ── Reactor API types ───────────────────────────────────────
interface Block {
  col: number;
  top_row: number;
  bottom_row: number;
  direction: "up" | "down";
}

interface ReactorResponse {
  code: number;
  message: string;
  board?: string[][];
  player?: { col: number; row: number };
  goal?: { col: number; row: number };
  blocks?: Block[];
  reached_goal?: boolean;
}

// ── Safety analysis (programmatic support for LLM) ──────────
function predictBlockAfterMove(block: Block): Block {
  const b = { ...block };
  if (b.direction === "down") {
    if (b.bottom_row < 5) {
      b.top_row += 1;
      b.bottom_row += 1;
    } else {
      b.direction = "up";
      b.top_row -= 1;
      b.bottom_row -= 1;
    }
  } else {
    if (b.top_row > 1) {
      b.top_row -= 1;
      b.bottom_row -= 1;
    } else {
      b.direction = "down";
      b.top_row += 1;
      b.bottom_row += 1;
    }
  }
  return b;
}

function isColumnDangerous(blocks: Block[], col: number): boolean {
  return blocks.some(b => b.col === col && b.bottom_row === 5);
}

function buildSafetyAnalysis(data: ReactorResponse): string {
  if (!data.blocks || !data.player) return "No block data available.";

  const playerCol = data.player.col;
  const blocks = data.blocks;
  const predictedBlocks = blocks.map(predictBlockAfterMove);

  const lines: string[] = [];

  // Board visualization
  if (data.board) {
    lines.push("BOARD (top to bottom):");
    data.board.forEach((row, i) => {
      lines.push(`  Row ${i + 1}: ${row.join(" ")}`);
    });
    lines.push("");
  }

  lines.push(`Robot at column ${playerCol}/7 (goal: column 7)`);
  lines.push("");

  // Analyze columns: current, right, left
  const cols = [
    { label: "CURRENT", col: playerCol },
    { label: "RIGHT  ", col: playerCol + 1 },
    { label: "LEFT   ", col: playerCol - 1 },
  ];

  for (const c of cols) {
    if (c.col < 1 || c.col > 7) {
      lines.push(`${c.label} (col ${c.col}): OUT OF BOUNDS`);
      continue;
    }

    const dangerNow = isColumnDangerous(blocks, c.col);
    const dangerAfter = isColumnDangerous(predictedBlocks, c.col);

    let status: string;
    if (!dangerNow && !dangerAfter) {
      status = "SAFE now, SAFE after move ✅";
    } else if (!dangerNow && dangerAfter) {
      status = "SAFE now, DANGEROUS after move ⚠️";
    } else if (dangerNow && !dangerAfter) {
      status = "DANGEROUS now, SAFE after move ⚠️";
    } else {
      status = "DANGEROUS now, DANGEROUS after move ❌";
    }

    lines.push(`${c.label} (col ${c.col}): ${status}`);

    // Show relevant blocks
    const colBlocks = blocks.filter(b => b.col === c.col);
    for (const b of colBlocks) {
      const pb = predictedBlocks.find(pb => pb.col === b.col)!;
      lines.push(`    Block: rows ${b.top_row}-${b.bottom_row} moving ${b.direction} → will be rows ${pb.top_row}-${pb.bottom_row}`);
    }
  }

  // Recommendation
  lines.push("");
  const rightCol = playerCol + 1;
  const leftCol = playerCol - 1;

  const rightSafeAfter = rightCol <= 7 && !isColumnDangerous(predictedBlocks, rightCol);
  const currentSafeAfter = !isColumnDangerous(predictedBlocks, playerCol);
  const leftSafeAfter = leftCol >= 1 && !isColumnDangerous(predictedBlocks, leftCol);

  if (playerCol >= 7) {
    lines.push("RECOMMENDATION: You are at the goal! 🎉");
  } else if (rightSafeAfter) {
    lines.push("RECOMMENDATION: Move RIGHT — next column will be safe after move.");
  } else if (currentSafeAfter) {
    lines.push("RECOMMENDATION: WAIT — current column stays safe, right column not safe yet.");
  } else if (leftSafeAfter) {
    lines.push("RECOMMENDATION: Move LEFT — current column becoming dangerous!");
  } else {
    lines.push("RECOMMENDATION: WAIT — evaluate carefully, all options have risk.");
  }

  if (data.reached_goal) {
    lines.push("\n🎉 GOAL REACHED! The robot has delivered the cooling module!");
  }

  return lines.join("\n");
}

// ── Tool implementation ─────────────────────────────────────
async function sendCommand(
  command: string,
  apiKey: string,
  verifyUrl: string,
  task: string,
): Promise<{ analysis: string; reachedGoal: boolean; flagFound: boolean; raw: string }> {
  log("info", `Robot command: ${command}`);

  const res = await fetch(verifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: apiKey,
      task,
      answer: { command },
    }),
  });

  const data = (await res.json()) as ReactorResponse;
  const raw = JSON.stringify(data);

  const flagFound = typeof data.message === "string" && data.message.includes("FLG:");
  if (flagFound) {
    log("info", `FLAG FOUND: ${data.message}`);
  }

  const analysis = buildSafetyAnalysis(data);
  log("info", `Safety analysis:\n${analysis}`);

  return {
    analysis: flagFound ? `${data.message}\n\n${analysis}` : analysis,
    reachedGoal: data.reached_goal === true,
    flagFound,
    raw,
  };
}

// ── Tool definitions ────────────────────────────────────────
const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "reactor_command",
      description:
        "Send a command to the reactor robot. Returns board state and safety analysis. Commands: 'start' (begin game), 'right' (move toward goal), 'left' (retreat), 'wait' (stay, blocks move), 'reset' (restart).",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            enum: ["start", "right", "left", "wait", "reset"],
            description: "The command to send to the robot.",
          },
        },
        required: ["command"],
      },
    },
  },
];

// ── Agent loop ──────────────────────────────────────────────
async function main(): Promise<void> {
  const config = await readConfig<AgentConfig>();

  if (!config.model || !config.params?.verifyUrl) {
    throw new Error("Missing required config fields (model, params.verifyUrl)");
  }

  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API_KEY env var is required");

  const params = config.params;
  log("info", `Starting S03E03 — Reactor Navigator (model: ${config.model})`);

  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY ?? "missing",
    baseURL: "https://openrouter.ai/api/v1",
  });

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: config.systemPrompt },
    {
      role: "user",
      content: "Navigate the robot from column 1 to column 7. Start by sending the 'start' command, then use the safety analysis to decide each move.",
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

    if (assistantMessage.content) {
      log("agent", assistantMessage.content);
    }

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      if (choice.finish_reason === "stop") {
        if (flagFound) break;
        log("info", "Model stopped — nudging to continue.");
        messages.push({
          role: "user",
          content: "Keep going. Send commands until the robot reaches column 7.",
        });
        continue;
      }
      continue;
    }

    for (const toolCall of assistantMessage.tool_calls) {
      if (toolCall.type !== "function") continue;

      const args = JSON.parse(toolCall.function.arguments) as Record<string, string>;
      const { analysis, reachedGoal, flagFound: flag } = await sendCommand(
        args.command,
        apiKey,
        params.verifyUrl,
        params.task,
      );

      if (flag) flagFound = true;

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: analysis,
      });

      if (reachedGoal && !flagFound) {
        log("info", "Goal reached but no flag yet — message may contain it.");
      }
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