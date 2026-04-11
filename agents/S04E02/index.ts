import { readConfig, log, result } from "../../src/lib/agent-helpers";

// ── Types ───────────────────────────────────────────────────
interface AgentConfig {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  env: string[];
  params: Record<string, unknown>;
}

interface ApiResponse {
  code: number;
  message: string;
  sourceFunction?: string;
  [key: string]: unknown;
}

interface WeatherHour {
  date: string;
  hour: string; // "HH:00:00"
  windMs: number;
}

interface ConfigPoint {
  date: string;
  hour: string; // "HH:00:00"
  pitchAngle: 0 | 45 | 90;
  turbineMode: "production" | "idle";
  windMs: number;
  unlockCode?: string;
}

// ── Main ────────────────────────────────────────────────────
async function main(): Promise<void> {
  const config = await readConfig<AgentConfig>();
  const p = config.params ?? {};
  const VERIFY = p.verifyUrl as string;
  const TASK = p.task as string;
  const KEY = process.env.API_KEY!;
  const CUTOFF = (p.cutoffWindMs as number) ?? 14;
  const MIN_WIND = (p.minWindMs as number) ?? 4;
  const RATED_KW = (p.ratedPowerKw as number) ?? 14;
  const POLL_MS = (p.pollIntervalMs as number) ?? 400;
  const POLL_MAX = (p.pollMaxRetries as number) ?? 70;

  log("info", "S04E02 Wind Power — starting");

  // ── API call helper ──
  async function api(answer: Record<string, unknown>): Promise<ApiResponse> {
    const res = await fetch(VERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: KEY, task: TASK, answer }),
    });
    return res.json() as Promise<ApiResponse>;
  }

  // ── Poll getResult for N items ──
  async function pollResults(count: number): Promise<ApiResponse[]> {
    const results: ApiResponse[] = [];
    let emptyStreak = 0;
    while (results.length < count && emptyStreak < POLL_MAX) {
      const r = await api({ action: "getResult" });
      if (r.sourceFunction) {
        results.push(r);
        log("info", `  poll ${results.length}/${count}: ${r.sourceFunction}`);
        emptyStreak = 0;
      } else {
        emptyStreak++;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    }
    if (results.length < count) {
      log("warn", `Poll: only got ${results.length}/${count}`);
    }
    return results;
  }

  // ── Wind yield % by wind speed (linear interpolation) ──
  function windYield(ms: number): number {
    if (ms < MIN_WIND) return 0;
    if (ms > CUTOFF) return 0;
    const pts: [number, number][] = [
      [4, 12.5],
      [6, 35],
      [8, 65],
      [10, 95],
      [12, 100],
      [14, 100],
    ];
    for (let i = 0; i < pts.length - 1; i++) {
      if (ms >= pts[i][0] && ms <= pts[i + 1][0]) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        return y0 + ((y1 - y0) * (ms - x0)) / (x1 - x0);
      }
    }
    return 100;
  }

  // ── Normalize hour to "HH:00:00" ──
  function normalizeHour(raw: unknown): string {
    if (typeof raw === "number") {
      return String(raw).padStart(2, "0") + ":00:00";
    }
    const s = String(raw);
    // If already "HH:00:00" or "HH:MM:SS"
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) {
      return s.padStart(8, "0");
    }
    // If "HH:00" or "HH:MM"
    if (/^\d{1,2}:\d{2}$/.test(s)) {
      return s.padStart(5, "0") + ":00";
    }
    // If just a number string
    if (/^\d{1,2}$/.test(s)) {
      return s.padStart(2, "0") + ":00:00";
    }
    // ISO datetime — extract time part
    const match = s.match(/(\d{2}):(\d{2})/);
    if (match) {
      return match[1] + ":00:00";
    }
    return s;
  }

  // ════════════════════════════════════════════════════════════
  // STEP 1: Start service window (timer begins!)
  // ════════════════════════════════════════════════════════════
  const startResp = await api({ action: "start" });
  log("info", `Service window opened: ${JSON.stringify(startResp)}`);
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  // ════════════════════════════════════════════════════════════
  // STEP 2: Queue weather + powerplantcheck (parallel)
  // ════════════════════════════════════════════════════════════
  await Promise.all([
    api({ action: "get", param: "weather" }),
    api({ action: "get", param: "powerplantcheck" }),
  ]);
  log("info", `Queued weather + powerplant [${elapsed()}]`);

  // ════════════════════════════════════════════════════════════
  // STEP 3: Poll for both results
  // ════════════════════════════════════════════════════════════
  const dataResults = await pollResults(2);
  const weatherResp = dataResults.find((r) => r.sourceFunction === "weather");
  const powerResp = dataResults.find(
    (r) => r.sourceFunction === "powerplantcheck",
  );

  if (!weatherResp || !powerResp) {
    log("error", `Missing data! weather=${!!weatherResp} power=${!!powerResp}`);
    log("error", `Raw results: ${JSON.stringify(dataResults)}`);
    process.exit(1);
  }

  log("info", `Got weather + powerplant [${elapsed()}]`);
  log("info", `Weather keys: ${Object.keys(weatherResp).join(", ")}`);
  log("info", `Weather sample: ${JSON.stringify(weatherResp).slice(0, 800)}`);
  log("info", `Powerplant: ${JSON.stringify(powerResp)}`);

  // ════════════════════════════════════════════════════════════
  // STEP 4: Parse weather data
  // ════════════════════════════════════════════════════════════
  const rawWeather =
    (weatherResp.data ??
      weatherResp.forecast ??
      weatherResp.weather ??
      weatherResp.entries ??
      weatherResp.hours ??
      weatherResp.results) as unknown;

  const weatherEntries: WeatherHour[] = [];

  if (Array.isArray(rawWeather)) {
    for (const entry of rawWeather) {
      const e = entry as Record<string, unknown>;

      // Handle "timestamp": "2026-04-06 00:00:00" format
      let date = "";
      let hour = "";
      if (typeof e.timestamp === "string") {
        const parts = e.timestamp.split(" ");
        date = parts[0];
        hour = parts[1] ?? "00:00:00";
      } else {
        date = String(e.date ?? e.startDate ?? e.day ?? "");
        hour = normalizeHour(e.hour ?? e.startHour ?? e.time ?? e.h ?? 0);
      }

      const wind = (e.windMs ??
        e.wind_ms ??
        e.wind ??
        e.windSpeed ??
        e.wind_speed ??
        0) as number;

      weatherEntries.push({ date, hour, windMs: wind });
    }
  } else {
    log("error", `Unexpected weather format: ${typeof rawWeather}`);
    log("error", `Full weather response: ${JSON.stringify(weatherResp)}`);
    process.exit(1);
  }

  log("info", `Parsed ${weatherEntries.length} weather entries`);
  if (weatherEntries.length > 0) {
    log("info", `First: ${JSON.stringify(weatherEntries[0])}`);
    log("info", `Last: ${JSON.stringify(weatherEntries[weatherEntries.length - 1])}`);
  }

  // ════════════════════════════════════════════════════════════
  // STEP 5: Parse power requirement
  // ════════════════════════════════════════════════════════════
  const rawPower = powerResp.requiredPowerKw ??
    powerResp.required ??
    powerResp.powerKw ??
    powerResp.requiredKw ??
    powerResp.power ??
    powerResp.powerDeficitKw ??
    powerResp.data;

  let requiredKw: number;
  if (typeof rawPower === "number") {
    requiredKw = rawPower;
  } else if (typeof rawPower === "string") {
    // Handle range like "2-3" → take max
    const parts = rawPower.split("-").map(Number);
    requiredKw = Math.max(...parts);
  } else {
    requiredKw = 3; // safe fallback
    log("warn", `Could not parse power requirement: ${JSON.stringify(rawPower)}, using ${requiredKw}`);
  }

  log("info", `Required power: ${requiredKw} kW (rated: ${RATED_KW} kW)`);

  // ════════════════════════════════════════════════════════════
  // STEP 6: Build config points
  // ════════════════════════════════════════════════════════════
  const configPoints: ConfigPoint[] = [];

  // 6a. Storm protection: pitch 90, idle for every hour with wind > cutoff
  for (const w of weatherEntries) {
    if (w.windMs > CUTOFF) {
      configPoints.push({
        date: w.date,
        hour: w.hour,
        pitchAngle: 90,
        turbineMode: "idle",
        windMs: w.windMs,
      });
    }
  }
  log("info", `Storm config points: ${configPoints.length}`);

  // 6b. First production window: wind in [MIN_WIND, CUTOFF] with enough power
  let productionFound = false;
  for (const w of weatherEntries) {
    if (w.windMs >= MIN_WIND && w.windMs <= CUTOFF) {
      const yPct = windYield(w.windMs);
      const powerKw = (RATED_KW * yPct) / 100;
      if (powerKw >= requiredKw) {
        // Make sure this hour isn't already a storm config
        const isStorm = configPoints.some(
          (cp) => cp.date === w.date && cp.hour === w.hour,
        );
        if (!isStorm) {
          configPoints.push({
            date: w.date,
            hour: w.hour,
            pitchAngle: 0,
            turbineMode: "production",
            windMs: w.windMs,
          });
          log(
            "info",
            `Production: ${w.date} ${w.hour} | wind=${w.windMs}m/s yield=${yPct.toFixed(1)}% power=${powerKw.toFixed(1)}kW`,
          );
          productionFound = true;
          break;
        }
      }
    }
  }

  if (!productionFound) {
    log("warn", "No production window found! Listing candidates with wind >= 4:");
    for (const w of weatherEntries) {
      if (w.windMs >= MIN_WIND) {
        const y = windYield(w.windMs);
        const pw = (RATED_KW * y) / 100;
        log("info", `  ${w.date} ${w.hour} wind=${w.windMs} yield=${y.toFixed(1)}% power=${pw.toFixed(1)}kW ${pw >= requiredKw ? "✓" : "✗"}`);
      }
    }
  }

  log("info", `Total config points: ${configPoints.length} [${elapsed()}]`);

  // ════════════════════════════════════════════════════════════
  // STEP 7: Generate unlock codes (all parallel)
  // ════════════════════════════════════════════════════════════
  const codePromises = configPoints.map((cp) =>
    api({
      action: "unlockCodeGenerator",
      startDate: cp.date,
      startHour: cp.hour,
      windMs: cp.windMs,
      pitchAngle: cp.pitchAngle,
    }),
  );
  await Promise.all(codePromises);
  log("info", `Queued ${configPoints.length} unlock codes [${elapsed()}]`);

  // ════════════════════════════════════════════════════════════
  // STEP 8: Poll for all unlock codes
  // ════════════════════════════════════════════════════════════
  const codeResults = await pollResults(configPoints.length);
  log("info", `Got ${codeResults.length} unlock codes [${elapsed()}]`);

  if (codeResults.length > 0) {
    log("info", `Code sample: ${JSON.stringify(codeResults[0])}`);
  }

  // Match codes to config points by date + hour
  for (const cr of codeResults) {
    // Extract the actual unlock code — NOT cr.code (that's the API status code)
    const code = (cr.unlockCode ?? cr.result ?? cr.data ?? cr.signature ?? cr.key) as string;

    // Extract date + hour — may be in signedParams or top-level
    const sp = (cr.signedParams ?? {}) as Record<string, unknown>;
    let cDate = (sp.startDate ?? cr.startDate ?? cr.date) as string | undefined;
    let cHour = (sp.startHour ?? cr.startHour ?? cr.hour ?? cr.time) as string | undefined;

    // Handle timestamp field
    if (!cDate && typeof cr.timestamp === "string") {
      const parts = (cr.timestamp as string).split(" ");
      cDate = parts[0];
      cHour = parts[1];
    }

    if (cDate && cHour) {
      const normalHour = normalizeHour(cHour);
      const match = configPoints.find(
        (cp) => cp.date === cDate && cp.hour === normalHour && !cp.unlockCode,
      );
      if (match) {
        match.unlockCode = String(code);
      } else {
        log("warn", `Unmatched code: date=${cDate} hour=${normalHour} | raw=${JSON.stringify(cr).slice(0, 300)}`);
      }
    } else {
      // Fallback: assign sequentially to points without codes
      const nextEmpty = configPoints.find((cp) => !cp.unlockCode);
      if (nextEmpty) {
        nextEmpty.unlockCode = String(code);
        log("warn", `Sequential fallback assign: ${nextEmpty.date} ${nextEmpty.hour} = ${String(code).slice(0, 40)}`);
      } else {
        log("warn", `No match for code: ${JSON.stringify(cr).slice(0, 300)}`);
      }
    }
  }

  const missing = configPoints.filter((cp) => !cp.unlockCode);
  if (missing.length > 0) {
    log("error", `${missing.length} points missing unlock codes!`);
    missing.forEach((m) => log("error", `  Missing: ${m.date} ${m.hour}`));
  }

  // ════════════════════════════════════════════════════════════
  // STEP 9: Send batch config
  // ════════════════════════════════════════════════════════════
  const configs: Record<
    string,
    { pitchAngle: number; turbineMode: string; unlockCode: string }
  > = {};
  for (const cp of configPoints) {
    const key = `${cp.date} ${cp.hour}`;
    configs[key] = {
      pitchAngle: cp.pitchAngle,
      turbineMode: cp.turbineMode,
      unlockCode: cp.unlockCode ?? "",
    };
  }

  log("info", `Sending batch config (${Object.keys(configs).length} points) [${elapsed()}]`);
  const configResp = await api({ action: "config", configs });
  log("info", `Config response: ${JSON.stringify(configResp)}`);

  // ════════════════════════════════════════════════════════════
  // STEP 10: Turbine check (required before done)
  // ════════════════════════════════════════════════════════════
  await api({ action: "get", param: "turbinecheck" });
  log("info", `Queued turbinecheck [${elapsed()}]`);
  const turbineResults = await pollResults(1);
  log("info", `Turbine check: ${JSON.stringify(turbineResults[0] ?? "EMPTY")}`);

  // ════════════════════════════════════════════════════════════
  // STEP 11: Done — validate and get flag
  // ════════════════════════════════════════════════════════════
  const doneResp = await api({ action: "done" });
  log("info", `Done response [${elapsed()}]: ${JSON.stringify(doneResp)}`);

  if (JSON.stringify(doneResp).includes("FLG")) {
    log("info", "🚀 FLAG FOUND!");
    result({ flag: doneResp.message });
  } else {
    log("warn", "No flag in response — check config");
    result({ response: doneResp });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    log("error", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });