import path from "path";
import sharp from "sharp";
import OpenAI from "openai";
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

// ── Grid positions (measured from actual images) ─────────────
// Current board (800x450): grid lines at x=[238,333,428,523], y=[100,196,291,384]
// Target board  (598x422): grid lines at x=[141,237,332,427], y=[90,186,281,374]

const CURRENT_CELLS = {
  cols: [[241, 330], [336, 425], [431, 520]] as [number, number][],
  rows: [[103, 193], [199, 288], [294, 381]] as [number, number][],
};

const TARGET_CELLS = {
  cols: [[144, 234], [240, 329], [335, 424]] as [number, number][],
  rows: [[93, 183], [189, 278], [284, 371]] as [number, number][],
};

async function extractCell(
  buffer: Buffer,
  row: number,
  col: number,
  grid: typeof CURRENT_CELLS
): Promise<Buffer> {
  const [left, right] = grid.cols[col];
  const [top, bottom] = grid.rows[row];

  return sharp(buffer)
    .extract({ left, top, width: right - left, height: bottom - top })
    .png()
    .toBuffer();
}

// ── Vision: ask model about ONE tile pair ────────────────────

async function getRotationsForTile(
  client: OpenAI,
  visionModel: string,
  prompt: string,
  currentCell: Buffer,
  targetCell: Buffer,
  position: string
): Promise<number> {
  const currentB64 = currentCell.toString("base64");
  const targetB64 = targetCell.toString("base64");

  try {
    const response = await client.chat.completions.create({
      model: visionModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${currentB64}` },
            },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${targetB64}` },
            },
          ],
        },
      ],
      max_tokens: 10,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    const digit = parseInt(raw.charAt(0), 10);

    if (isNaN(digit) || digit < 0 || digit > 3) {
      log("warn", `Tile ${position}: unexpected response "${raw}", defaulting to 0`);
      return 0;
    }

    return digit;
  } catch (err: unknown) {
    const detail = (err as Record<string, unknown>)?.message ?? String(err);
    log("error", `Vision error for ${position}: ${detail}`);
    return 0;
  }
}

// ── Rotate + verify ──────────────────────────────────────────

async function rotateCell(
  apiKey: string,
  verifyUrl: string,
  task: string,
  position: string
): Promise<{ message: string; flag?: string }> {
  const res = await fetch(verifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: apiKey,
      task,
      answer: { rotate: position },
    }),
  });

  const text = await res.text();
  try {
    return JSON.parse(text) as { message: string; flag?: string };
  } catch {
    return { message: "Invalid response" };
  }
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = await readConfig<AgentConfig>();
  const params = config.params ?? {};
  const apiKey = process.env.API_KEY ?? "";
  const verifyUrl = (params.verifyUrl as string) ?? "https://hub.ag3nts.org/verify";
  const task = (params.task as string) ?? "electricity";
  const visionModel = (params.visionModel as string) ?? "google/gemini-3-flash-preview";
  const baseURL = (params.openrouterBaseURL as string) ?? "https://openrouter.ai/api/v1";

  log("info", "Agent started — Electricity Puzzle (crop + vision per tile)");
  const client = createClient(baseURL);

  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    log("info", `── Attempt ${attempt}/${MAX_ATTEMPTS} ──`);

    // 1. Reset board and fetch both images
    log("info", "Resetting and fetching images...");
    const currentRes = await fetch(
      `https://hub.ag3nts.org/data/${apiKey}/electricity.png?reset=1`
    );
    const currentBuffer = Buffer.from(await currentRes.arrayBuffer());

    const targetRes = await fetch("https://hub.ag3nts.org/i/solved_electricity.png");
    const targetBuffer = Buffer.from(await targetRes.arrayBuffer());

    // 2. For each cell: crop both, ask vision model how many rotations
    log("info", `Analyzing 9 tiles with ${visionModel}...`);
    const plan: Record<string, number> = {};

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const position = `${row + 1}x${col + 1}`;

        const currentCell = await extractCell(currentBuffer, row, col, CURRENT_CELLS);
        const targetCell = await extractCell(targetBuffer, row, col, TARGET_CELLS);

        const rotations = await getRotationsForTile(
          client,
          visionModel,
          config.systemPrompt, // <── prompt z agent.config.json
          currentCell,
          targetCell,
          position
        );

        plan[position] = rotations;
        log("info", `  ${position}: ${rotations === 0 ? "✓ OK" : `↻ ${rotations}x`}`);
      }
    }

    // 3. Filter and execute rotations
    const active = Object.entries(plan).filter(([, count]) => count > 0);
    const totalRotations = active.reduce((sum, [, count]) => sum + count, 0);

    if (active.length === 0) {
      log("info", "No rotations needed — board should be solved!");
      break;
    }

    log("info", `Executing ${totalRotations} rotations across ${active.length} cells...`);

    for (const [position, count] of active) {
      for (let i = 0; i < count; i++) {
        log("info", `Rotating ${position} (${i + 1}/${count})`);
        const rotResult = await rotateCell(apiKey, verifyUrl, task, position);
        log("info", `  → ${rotResult.message}`);

        if (rotResult.flag) {
          log("info", `FLAG FOUND: ${rotResult.flag}`);
          result({ status: "done", flag: rotResult.flag });
          return;
        }
      }
    }
  }

  log("warn", "No flag after all attempts");
  result({ status: "done", flag: null });
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    log("error", err instanceof Error ? err.message : "Unknown error");
    process.exit(1);
  });