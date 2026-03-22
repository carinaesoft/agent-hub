import path from "path";
import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { readConfig, log, result } from "../../src/lib/agent-helpers";

// ═══════════════════════════════════════════════════════════════
// TYPY
// ═══════════════════════════════════════════════════════════════

// Konfiguracja agenta — odpowiada strukturze agent.config.json.
// Pola model, systemPrompt, temperature, maxTokens sterują zachowaniem LLM.
// params to worek na ustawienia specyficzne dla tego agenta
// (np. verifyUrl, task, maxIterations) — dzięki temu zmieniasz je z GUI.
interface AgentConfig {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  env: string[];
  params: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// HELPERY
// ═══════════════════════════════════════════════════════════════

const agentDir = path.dirname(new URL(import.meta.url).pathname);
const resolveLocal = (file: string) => path.join(agentDir, file);
void resolveLocal;

// Tworzymy klienta OpenAI SDK, ale wskazujemy go na OpenRouter.
// Dzięki temu używamy tego samego SDK do dziesiątek modeli (GPT, Claude, Gemini...).
function createClient(baseURL: string): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY ?? "missing-openrouter-api-key",
    baseURL,
  });
}

// ═══════════════════════════════════════════════════════════════
// STORAGE LOGÓW
// ═══════════════════════════════════════════════════════════════

// Logi ładujemy RAZ na starcie do pamięci.
// Agent NIE widzi tych linii bezpośrednio — ma do nich dostęp
// wyłącznie przez narzędzie search_logs. To jest kluczowe:
// 2137 linii nie zmieściłoby się w kontekście LLM,
// więc agent musi nawigować po nich narzędziami.
let RAW_LINES: string[] = [];

async function fetchLogs(apiKey: string): Promise<void> {
  const url = `https://hub.ag3nts.org/data/${apiKey}/failure.log`;
  const res = await fetch(url);
  const text = await res.text();
  RAW_LINES = text.split("\n").filter((l) => l.trim().length > 0);
  log("info", `Loaded ${RAW_LINES.length} log lines`);
}

// ═══════════════════════════════════════════════════════════════
// NARZĘDZIE 1: search_logs
// ═══════════════════════════════════════════════════════════════
//
// To jest "oczy" agenta — jedyny sposób, w jaki widzi logi.
// Filtruje programistycznie (szybko, deterministycznie),
// a agent decyduje JAKIE filtry zastosować.
//
// Parametry:
//   level     — "CRIT" lub "CRIT,ERRO" — filtruje po severity
//   time_from — "06:00" — tylko logi od tej godziny
//   time_to   — "12:00" — tylko logi do tej godziny
//   component — "ECCS8" — tylko logi tego podzespołu
//   deduplicate — domyślnie true — łączy powtórzenia
//
// Deduplikacja jest kluczowa: bez niej agent dostałby 55 identycznych
// linii "ECCS8 thermal drift..." zamiast jednej z adnotacją [×55].
// To drastycznie redukuje szum.

interface SearchLogsArgs {
  level?: string;
  time_from?: string;
  time_to?: string;
  component?: string;
  deduplicate?: boolean;
}

function searchLogs(args: SearchLogsArgs): string {
  // Parsujemy listę poziomów — agent może podać "CRIT,ERRO"
  const levels = args.level
    ? args.level.split(",").map((l) => l.trim().toUpperCase())
    : null;
  const deduplicate = args.deduplicate !== false;

  let filtered = RAW_LINES;

  // ── Filtr po severity ──
  // Proste string matching — "[CRIT]", "[ERRO]" itd.
  if (levels) {
    filtered = filtered.filter((line) =>
      levels.some((lvl) => line.includes(`[${lvl}]`))
    );
  }

  // ── Filtr po zakresie czasu ──
  // Wyciągamy HH:MM z timestampa regexem i porównujemy leksykograficznie.
  // Działa, bo format HH:MM jest sortowalny jako string.
  if (args.time_from || args.time_to) {
    filtered = filtered.filter((line) => {
      const match = line.match(/\d{4}-\d{2}-\d{2} (\d{2}:\d{2})/);
      if (!match) return false;
      const time = match[1];
      if (args.time_from && time < args.time_from) return false;
      if (args.time_to && time > args.time_to) return false;
      return true;
    });
  }

  // ── Filtr po komponencie ──
  if (args.component) {
    const comp = args.component.toUpperCase();
    filtered = filtered.filter((line) => line.includes(comp));
  }

  // ── Deduplikacja ──
  // Usuwamy timestamp z linii, żeby porównać sam komunikat.
  // Jeśli ten sam komunikat pojawia się 55 razy, agent widzi:
  //   "[2026-03-21 06:03:20] [WARN] ECCS8 thermal drift...  [×55]"
  // Zachowujemy PIERWSZY timestamp — to pokazuje kiedy problem zaczął się.
  if (deduplicate) {
    const seen = new Map<string, { line: string; count: number }>();
    for (const line of filtered) {
      // Usuwamy timestamp "[2026-03-21 HH:MM:SS] " żeby porównać treść
      const msg = line.replace(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] /, "");
      if (seen.has(msg)) {
        seen.get(msg)!.count++;
      } else {
        seen.set(msg, { line, count: 1 });
      }
    }
    const deduped = Array.from(seen.values()).map((v) =>
      v.count > 1 ? `${v.line}  [×${v.count}]` : v.line
    );
    return `Found ${filtered.length} lines (${deduped.length} unique):\n${deduped.join("\n")}`;
  }

  return `Found ${filtered.length} lines:\n${filtered.join("\n")}`;
}

// ═══════════════════════════════════════════════════════════════
// NARZĘDZIE 2: count_tokens
// ═══════════════════════════════════════════════════════════════
//
// Prosty estymator tokenów. Agent używa go PRZED wysłaniem,
// żeby sprawdzić czy mieści się w limicie 1500.
//
// Dlaczego 3.0 a nie 4.0? Bo Centrala liczy tokeny ściśle (tiktoken),
// a tekst techniczny z ID podzespołów tokenizuje się gorzej niż
// zwykły angielski. Lepiej być konserwatywnym.

function countTokens(text: string): number {
  return Math.ceil(text.length / 3.0);
}

// ═══════════════════════════════════════════════════════════════
// NARZĘDZIE 3: send_answer
// ═══════════════════════════════════════════════════════════════
//
// Wysyła skompresowane logi do Centrali.
// Dwie rzeczy się tu dzieją:
//   1. Lokalny guard: jeśli > 1500 tokenów, NIE wysyłamy
//      (oszczędzamy request i dajemy agentowi szansę skompresować)
//   2. Centrala zwraca albo:
//      - feedback: "brakuje info o FIRMWARE" → agent szuka dalej
//      - flagę: "{FLG:...}" → sukces!

async function sendAnswer(
  apiKey: string,
  verifyUrl: string,
  task: string,
  logs: string
): Promise<string> {
  const tokenCount = countTokens(logs);
  if (tokenCount > 1500) {
    return `REJECTED locally: estimated ${tokenCount} tokens exceeds 1500 limit. Compress further.`;
  }

  const res = await fetch(verifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: apiKey,
      task,
      answer: { logs },
    }),
  });

  return await res.text();
}

// ═══════════════════════════════════════════════════════════════
// DEFINICJE NARZĘDZI DLA OPENAI (Function Calling schema)
// ═══════════════════════════════════════════════════════════════
//
// To jest "menu" które LLM widzi. Na podstawie tych opisów
// model DECYDUJE które narzędzie wywołać i z jakimi parametrami.
//
// Dobre opisy = model podejmuje dobre decyzje.
// Złe opisy = model wywołuje narzędzia z bezsensownymi argumentami.
//
// Format to JSON Schema — standard OpenAI Function Calling.
// Każde narzędzie ma:
//   - name: identyfikator (musi pasować do naszego switcha w executeTool)
//   - description: LLM czyta to żeby wiedzieć KIEDY użyć narzędzia
//   - parameters: JSON Schema definiujący jakie argumenty przyjmuje

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_logs",
      description:
        "Search and filter the failure log file. Returns matching lines with deduplication (first occurrence + repeat count). Use to explore logs before compressing.",
      parameters: {
        type: "object",
        properties: {
          level: {
            type: "string",
            description:
              'Comma-separated severity levels: "CRIT" or "CRIT,ERRO" or "WARN,ERRO,CRIT". Omit for all.',
          },
          time_from: {
            type: "string",
            description: 'Start time HH:MM, e.g. "06:00"',
          },
          time_to: {
            type: "string",
            description: 'End time HH:MM, e.g. "12:00"',
          },
          component: {
            type: "string",
            description:
              "Component ID: ECCS8, WTANK07, WTRPMP, STMTURB12, PWR01, WSTPOOL2, FIRMWARE",
          },
          deduplicate: {
            type: "boolean",
            description:
              "Collapse repeated messages keeping first + count. Default true.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "count_tokens",
      description:
        "Estimate token count for a text. Use before send_answer to check 1500 limit.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to count tokens for" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_answer",
      description:
        "Send compressed logs to Centrala. Returns technician feedback or flag. Logs must be multi-line (\\n separated), under 1500 tokens. One event per line.",
      parameters: {
        type: "object",
        properties: {
          logs: {
            type: "string",
            description:
              "Compressed log string, one event per line separated by \\n",
          },
        },
        required: ["logs"],
      },
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// EXECUTOR — łączy wywołanie LLM z naszym kodem
// ═══════════════════════════════════════════════════════════════
//
// LLM zwraca JSON: { name: "search_logs", arguments: { level: "CRIT" } }
// Ten switch zamienia to na prawdziwe wywołanie funkcji.
// To jest "most" między światem LLM (tekst) a światem kodu (funkcje).

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  apiKey: string,
  verifyUrl: string,
  task: string
): Promise<string> {
  switch (name) {
    case "search_logs":
      return searchLogs(args as unknown as SearchLogsArgs);
    case "count_tokens":
      return String(countTokens(args.text as string));
    case "send_answer":
      return await sendAnswer(apiKey, verifyUrl, task, args.logs as string);
    default:
      return `Unknown tool: ${name}`;
  }
}

// ═══════════════════════════════════════════════════════════════
// PĘTLA AGENTOWA — serce całego systemu
// ═══════════════════════════════════════════════════════════════
//
// Jak to działa krok po kroku:
//
// 1. Wysyłamy do LLM: system prompt + wiadomość użytkownika + listę narzędzi
// 2. LLM odpowiada ALBO tekstem (koniec) ALBO tool_calls (chce użyć narzędzia)
// 3. Jeśli tool_calls: wykonujemy każde narzędzie i dodajemy wynik do messages
// 4. Wracamy do kroku 1 (LLM widzi wyniki narzędzi i decyduje co dalej)
//
// Kluczowe: messages rośnie z każdą iteracją!
// Po 10 iteracjach LLM widzi:
//   [system] → [user] → [assistant: tool_calls] → [tool: wyniki] →
//   [assistant: tool_calls] → [tool: wyniki] → ... → [assistant: tekst]
//
// To jest pełna historia "rozmowy" agenta z narzędziami.
// LLM używa tej historii do podejmowania coraz lepszych decyzji.

async function runAgent(
  client: OpenAI,
  config: AgentConfig,
  apiKey: string,
  verifyUrl: string,
  task: string,
  maxIterations: number
): Promise<string | undefined> {
  // ── Inicjalizacja konwersacji ──
  // System prompt mówi agentowi KIM jest i JAK ma działać.
  // User message daje mu kontekst startowy (ile linii, zakres czasu, komponenty).
  // Agent NIE widzi samych logów — musi sam po nie sięgnąć narzędziami.
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: config.systemPrompt },
    {
      role: "user",
      content: [
        "The failure.log has been loaded from a nuclear power plant that failed yesterday.",
        `Total lines: ${RAW_LINES.length}`,
        `Time range: ${RAW_LINES[0]?.substring(1, 20) ?? "?"} to ${RAW_LINES[RAW_LINES.length - 1]?.substring(1, 20) ?? "?"}`,
        "Components: ECCS8, WTANK07, WTRPMP, STMTURB12, PWR01, WSTPOOL2, FIRMWARE",
        "",
        "Analyze the logs, compress critical events to under 1500 tokens, send to Centrala, and iterate on technician feedback.",
      ].join("\n"),
    },
  ];

  for (let i = 0; i < maxIterations; i++) {
    log("info", `── Iteration ${i + 1}/${maxIterations} ──`);

    // ── Krok 1: Wysyłamy całą dotychczasową konwersację do LLM ──
    // LLM dostaje: historię + narzędzia → zwraca decyzję.
    const response = await client.chat.completions.create({
      model: config.model,
      messages,
      tools,             // ← tu LLM widzi "menu" narzędzi
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    });

    const choice = response.choices[0];
    if (!choice) break;

    // ── Krok 2: Dodajemy odpowiedź asystenta do historii ──
    // To jest WAŻNE — musimy zachować pełną historię,
    // bo LLM nie ma pamięci między wywołaniami.
    const assistantMessage = choice.message;
    messages.push(assistantMessage);

    // ── Krok 3: Czy LLM chce użyć narzędzi? ──
    // Jeśli NIE ma tool_calls → agent skończył (odpowiedział tekstem).
    // Jeśli SĄ tool_calls → wykonujemy je i kontynuujemy pętlę.
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

    // ── Krok 4: Wykonujemy każde narzędzie ──
    // LLM może wywołać KILKA narzędzi naraz (parallel tool calls).
    // Np. w iteracji 1 agent wywołał 7x search_logs jednocześnie
    // — po jednym dla każdego komponentu. To jest efektywne!
    for (const toolCall of assistantMessage.tool_calls) {
      // Guard: OpenAI SDK ma union type, filtrujemy po "function"
      if (toolCall.type !== "function") continue;

      const fnName = toolCall.function.name;
      const fnArgs = JSON.parse(toolCall.function.arguments) as Record<
        string,
        unknown
      >;

      log(
        "info",
        `Tool: ${fnName}(${JSON.stringify(fnArgs).substring(0, 150)})`
      );

      // Wywołujemy naszą implementację narzędzia
      const toolResult = await executeTool(
        fnName,
        fnArgs,
        apiKey,
        verifyUrl,
        task
      );

      log(
        "info",
        `  → ${toolResult.substring(0, 200)}${toolResult.length > 200 ? "..." : ""}`
      );

      // Sprawdzamy czy w odpowiedzi jest flaga
      if (fnName === "send_answer" && toolResult.includes("FLG:")) {
        log("info", `FLAG FOUND!`);
        return toolResult;
      }

      // ── Krok 5: Dodajemy wynik narzędzia do historii ──
      // Format: { role: "tool", tool_call_id: "...", content: "..." }
      // tool_call_id łączy wynik z konkretnym wywołaniem —
      // to jest wymagane przez API, bo agent mógł wywołać kilka naraz.
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolResult,
      });
    }

    // Pętla wraca do kroku 1 — LLM widzi wyniki narzędzi
    // i decyduje: szukać dalej? kompresować? wysyłać?
  }

  return undefined;
}

// ═══════════════════════════════════════════════════════════════
// MAIN — punkt startowy agenta
// ═══════════════════════════════════════════════════════════════
//
// Przepływ:
// 1. Czytamy config (z stdin, przekazany przez Agent Hub)
// 2. Pobieramy logi z API (jednorazowo)
// 3. Uruchamiamy pętlę agentową
// 4. Emitujemy wynik (result) — Agent Hub wyświetla go w GUI

async function main(): Promise<void> {
  const config = await readConfig<AgentConfig>();
  const params = config.params ?? {};
  const apiKey = process.env.API_KEY ?? "";

  // Wszystkie konfigurowalne wartości czytamy z params
  const verifyUrl =
    (params.verifyUrl as string) ?? "https://hub.ag3nts.org/verify";
  const task = (params.task as string) ?? "failure";
  const baseURL =
    (params.openrouterBaseURL as string) ?? "https://openrouter.ai/api/v1";
  const maxIterations = (params.maxIterations as number) ?? 15;

  log("info", "Agent started — Failure Log Analyzer");

  // Pobieramy logi — od teraz są w RAW_LINES
  await fetchLogs(apiKey);

  // Tworzymy klienta i uruchamiamy agenta
  const client = createClient(baseURL);
  const flagResponse = await runAgent(
    client,
    config,
    apiKey,
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