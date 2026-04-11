import { readConfig, log, result } from "../../src/lib/agent-helpers";

// ── Types ───────────────────────────────────────────────────
interface AgentConfig {
  params: Record<string, unknown>;
  [k: string]: unknown;
}

interface ApiResp {
  code: number;
  message: string;
  [k: string]: unknown;
}

interface Unit {
  hash: string;
  type: string;
  position: string;
}

// ── Main ────────────────────────────────────────────────────
async function main(): Promise<void> {
  const config = await readConfig<AgentConfig>();
  const p = config.params ?? {};
  const VERIFY = p.verifyUrl as string;
  const TASK = p.task as string;
  const KEY = process.env.API_KEY!;

  log("info", "S04E03 Domatowo — rescue operation starting");

  // Reset to clear any previous state
  await api({ action: "reset" });

  // ── API helper ──
  async function api(answer: Record<string, unknown>): Promise<ApiResp> {
    const res = await fetch(VERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: KEY, task: TASK, answer }),
    });
    const data = (await res.json()) as ApiResp;
    log("info", `[${answer.action}] ${JSON.stringify(data).slice(0, 600)}`);
    return data;
  }

  // ── Parse units from getObjects response ──
  function parseUnits(resp: ApiResp): Unit[] {
    const candidates = [resp.objects, resp.units, resp.data, resp.result];
    for (const raw of candidates) {
      if (Array.isArray(raw)) {
        return raw.map((u: Record<string, unknown>) => ({
          hash: String(u.hash ?? u.id ?? u.identifier ?? u.objectId ?? ""),
          type: String(u.type ?? u.typ ?? u.unitType ?? "").toLowerCase(),
          position: String(u.position ?? u.field ?? u.tile ?? u.location ?? ""),
        }));
      }
    }
    return [];
  }

  // ── Manhattan distance between grid coordinates like "E2", "F10" ──
  function dist(a: string, b: string): number {
    const colA = a.charCodeAt(0) - 65;
    const rowA = parseInt(a.slice(1)) - 1;
    const colB = b.charCodeAt(0) - 65;
    const rowB = parseInt(b.slice(1)) - 1;
    return Math.abs(colA - colB) + Math.abs(rowA - rowB);
  }

  // ══════════════════════════════════════════════════════════════
  // B3 (Blok 3p) tiles — "najwyższe bloki"
  // Cluster 1 (top):        F1, G1, F2, G2
  // Cluster 2 (bottom-left): A10, B10, C10, A11, B11, C11
  // Cluster 3 (bottom-right): H10, I10, H11, I11
  //
  // Inspection order: interleaved across clusters for early exit
  // ══════════════════════════════════════════════════════════════
  const B3_TILES = [
    "F2", "I10", "B10",
    "G2", "H10", "A10",
    "F1", "I11", "C10",
    "G1", "H11", "B11",
    "A11", "C11",
  ];

  // ══════════════════════════════════════════════════════════════
  // PHASE 1: Deploy 3 transporters with 2 scouts each
  //
  // T1 → E2  (closest road to cluster 1)
  // T2 → B9  (closest road to cluster 2)
  // T3 → I9  (closest road to cluster 3)
  //
  // Spawn slots: A6 → B6 → C6 → D6
  // Route to row 9: only via D6→D7→D8→D9 (only N-S road)
  // ══════════════════════════════════════════════════════════════
  const destinations = ["E2", "B9", "I9"];

  for (const dest of destinations) {
    // Create transporter with 2 scouts
    const createResp = await api({ action: "create", type: "transporter", passengers: 2 });

    // Hash comes directly from create response in "object" field
    const tHash = String(createResp.object ?? "");
    if (!tHash) {
      log("error", `No hash in create response!`);
      continue;
    }

    log("info", `Transporter ${tHash.slice(0, 8)} → ${dest}`);

    // Move transporter to destination
    await api({ action: "move", object: tHash, where: dest });

    // Dismount scouts
    await api({ action: "dismount", object: tHash, passengers: 2 });
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE 2: Get all scouts and their positions
  // ══════════════════════════════════════════════════════════════
  const scoutResp = await api({ action: "getObjects" });
  const allUnits = parseUnits(scoutResp);
  const scouts = allUnits.filter((u) => u.type.includes("scout") || u.type.includes("zwiad"));
  log("info", `Scouts found: ${scouts.length}`);
  for (const s of scouts) {
    log("info", `  Scout ${s.hash.slice(0, 8)} at ${s.position}`);
  }

  // Track mutable positions
  const scoutPos = new Map<string, string>();
  for (const s of scouts) {
    scoutPos.set(s.hash, s.position);
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE 3: Systematically inspect B3 tiles
  // After each inspect, try callHelicopter — it's free (0 pts)
  // and only succeeds when a scout has confirmed a human.
  // ══════════════════════════════════════════════════════════════

  for (const target of B3_TILES) {
    // Pick nearest available scout
    let bestHash = "";
    let bestDist = Infinity;
    for (const [hash, pos] of scoutPos) {
      const d = dist(pos, target);
      if (d < bestDist) {
        bestDist = d;
        bestHash = hash;
      }
    }

    if (!bestHash) {
      log("error", "No scouts available!");
      break;
    }

    const curPos = scoutPos.get(bestHash)!;

    // Move scout to target if not already there
    if (curPos !== target) {
      await api({ action: "move", object: bestHash, where: target });
      scoutPos.set(bestHash, target);
    }

    // Inspect
    await api({ action: "inspect", object: bestHash });

    // Try helicopter — free call, only succeeds if human was found
    const heli = await api({ action: "callHelicopter", destination: target });
    const heliStr = JSON.stringify(heli);

    if (heli.code >= 0 || heliStr.includes("FLG")) {
      log("info", `🚁🏁 EVACUATION SUCCESS at ${target}: ${heli.message}`);
      result({ flag: heli.message });
      return;
    }

    log("info", `${target}: clear (${scoutPos.size} scouts, pts=${heli.code})`);
  }

  // Fallback: not found
  log("error", "Partisan not found in any B3 tile!");
  const exp = await api({ action: "expenses" });
  log("info", `Final expenses: ${JSON.stringify(exp)}`);
  result({ status: "not found" });
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    log("error", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });