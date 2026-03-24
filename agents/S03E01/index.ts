import path from "path";
import fs from "fs";
import OpenAI from "openai";
import { readConfig, log, result } from "../../src/lib/agent-helpers";

// ── Types ───────────────────────────────────────────────────

interface AgentConfig {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  env: string[];
  params: {
    dataDir: string;
    verifyUrl: string;
    task: string;
    batchSize: number;
    openrouterBaseURL?: string;
  };
}

interface SensorReading {
  sensor_type: string;
  timestamp: number;
  temperature_K: number;
  pressure_bar: number;
  water_level_meters: number;
  voltage_supply_v: number;
  humidity_percent: number;
  operator_notes: string;
}

// ── Constants ───────────────────────────────────────────────

const SENSOR_FIELD_MAP: Record<string, keyof SensorReading> = {
  temperature: "temperature_K",
  pressure: "pressure_bar",
  water: "water_level_meters",
  voltage: "voltage_supply_v",
  humidity: "humidity_percent",
};

const VALID_RANGES: Record<string, [number, number]> = {
  temperature_K: [553, 873],
  pressure_bar: [60, 160],
  water_level_meters: [5.0, 15.0],
  voltage_supply_v: [229.0, 231.0],
  humidity_percent: [40.0, 80.0],
};

// ── Helpers ─────────────────────────────────────────────────

const agentDir = path.dirname(new URL(import.meta.url).pathname);

function createClient(baseURL: string): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY ?? "missing-openrouter-api-key",
    baseURL,
  });
}

function loadSensorFiles(dataDir: string): Map<string, SensorReading> {
  const resolvedDir = path.isAbsolute(dataDir)
    ? dataDir
    : path.resolve(agentDir, dataDir);

  const files = fs.readdirSync(resolvedDir).filter((f) => f.endsWith(".json"));
  const readings = new Map<string, SensorReading>();

  for (const file of files) {
    const id = file.replace(".json", "");
    const content = fs.readFileSync(path.join(resolvedDir, file), "utf-8");
    readings.set(id, JSON.parse(content) as SensorReading);
  }

  return readings;
}

// ── Programmatic validation ─────────────────────────────────

function validateData(id: string, reading: SensorReading): string[] {
  const issues: string[] = [];
  const activeSensors = new Set(reading.sensor_type.split("/"));

  // Check 1: active sensor values out of range
  for (const sensor of activeSensors) {
    const field = SENSOR_FIELD_MAP[sensor];
    if (!field) continue;
    const range = VALID_RANGES[field];
    if (!range) continue;
    const value = reading[field] as number;
    if (value < range[0] || value > range[1]) {
      issues.push(`OUT_OF_RANGE: ${field}=${value} (expected ${range[0]}-${range[1]})`);
    }
  }

  // Check 2: inactive sensor reports non-zero value
  for (const [sensor, field] of Object.entries(SENSOR_FIELD_MAP)) {
    if (!activeSensors.has(sensor) && (reading[field] as number) !== 0) {
      issues.push(`UNEXPECTED_DATA: inactive sensor "${sensor}" has ${field}=${reading[field]}`);
    }
  }

  return issues;
}

// ── LLM note classification (batch + dedup + minimal output) ─

async function classifyNotes(
  client: OpenAI,
  uniqueNotes: string[],
  config: AgentConfig
): Promise<Map<string, "POSITIVE" | "NEGATIVE">> {
  const cache = new Map<string, "POSITIVE" | "NEGATIVE">();
  const batchSize = config.params.batchSize;

  for (let i = 0; i < uniqueNotes.length; i += batchSize) {
    const batch = uniqueNotes.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(uniqueNotes.length / batchSize);
    log("info", `Classifying notes batch ${batchNum}/${totalBatches} (${batch.length} notes)`);

    const numbered = batch.map((note, idx) => ({ id: i + idx, t: note }));

    const response = await client.chat.completions.create({
      model: config.model,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      messages: [
        { role: "system", content: config.systemPrompt },
        { role: "user", content: JSON.stringify(numbered) },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "[]";
    try {
      const cleaned = raw.replace(/```json\s*|```/g, "").trim();
      const results = JSON.parse(cleaned) as { id: number; s: string }[];
      for (const r of results) {
        const note = uniqueNotes[r.id];
        if (note !== undefined) {
          cache.set(note, r.s === "N" ? "NEGATIVE" : "POSITIVE");
        }
      }
      log("info", `  → batch ${batchNum}: classified ${results.length}/${batch.length} notes`);
    } catch (err) {
      log("error", `Failed to parse LLM response for batch ${batchNum}: ${raw.slice(0, 200)}`);
    }
  }

  return cache;
}

// ── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = await readConfig<AgentConfig>();
  const params = config.params;

  log("info", "Starting S03E01 — Sensor Anomaly Detector");

  // ── Step 1: Load data ─────────────────────────────────────
  const readings = loadSensorFiles(params.dataDir);
  log("info", `Loaded ${readings.size} sensor files`);

  // ── Step 2: Programmatic validation ───────────────────────
  const dataIssues = new Map<string, string[]>();
  for (const [id, reading] of readings) {
    const issues = validateData(id, reading);
    if (issues.length > 0) {
      dataIssues.set(id, issues);
    }
  }
  log("info", `Programmatic check: ${dataIssues.size} files with data issues`);

  // ── Step 3: Deduplicate notes ─────────────────────────────
  const uniqueNotes: string[] = [];
  const noteSet = new Set<string>();
  for (const reading of readings.values()) {
    if (!noteSet.has(reading.operator_notes)) {
      noteSet.add(reading.operator_notes);
      uniqueNotes.push(reading.operator_notes);
    }
  }
  log("info", `Unique operator notes: ${uniqueNotes.length} (out of ${readings.size})`);

  // ── Step 4: Classify notes via LLM ────────────────────────
  const baseURL = params.openrouterBaseURL ?? "https://openrouter.ai/api/v1";
  const client = createClient(baseURL);

  const noteClassifications = await classifyNotes(client, uniqueNotes, config);
  log("info", `Classified ${noteClassifications.size} unique notes`);

  // ── Step 5: Cross-reference → find all anomalies ──────────
  const anomalies = new Map<string, string[]>();

  for (const [id, reading] of readings) {
    const reasons: string[] = [];
    const hasDataIssue = dataIssues.has(id);
    const noteSentiment = noteClassifications.get(reading.operator_notes);

    // Type 1+2: data issues (out of range / unexpected data)
    if (hasDataIssue) {
      reasons.push(...dataIssues.get(id)!);
    }

    // Type 3: operator says OK but data is bad
    if (hasDataIssue && noteSentiment === "POSITIVE") {
      reasons.push("OPERATOR_MISMATCH: says OK but data has issues");
    }

    // Type 4: operator says error but data is OK
    if (!hasDataIssue && noteSentiment === "NEGATIVE") {
      reasons.push("OPERATOR_FALSE_ALARM: reports problem but data is OK");
    }

    if (reasons.length > 0) {
      anomalies.set(id, reasons);
    }
  }

  log("info", `Total anomalies found: ${anomalies.size}`);
  for (const [id, reasons] of [...anomalies].sort((a, b) => a[0].localeCompare(b[0]))) {
    log("debug", `  ${id}: ${reasons.join("; ")}`);
  }

  // ── Step 6: Submit to verify ──────────────────────────────
  const anomalyIds = [...anomalies.keys()].sort();
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    log("error", "Missing API_KEY env var");
    process.exit(1);
  }

  const payload = {
    apikey: apiKey,
    task: params.task,
    answer: {
      recheck: anomalyIds,
    },
  };

  log("info", `Submitting ${anomalyIds.length} anomaly IDs to ${params.verifyUrl}`);
  log("debug", `IDs: ${anomalyIds.join(", ")}`);

  const response = await fetch(params.verifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  log("info", `Verify response: ${JSON.stringify(body)}`);

  result({ anomalyCount: anomalyIds.length, anomalyIds, verifyResponse: body });
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    log("error", err instanceof Error ? `${err.message}\n${err.stack}` : String(err));
    process.exit(1);
  });