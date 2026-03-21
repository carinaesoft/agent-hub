import path from "path";
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

interface CsvItem {
  id: string;
  description: string;
}

interface HubResponse {
  code: number;
  message: string;
  debug?: {
    output?: string;
    tokens?: number;
    cached_tokens?: number;
    balance?: number;
    classified_items?: number;
    required_items?: number;
    global_cache_hit_rate?: number;
  };
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

// ── Tool implementations ─────────────────────────────────────
// Te funkcje to "ręce" agenta — każda robi dokładnie jedno zadanie
// i zwraca wynik w formacie który LLM łatwo zrozumie.

async function toolFetchCSV(apiKey: string): Promise<CsvItem[]> {
  const url = `https://hub.ag3nts.org/data/${apiKey}/categorize.csv`;
  const res = await fetch(url);
  const text = await res.text();
  const lines = text.trim().split("\n").slice(1);
  return lines.map((line) => {
    const commaIdx = line.indexOf(",");
    return {
      id: line.slice(0, commaIdx).trim(),
      description: line.slice(commaIdx + 1).trim(),
    };
  });
}

async function toolResetBudget(apiKey: string): Promise<string> {
  const res = await fetch("https://hub.ag3nts.org/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: apiKey,
      task: "categorize",
      answer: { prompt: "reset" },
    }),
  });
  const json = (await res.json()) as HubResponse;
  return json.message;
}

async function toolClassifyItem(
  apiKey: string,
  verifyUrl: string,
  prompt: string,
  item: CsvItem
): Promise<string> {
  // Wstawiamy dane towaru w miejsca placeholderów
  const filledPrompt = prompt
    .replace("{id}", item.id)
    .replace("{description}", item.description);

  const res = await fetch(verifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: apiKey,
      task: "categorize",
      answer: { prompt: filledPrompt },
    }),
  });

  // Hub może zwrócić pusty body przy błędzie — zabezpieczamy parsowanie
  const text = await res.text();
  let json: HubResponse;
  try {
    json = JSON.parse(text) as HubResponse;
  } catch {
    return JSON.stringify({ code: -999, message: "Empty or invalid response from hub" });
  }

  const d = json.debug;

  // Zwracamy bogaty obiekt z pełnym kontekstem dla LLM —
  // dzięki temu agent wie nie tylko czy się udało, ale też DLACZEGO
  return JSON.stringify({
    code: json.code,
    message: json.message,
    modelOutput: d?.output,
    tokens: d?.tokens,
    cachedTokens: d?.cached_tokens,
    balance: d?.balance,
    classifiedItems: d?.classified_items,
    requiredItems: d?.required_items,
    cacheHitRate: d?.global_cache_hit_rate,
  });
}

// ── Tool definitions for LLM ─────────────────────────────────
// To jest "menu" narzędzi które LLM widzi i może wybrać.
// Opisy muszą być precyzyjne — od nich zależy czy agent użyje narzędzia poprawnie.

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "fetch_csv",
      description:
        "Fetch the current list of 10 items to classify. Call this at the start and after every reset, as the list may change.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "reset_budget",
      description:
        "Reset the classification budget (balance back to 1.5). Call this when you receive code=-910 (Insufficient funds). " +
        "WARNING: after reset, the classified_items counter resets to 0 — you must re-classify ALL 10 items from scratch.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "classify_item",
      description:
        "Send a prompt to the hub to classify one item. Returns hub response including model output, tokens used, balance, and progress. " +
        "code=1 means ACCEPTED (correct). code=-890 means NOT ACCEPTED (wrong classification). code=-910 means insufficient funds — call reset_budget immediately. " +
        "The prompt MUST contain {id} and {description} placeholders AND be under 100 tokens total (including filled-in item data). " +
        "Reactor/nuclear parts must ALWAYS be NEU. " +
        "Place static instructions FIRST (they get cached = cheaper), {id} and {description} LAST.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "Classification prompt with {id} and {description} placeholders. Must be concise (under 100 tokens total with item data). Static part first for caching.",
          },
          itemId: {
            type: "string",
            description: "The item ID from the CSV (e.g. i1234)",
          },
          itemDescription: {
            type: "string",
            description: "The item description from the CSV",
          },
        },
        required: ["prompt", "itemId", "itemDescription"],
      },
    },
  },
];

// ── Tool dispatcher ───────────────────────────────────────────
// Tłumaczy decyzję LLM (nazwa funkcji + argumenty) na prawdziwe wywołanie kodu.

async function dispatchTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  apiKey: string,
  verifyUrl: string
): Promise<string> {
  switch (toolName) {
    case "fetch_csv": {
      log("info", "Tool: fetch_csv");
      const items = await toolFetchCSV(apiKey);
      log("info", `Fetched ${items.length} items`);
      return JSON.stringify(items);
    }

    case "reset_budget": {
      log("info", "Tool: reset_budget");
      const msg = await toolResetBudget(apiKey);
      log("info", `Budget reset: ${msg}`);
      return msg;
    }

    case "classify_item": {
      const prompt = toolArgs.prompt as string;
      const itemId = toolArgs.itemId as string;
      const itemDescription = toolArgs.itemDescription as string;

      log("info", `Tool: classify_item | id: ${itemId} | prompt: "${prompt}"`);

      const res = await toolClassifyItem(apiKey, verifyUrl, prompt, {
        id: itemId,
        description: itemDescription,
      });

      // Parsujemy wynik żeby ładnie zalogować
      const parsed = JSON.parse(res) as {
        message: string;
        modelOutput?: string;
        balance?: number;
        classifiedItems?: number;
        requiredItems?: number;
      };

      log(
        parsed.message === "ACCEPTED" ? "info" : "warn",
        `Result: ${parsed.message} | model said: ${parsed.modelOutput ?? "?"} | balance: ${parsed.balance ?? "?"} | progress: ${parsed.classifiedItems ?? 0}/${parsed.requiredItems ?? 10}`
      );

      return res;
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

// ── Agentic loop ─────────────────────────────────────────────
// Serce agenta. LLM dostaje system prompt + narzędzia i sam decyduje
// co zrobić dalej. My tylko wykonujemy jego polecenia i zwracamy wyniki.
// Pętla trwa dopóki LLM nie powie "skończyłem" (brak tool calls).

async function runAgentLoop(
  client: OpenAI,
  config: AgentConfig,
  apiKey: string,
  verifyUrl: string
): Promise<string | undefined> {
  // Historia konwersacji — LLM widzi wszystkie poprzednie kroki
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: config.systemPrompt,
    },
    {
      role: "user",
      content:
        "FIRST: call reset_budget to ensure you start with full funds.\n" +
        "THEN: call fetch_csv to get the list of items.\n\n" +
        "Your goal: classify ALL 10 items correctly in a single run to get the flag.\n\n" +
        "Rules:\n" +
        "- NEVER give up — keep trying until all 10 are ACCEPTED in one run\n" +
        "- If budget runs out (code=-910), immediately reset_budget and fetch_csv again, then retry ALL 10\n" +
        "- If a prompt fails (code=-890), analyze modelOutput vs expected and improve the prompt\n" +
        "- Keep prompts under 100 tokens total. Static instructions first, {id} and {description} last\n" +
        "- Reactor/nuclear parts are ALWAYS NEU — even if description sounds dangerous\n" +
        "- When all 10 are ACCEPTED in one run, you are done — report the flag if present",
    },
  ];

  // Max iteracji żeby nie wpaść w nieskończoną pętlę
  const maxIterations = 150;

  for (let i = 0; i < maxIterations; i++) {
    log("info", `Agent loop iteration ${i + 1}/${maxIterations}`);

    // Pytamy LLM co zrobić następnie
    const response = await client.chat.completions.create({
      model: config.model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    });

    const assistantMessage = response.choices[0]?.message;
    if (!assistantMessage) break;

    // Dodajemy odpowiedź LLM do historii konwersacji
    messages.push(assistantMessage);

    // Jeśli LLM nie chce już używać narzędzi — uznał że skończył
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      log("info", `Agent finished. Message: ${assistantMessage.content ?? "(no message)"}`);

      // Szukamy flagi w ostatniej wiadomości agenta
      const flagMatch = assistantMessage.content?.match(/\{FLG:[^}]+\}/);
      return flagMatch?.[0];
    }

    // Wykonujemy wszystkie tool calls które LLM zlecił w tej iteracji
    for (const toolCall of assistantMessage.tool_calls) {
      if (toolCall.type !== "function") continue;

      const toolName = toolCall.function.name;

      // LLM czasem zwraca niepoprawny JSON w argumentach — zabezpieczamy
      let toolArgs: Record<string, unknown>;
      try {
        toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      } catch {
        log("warn", `Failed to parse tool args for ${toolName}: ${toolCall.function.arguments}`);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: "Error: invalid JSON arguments, please retry",
        });
        continue;
      }

      const toolResult = await dispatchTool(toolName, toolArgs, apiKey, verifyUrl);

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolResult,
      });
    }
  }

  log("warn", "Max iterations reached");
  return undefined;
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = await readConfig<AgentConfig>();
  const params = (config.params as Record<string, unknown> | undefined) ?? {};
  const apiKey = process.env.API_KEY ?? "";
  const verifyUrl =
    typeof params.verifyUrl === "string"
      ? params.verifyUrl
      : "https://hub.ag3nts.org/verify";
  const baseURL =
    typeof params.openrouterBaseURL === "string"
      ? params.openrouterBaseURL
      : "https://openrouter.ai/api/v1";

  log("info", "Agent started");
  log("info", `Model: ${config.model}`);

  const client = createClient(baseURL);
  const flag = await runAgentLoop(client, config, apiKey, verifyUrl);

  if (flag) {
    log("info", `Flag found: ${flag}`);
    result({ status: "done", flag });
  } else {
    log("warn", "No flag found");
    result({ status: "done", flag: null });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    log("error", err instanceof Error ? err.message : "Unknown error");
    process.exit(1);
  });