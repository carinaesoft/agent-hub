# Agent Hub — Tasks (MVP v0.1)

> Każdy task to osobny krok implementacji. Rób je po kolei.
> Każdy task zawiera gotowy prompt do GitHub Copilot CLI.

---

## TASK-01: Inicjalizacja projektu Next.js + struktura folderów

### Co zrobić
Postawić projekt Next.js 15 z TypeScript, Tailwind CSS i przygotować strukturę folderów zgodną z PRD.

### Acceptance Criteria
- [ ] `npm run dev` startuje bez błędów na `localhost:3000`
- [ ] Istnieje folder `agents/` w ROOCIE projektu (nie w `src/`)
- [ ] Istnieje folder `src/lib/` na logikę backendową
- [ ] Istnieje folder `src/components/` na komponenty React
- [ ] TypeScript strict mode włączony

### Prompt do Copilota

```
Zainicjalizuj projekt Next.js 15 z App Router, TypeScript (strict mode) i Tailwind CSS.

Struktura folderów:
- src/app/          — Next.js App Router (strony + API routes)
- src/lib/          — logika backendowa (na razie pusty)
- src/components/   — komponenty React (na razie pusty)
- agents/           — folder na agentów (poza src/, w ROOCIE projektu)

Stwórz minimalną stronę główną (src/app/page.tsx) z tekstem "Agent Hub" jako placeholder.

Upewnij się że tsconfig.json ma strict: true i że w projekcie jest path alias "@/*" wskazujący na "src/*".
```

---

## TASK-02: Agent testowy + helper do logowania

### Co zrobić
Stworzyć testowego agenta i helper, który ułatwi agentom logowanie w formacie JSON Lines oraz odczyt konfiguracji ze stdin.

### Acceptance Criteria
- [ ] Istnieje plik `agents/test/index.ts`
- [ ] Istnieje plik `agents/test/agent.config.json` z przykładową konfiguracją
- [ ] Istnieje plik `src/lib/agent-helpers.ts` z funkcjami `readConfig()` i `log()`
- [ ] Agent testowy: odczytuje config ze stdin, loguje kilka wiadomości, czeka 2 sekundy, wypisuje result, kończy z exit code 0
- [ ] Można go uruchomić ręcznie: `echo '{"model":"test"}' | npx tsx agents/test/index.ts`

### Prompt do Copilota

```
Stwórz helper dla agentów i testowego agenta.

1. Plik src/lib/agent-helpers.ts z dwoma eksportowanymi funkcjami:

   readConfig<T>(): Promise<T>
   - Odczytuje cały stdin jako string
   - Parsuje JSON i zwraca obiekt typu T
   - Jeśli stdin jest pusty, zwraca pusty obiekt

   log(level: 'info' | 'warn' | 'error' | 'debug', message: string): void
   - Wypisuje na stdout JSON line w formacie:
     {"type":"log","level":"info","message":"...","timestamp":"2025-01-01T00:00:00.000Z"}
   - Timestamp to ISO string z new Date()

   result(data: unknown): void
   - Wypisuje na stdout JSON line w formacie:
     {"type":"result","data":{...},"timestamp":"..."}

   Użyj process.stdout.write() zamiast console.log() żeby uniknąć dodatkowego newline.
   Każda linia MUSI kończyć się \n.

2. Plik agents/test/agent.config.json:
   {
     "name": "Test Agent",
     "description": "Agent testowy do weryfikacji przepływu",
     "model": "gpt-4o-mini",
     "systemPrompt": "You are a test agent.",
     "temperature": 0.7,
     "maxTokens": 1024,
     "env": []
   }

3. Plik agents/test/index.ts:
   - Importuje readConfig, log, result z src/lib/agent-helpers.ts (użyj ścieżki relatywnej ../../src/lib/agent-helpers)
   - Wywołuje readConfig() żeby odczytać konfigurację
   - Loguje (level info): "Agent testowy uruchomiony"
   - Loguje (level info): "Otrzymany model: {config.model}"
   - Czeka 2 sekundy (setTimeout/sleep)
   - Loguje (level info): "Przetwarzanie zakończone"
   - Wypisuje result z danymi: { answer: "Hello from test agent!", model: config.model }
   - Kończy z process.exit(0)

Agent musi działać po uruchomieniu: echo '{"model":"test"}' | npx tsx agents/test/index.ts
```

---

## TASK-03: Agent Scanner — skanowanie folderu agents/

### Co zrobić
Logika backendowa, która skanuje folder `agents/` i zwraca listę wykrytych agentów.

### Acceptance Criteria
- [ ] Istnieje plik `src/lib/agent-scanner.ts`
- [ ] Funkcja `scanAgents()` zwraca tablicę agentów z polami: `id`, `name`, `description`, `hasConfig`
- [ ] Ignoruje foldery bez pliku `index.ts`
- [ ] Odczytuje `name` i `description` z `agent.config.json` jeśli istnieje
- [ ] Używa fallbacku (nazwa folderu) jeśli config nie istnieje

### Prompt do Copilota

```
Stwórz plik src/lib/agent-scanner.ts.

Zdefiniuj typ:
  interface AgentInfo {
    id: string          // nazwa folderu, np. "S01E01"
    name: string        // z agent.config.json lub fallback = id
    description: string // z agent.config.json lub fallback = ""
    hasConfig: boolean  // czy agent.config.json istnieje
  }

Eksportuj async function scanAgents(): Promise<AgentInfo[]>
  - Odczytuje zawartość folderu agents/ (ścieżka: path.join(process.cwd(), 'agents'))
  - Filtruje tylko katalogi (nie pliki)
  - Dla każdego katalogu sprawdza czy istnieje index.ts — jeśli nie, pomija
  - Jeśli istnieje agent.config.json, odczytuje name i description
  - Jeśli nie istnieje, używa id jako name i pusty string jako description
  - Zwraca tablicę AgentInfo posortowaną alfabetycznie po id

Użyj fs/promises. Obsłuż błędy (np. brak folderu agents/) — zwróć pustą tablicę.
```

---

## TASK-04: Config Store — odczyt i zapis konfiguracji

### Co zrobić
Logika do odczytu i zapisu pliku `agent.config.json` per agent.

### Acceptance Criteria
- [ ] Istnieje plik `src/lib/config-store.ts`
- [ ] Funkcja `getConfig(agentId)` zwraca konfigurację agenta
- [ ] Funkcja `saveConfig(agentId, config)` zapisuje konfigurację do pliku
- [ ] Jeśli plik nie istnieje, `getConfig` zwraca domyślną konfigurację
- [ ] Zapis tworzy plik jeśli nie istnieje

### Prompt do Copilota

```
Stwórz plik src/lib/config-store.ts.

Zdefiniuj i eksportuj typ:
  interface AgentConfig {
    name: string
    description: string
    model: string
    systemPrompt: string
    temperature: number
    maxTokens: number
    env: string[]
  }

Zdefiniuj stałą DEFAULT_CONFIG: AgentConfig z wartościami:
  name: "", description: "", model: "gpt-4o-mini",
  systemPrompt: "You are a helpful assistant.",
  temperature: 0.7, maxTokens: 4096, env: []

Eksportuj dwie async funkcje:

  getConfig(agentId: string): Promise<AgentConfig>
  - Ścieżka pliku: path.join(process.cwd(), 'agents', agentId, 'agent.config.json')
  - Jeśli plik istnieje — odczytaj, sparsuj JSON, zmerguj z DEFAULT_CONFIG (spread: {...DEFAULT_CONFIG, ...parsed})
  - Jeśli plik nie istnieje — zwróć DEFAULT_CONFIG z name = agentId

  saveConfig(agentId: string, config: AgentConfig): Promise<void>
  - Zapisz config jako sformatowany JSON (JSON.stringify z indent 2) do agent.config.json
  - Stwórz folder agenta jeśli nie istnieje (recursive: true)

Użyj fs/promises. Obsłuż błędy parsowania JSON — zwróć DEFAULT_CONFIG w razie błędu.
```

---

## TASK-05: API Routes — endpointy REST

### Co zrobić
Endpointy Next.js API do listowania agentów, odczytu/zapisu konfiguracji.

### Acceptance Criteria
- [ ] GET `/api/agents` zwraca listę agentów (z agent-scanner)
- [ ] GET `/api/agents/[id]` zwraca konfigurację agenta (z config-store)
- [ ] PUT `/api/agents/[id]` zapisuje konfigurację agenta
- [ ] Odpowiedzi w formacie JSON z poprawnymi status kodami
- [ ] Nieistniejący agent zwraca 404

### Prompt do Copilota

```
Stwórz API routes w Next.js App Router:

1. src/app/api/agents/route.ts
   - GET handler: wywołuje scanAgents() z @/lib/agent-scanner i zwraca { agents: [...] }
   - Response z Content-Type: application/json

2. src/app/api/agents/[id]/route.ts
   - GET handler: wywołuje getConfig(id) z @/lib/config-store, zwraca { id, config }
   - PUT handler: odczytuje body jako JSON, wywołuje saveConfig(id, body), zwraca { success: true }
   - Parametr id pochodzi z params (Next.js dynamic route)

Użyj NextResponse z next/server. Obsłuż błędy — zwróć status 500 z { error: message }.
Pamiętaj o await params w Next.js 15 (params jest Promise).
```

---

## TASK-06: Agent Runner — spawn + stdin + stdout streaming

### Co zrobić
Serce systemu — logika uruchamiania agenta jako child process z konfiguracją przez stdin i streamowaniem stdout.

### Acceptance Criteria
- [ ] Istnieje plik `src/lib/agent-runner.ts`
- [ ] Funkcja `runAgent()` spawnuje process `npx tsx agents/{id}/index.ts`
- [ ] Przekazuje konfigurację przez stdin jako JSON
- [ ] Emituje eventy: `log`, `result`, `done`, `error`
- [ ] Obsługuje kill procesu (SIGTERM)
- [ ] Zwraca obiekt z metodą `stop()` i EventEmitter

### Prompt do Copilota

```
Stwórz plik src/lib/agent-runner.ts.

Użyj child_process.spawn i EventEmitter z Node.js.

Zdefiniuj interfejsy:
  interface RunOptions {
    agentId: string
    config: Record<string, unknown>
  }

  interface AgentProcess {
    stop: () => void
    events: EventEmitter
  }

Eksportuj function runAgent(options: RunOptions): AgentProcess

Implementacja:
  - Oblicz ścieżkę agenta: path.join(process.cwd(), 'agents', options.agentId, 'index.ts')
  - Sprawdź czy plik istnieje (fs.existsSync) — jeśli nie, emituj event 'error' i zwróć
  - Spawn: spawn('npx', ['tsx', agentPath], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] })
  - Zapamiętaj start time: Date.now()
  - Wyślij config na stdin: child.stdin.write(JSON.stringify(options.config)); child.stdin.end()
  - Nasłuchuj child.stdout (event 'data'):
      - Splituj po \n (może przyjść kilka linii naraz)
      - Dla każdej niepustej linii: sparsuj JSON
      - Jeśli parsed.type === 'log' → events.emit('log', parsed)
      - Jeśli parsed.type === 'result' → events.emit('result', parsed)
      - Jeśli parsowanie JSON się nie uda → events.emit('log', { type:'log', level:'info', message: rawLine, timestamp: new Date().toISOString() })
  - Nasłuchuj child.stderr (event 'data'):
      - events.emit('log', { type:'log', level:'error', message: data.toString(), timestamp: new Date().toISOString() })
  - Nasłuchuj child event 'close' (exitCode):
      - events.emit('done', { exitCode, duration: Date.now() - startTime })
  - Nasłuchuj child event 'error':
      - events.emit('error', { message: err.message })
  - stop(): child.kill('SIGTERM')
  - Zwróć { stop, events }

Pamiętaj: stdout może buforować dane, więc splitowanie po \n jest konieczne.
```

---

## TASK-07: SSE Endpoint — streaming logów do przeglądarki

### Co zrobić
API route, które uruchamia agenta i streamuje logi jako Server-Sent Events.

### Acceptance Criteria
- [ ] GET `/api/agents/[id]/run` zwraca SSE stream
- [ ] Eventy: `log`, `result`, `done` streamowane w real-time
- [ ] Nagłówki SSE poprawnie ustawione (Content-Type, Cache-Control, Connection)
- [ ] Stream zamyka się po evencie `done`
- [ ] Obsługa odłączenia klienta (client disconnect → kill process)

### Prompt do Copilota

```
Stwórz plik src/app/api/agents/[id]/run/route.ts

GET handler który:
1. Odczytuje agentId z params
2. Odczytuje config agenta z getConfig(agentId) (z @/lib/config-store)
3. Wywołuje runAgent({ agentId, config }) z @/lib/agent-runner
4. Zwraca Response z ReadableStream który streamuje Server-Sent Events

Implementacja streamu:
  - Stwórz ReadableStream z controller
  - Helper: function sendEvent(event: string, data: unknown) {
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    }
  - Podłącz do agent.events:
    - 'log' → sendEvent('log', payload)
    - 'result' → sendEvent('result', payload)
    - 'done' → sendEvent('done', payload), potem controller.close()
    - 'error' → sendEvent('error', payload), potem controller.close()
  - cancel(): agent.stop() — wywoływane gdy klient się rozłączy

  Return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  })

Pamiętaj: TextEncoder do enkodowania stringów. await params bo Next.js 15.
```

---

## TASK-08: POST /api/agents/[id]/stop — zatrzymanie agenta

### Co zrobić
Endpoint do zatrzymania działającego agenta. Wymaga globalnego store na aktywne procesy.

### Acceptance Criteria
- [ ] POST `/api/agents/[id]/stop` zabija działający proces
- [ ] Zwraca 200 jeśli agent był uruchomiony i został zatrzymany
- [ ] Zwraca 404 jeśli agent nie jest uruchomiony
- [ ] Agent runner rejestruje/wyrejestrowuje aktywne procesy w globalnym Map

### Prompt do Copilota

```
Rozszerz agent-runner.ts i dodaj endpoint stop.

1. W src/lib/agent-runner.ts dodaj:
   - Globalny Map do śledzenia aktywnych procesów:
     const activeProcesses = new Map<string, AgentProcess>()
   - W runAgent(): zapisz proces do activeProcesses.set(agentId, agentProcess)
   - Po evencie 'done' lub 'error': activeProcesses.delete(agentId)
   - Eksportuj function stopAgent(agentId: string): boolean
     - Jeśli activeProcesses.has(agentId) → wywołaj stop(), zwróć true
     - Jeśli nie → zwróć false
   - Eksportuj function isAgentRunning(agentId: string): boolean

2. Stwórz src/app/api/agents/[id]/stop/route.ts:
   - POST handler: wywołuje stopAgent(agentId)
   - Jeśli true → 200 { success: true }
   - Jeśli false → 404 { error: "Agent is not running" }

Uwaga: w Next.js moduły zachowują stan w ramach jednego procesu serwera,
więc globalny Map zadziała poprawnie dla dev servera.
```

---

## TASK-09: Frontend — Lista agentów (strona główna)

### Co zrobić
Strona główna wyświetlająca listę agentów jako karty/linki.

### Acceptance Criteria
- [ ] Strona główna (`/`) wyświetla listę agentów z GET /api/agents
- [ ] Każdy agent to karta z: nazwą, opisem, statusem (has config)
- [ ] Kliknięcie karty prowadzi do `/agent/[id]`
- [ ] Loading state podczas ładowania
- [ ] Pusty stan gdy brak agentów

### Prompt do Copilota

```
Stwórz frontend strony głównej Agent Hub.

1. src/components/AgentCard.tsx
   - Props: { id: string, name: string, description: string, hasConfig: boolean }
   - Komponent wyświetla kartę z nazwą, opisem i badge "configured" / "no config"
   - Karta jest klikalna — Link do /agent/{id}
   - Stylowanie: Tailwind CSS, ciemny motyw, border, hover effect

2. src/app/page.tsx
   - Server component (domyślny w Next.js App Router)
   - Fetch agentów z /api/agents (server-side fetch, absolutny URL nie jest potrzebny — użyj bezpośrednio scanAgents() z lib)
   - Wyświetl siatkę kart AgentCard (grid, responsive: 1-3 kolumny)
   - Nagłówek: "Agent Hub" + krótki opis
   - Stan pusty: "Brak agentów. Stwórz folder w agents/ z plikiem index.ts"
   - Ciemny motyw (dark background, light text)
3. Visual style — "Command Center" theme:
    This app manages AI agents in a world of secret logistics operations,
    nuclear reactors, package redirections and covert datacenter missions.
    The UI should feel like a military/industrial command center dashboard.

    Colors:
    - Background: #0a0f0a (near-black with slight green tint)
    - Cards/panels: #0d1117 with border #1b2e1b (dark green-tinted border)
    - Primary accent: emerald-500 (#10b981) — for active states, buttons, badges
    - Secondary accent: amber-500 (#f59e0b) — for warnings, running status
    - Error: red-500
    - Text primary: #c9d1d9 (soft gray-white)
    - Text secondary: #6b7b6b (muted green-gray)
    - Result highlight: cyan-400 on dark background

    Visual elements:
    - Monospace font for ALL text (e.g. JetBrains Mono or font-mono from Tailwind)
    - Agent cards should feel like "mission briefings" — sharp corners (rounded-sm),
    thin borders, subtle green glow on hover (shadow-emerald-900/20)
    - Status badges: "CONFIGURED" in emerald, "NO CONFIG" in gray, "RUNNING" in amber pulse
    - Log panel: pure black (#000) background, green-tinted text, like a terminal
    - Log levels: info=emerald-400, warn=amber-400, error=red-400, debug=gray-500
    - Result entries: highlighted with a cyan-400 left border
    - "Run" button: emerald with a play icon, transforms to amber "Stop" when running
    - Page header: "AGENT HUB" in uppercase, tracked-wider, with a small
    blinking dot (emerald) to indicate system is online
    - Footer or subtle text: "centrala // localhost" in muted text
    - Overall feel: Fallout terminal meets Bloomberg Terminal meets military C2 system
```

---

## TASK-10: Frontend — Widok agenta (config + runner + logi)

### Co zrobić
Strona pojedynczego agenta z formularzem konfiguracji, przyciskiem Run/Stop i panelem logów.

### Acceptance Criteria
- [ ] Strona `/agent/[id]` wyświetla formularz konfiguracji
- [ ] Formularz: pola na model (select), systemPrompt (textarea), temperature (number), maxTokens (number)
- [ ] Przycisk "Save" zapisuje config (PUT /api/agents/[id])
- [ ] Przycisk "Run" uruchamia agenta i otwiera stream SSE
- [ ] Panel logów wyświetla logi w real-time (kolorowanie wg level)
- [ ] Przycisk "Stop" zatrzymuje agenta (POST /api/agents/[id]/stop)
- [ ] Status: idle → running → finished/error

### Prompt do Copilota

```
Stwórz stronę widoku agenta z trzema sekcjami: config, kontrolki, logi.

1. src/components/ConfigForm.tsx (client component — "use client")
   - Props: { agentId: string, initialConfig: AgentConfig }
   - AgentConfig to typ z config-store (model, systemPrompt, temperature, maxTokens, itp.)
   - Pola formularza:
     - model: <select> z opcjami: gpt-4o, gpt-4o-mini, gpt-4.1-mini, claude-sonnet-4-20250514
     - systemPrompt: <textarea> (min 4 wiersze)
     - temperature: <input type="number" step="0.1" min="0" max="2">
     - maxTokens: <input type="number" step="256" min="256" max="16384">
   - Przycisk "Save" → PUT /api/agents/{agentId} z aktualnym stanem formularza
   - Toast/komunikat po zapisie (sukces/błąd)
   - Stylowanie: Tailwind CSS, ciemny motyw

2. src/components/LogViewer.tsx (client component — "use client")
   - Props: { agentId: string }
   - Stan: logs (tablica), status ('idle' | 'running' | 'finished' | 'error'), duration
   - Przycisk "Run":
     - Czyści logi
     - Ustawia status na 'running'
     - Otwiera EventSource na /api/agents/{agentId}/run
     - Nasłuchuje eventów: 'log', 'result', 'done', 'error'
     - 'log' → dodaj do tablicy logów
     - 'result' → dodaj do logów z wyróżnieniem
     - 'done' → ustaw status 'finished', zapisz duration, zamknij EventSource
     - 'error' → ustaw status 'error', zamknij EventSource
   - Przycisk "Stop" (widoczny gdy status = running):
     - POST /api/agents/{agentId}/stop
   - Panel logów:
     - Scrollowalny div z auto-scroll na dół
     - Każdy log: timestamp + level (kolorowy badge) + message
     - level info = zielony, warn = żółty, error = czerwony, debug = szary
     - result = wyróżniony (np. niebieskie tło)
   - Stylowanie: Tailwind CSS, ciemny motyw, monospace font dla logów

3. src/app/agent/[id]/page.tsx
   - Server component
   - Odczytaj config z getConfig(id)
   - Wyświetl: nagłówek z nazwą agenta, link powrotny do /
   - Pod nagłówkiem: ConfigForm i LogViewer obok siebie (lub pod sobą na mobile)

 4. Visual style — "Command Center" theme:
    This app manages AI agents in a world of secret logistics operations,
    nuclear reactors, package redirections and covert datacenter missions.
    The UI should feel like a military/industrial command center dashboard.

    Colors:
    - Background: #0a0f0a (near-black with slight green tint)
    - Cards/panels: #0d1117 with border #1b2e1b (dark green-tinted border)
    - Primary accent: emerald-500 (#10b981) — for active states, buttons, badges
    - Secondary accent: amber-500 (#f59e0b) — for warnings, running status
    - Error: red-500
    - Text primary: #c9d1d9 (soft gray-white)
    - Text secondary: #6b7b6b (muted green-gray)
    - Result highlight: cyan-400 on dark background

    Visual elements:
    - Monospace font for ALL text (e.g. JetBrains Mono or font-mono from Tailwind)
    - Agent cards should feel like "mission briefings" — sharp corners (rounded-sm),
    thin borders, subtle green glow on hover (shadow-emerald-900/20)
    - Status badges: "CONFIGURED" in emerald, "NO CONFIG" in gray, "RUNNING" in amber pulse
    - Log panel: pure black (#000) background, green-tinted text, like a terminal
    - Log levels: info=emerald-400, warn=amber-400, error=red-400, debug=gray-500
    - Result entries: highlighted with a cyan-400 left border
    - "Run" button: emerald with a play icon, transforms to amber "Stop" when running
    - Page header: "AGENT HUB" in uppercase, tracked-wider, with a small
    blinking dot (emerald) to indicate system is online
    - Footer or subtle text: "centrala // localhost" in muted text
    - Overall feel: Fallout terminal meets Bloomberg Terminal meets military C2 system  
```

---

## Kolejność implementacji

```
TASK-01  Projekt Next.js          ← fundament
   ↓
TASK-02  Agent testowy + helpers  ← coś do testowania
   ↓
TASK-03  Agent Scanner            ← backend: wykrywanie
TASK-04  Config Store             ← backend: konfiguracja
   ↓
TASK-05  API Routes (REST)        ← backend: endpointy
   ↓
TASK-06  Agent Runner             ← backend: serce systemu
TASK-07  SSE Endpoint             ← backend: streaming
TASK-08  Stop Endpoint            ← backend: kontrola
   ↓
TASK-09  Frontend: lista          ← GUI: strona główna
TASK-10  Frontend: widok agenta   ← GUI: config + logi
```

Po TASK-02 możesz testować agenta z CLI.
Po TASK-08 możesz testować cały backend z curl/Postman.
Po TASK-10 masz działające MVP.