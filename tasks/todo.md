# TASK-01 — Project Initialization

## Status
Done.

## Verification
- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `npm run dev` and confirmed app loads on `http://localhost:3000`
- [x] Confirmed folders exist: `agents/`, `src/lib/`, `src/components/`
- [x] Confirmed `tsconfig.json` has `"strict": true` and `"@/*": ["./src/*"]`

## Results
- Bootstrapped Next.js 15 project with App Router, TypeScript, Tailwind CSS, and npm scripts.
- Added required project structure for TASK-01:
  - `agents/` (root-level)
  - `src/lib/.gitkeep`
  - `src/components/.gitkeep`
- Replaced starter homepage with minimal placeholder in `src/app/page.tsx` rendering `Agent Hub`.
- Verified strict mode and alias in `tsconfig.json`.
- Verification outcomes:
  - `npx tsc --noEmit` ✅
  - `npm run build` ✅
  - `npm run dev -- --hostname 127.0.0.1 --port 3000` + `curl http://127.0.0.1:3000` ✅ (response contained `Agent Hub`)

---

# TASK-02 — Test Agent + Agent Helpers

## Status
Done.

## Verification
- [x] Red step: `echo '{"model":"test"}' | npx tsx agents/test/index.ts` fails before implementation (`ERR_MODULE_NOT_FOUND`)
- [x] `echo '{"model":"test"}' | npx tsx agents/test/index.ts` succeeds after implementation
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm run build`

## Results
- Added `src/lib/agent-helpers.ts` with `readConfig<T>()`, `log()`, and `result()` for JSON Lines output.
- Added test agent files:
  - `agents/test/agent.config.json`
  - `agents/test/index.ts`
- Test agent behavior implemented: reads stdin config, logs start/model/finish, waits 2 seconds, emits result, exits with code `0`.
- Verification outcomes:
  - Red step (before implementation): `echo '{"model":"test"}' | npx tsx agents/test/index.ts` ❌ `ERR_MODULE_NOT_FOUND` (expected)
  - `echo '{"model":"test"}' | npx tsx agents/test/index.ts` ✅ (JSON log lines + result)
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm run build` ✅

---

# TASK-03 — Agent Scanner

## Status
Done.

## Verification
- [x] Red step: `npx tsx -e "import { scanAgents } from './src/lib/agent-scanner'; void scanAgents;"` fails before implementation (`MODULE_NOT_FOUND`)
- [x] `npx tsx -e "import { scanAgents } from './src/lib/agent-scanner'; scanAgents().then((agents) => { console.log(JSON.stringify(agents)); });"` succeeds after implementation
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm run build`

## Results
- Added `src/lib/agent-scanner.ts` with:
  - `AgentInfo` interface (`id`, `name`, `description`, `hasConfig`)
  - `scanAgents()` implementation using `fs/promises`
- Scanner behavior implemented:
  - scans `agents/` from `process.cwd()`
  - processes directories only
  - ignores entries without `index.ts`
  - reads `name` and `description` from `agent.config.json` when present
  - falls back to `name = id` and `description = ""` without config
  - sorts results alphabetically by `id`
  - returns `[]` when scan errors occur (including missing `agents/`)
- Verification outcomes:
  - Red step (before implementation): `npx tsx -e "import { scanAgents } from './src/lib/agent-scanner'; void scanAgents;"` ❌ `MODULE_NOT_FOUND` (expected)
  - `npx tsx -e "import { scanAgents } from './src/lib/agent-scanner'; scanAgents().then((agents) => { console.log(JSON.stringify(agents)); });"` ✅ (returned `[{\"id\":\"test\",...}]`)
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm run build` ✅

---

# TASK-04 — Config Store

## Status
Done.

## Verification
- [x] Red step: `npx tsx -e "import { getConfig, saveConfig } from './src/lib/config-store'; void getConfig; void saveConfig;"` fails before implementation (`MODULE_NOT_FOUND`)
- [x] `npx tsx -e "import { getConfig, saveConfig } from './src/lib/config-store'; Promise.resolve(getConfig('test')).then((config) => { console.log(JSON.stringify(config)); });"` succeeds after implementation
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm run build`

## Results
- Added `src/lib/config-store.ts` with:
  - `AgentConfig` interface
  - `DEFAULT_CONFIG` constant
  - `getConfig(agentId)` and `saveConfig(agentId, config)`
- `getConfig` behavior implemented:
  - reads from `path.join(process.cwd(), 'agents', agentId, 'agent.config.json')`
  - if file exists: parses JSON and merges with defaults via spread
  - if file is missing: returns default config with `name = agentId`
  - on JSON parse error: returns `DEFAULT_CONFIG`
- `saveConfig` behavior implemented:
  - creates agent directory recursively if missing
  - writes formatted JSON (`JSON.stringify(config, null, 2)`) to `agent.config.json`
- Verification outcomes:
  - Red step (before implementation): `npx tsx -e "import { getConfig, saveConfig } from './src/lib/config-store'; void getConfig; void saveConfig;"` ❌ `MODULE_NOT_FOUND` (expected)
  - `npx tsx -e 'import { DEFAULT_CONFIG, getConfig, saveConfig } from "./src/lib/config-store"; ...'` ✅ (validated fallback + save/load flow)
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm run build` ✅

---

# TASK-05 — API Routes

## Status
Done.

## Verification
- [x] Red step: `npx tsx -e "import './src/app/api/agents/route';"` fails before implementation (`MODULE_NOT_FOUND`)
- [x] `npx tsx -e "import './src/app/api/agents/route'; import './src/app/api/agents/[id]/route';"` succeeds after implementation
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm run build`

## Results
- Added `src/app/api/agents/route.ts`:
  - `GET` handler using `scanAgents()`
  - returns `{ agents }` via `NextResponse.json(...)`
  - error handling returns `500` with `{ error: message }`
- Added `src/app/api/agents/[id]/route.ts`:
  - `GET` handler returning `{ id, config }` from `getConfig(id)`
  - `PUT` handler parsing JSON body and calling `saveConfig(id, body)`
  - both handlers use `await context.params` (Next.js 15)
  - both handlers return `404` for non-existing agent IDs
  - validation for PUT body returns `400` on invalid payload shape
- Verification outcomes:
  - Red step (before implementation): `npx tsx -e "import './src/app/api/agents/route';"` ❌ `MODULE_NOT_FOUND` (expected)
  - `npx tsx -e "import './src/app/api/agents/route'; import './src/app/api/agents/[id]/route';"` ✅
  - API smoke via `curl` on dev server ✅:
    - `GET /api/agents` → `200` with `agents` list
    - `GET /api/agents/test` → `200` with `{ id, config }`
    - `PUT /api/agents/test` → `200` with `{ success: true }`
    - `GET /api/agents/does-not-exist` → `404`
    - `PUT /api/agents/does-not-exist` → `404`
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm run build` ✅

---

# TASK-06 — Agent Runner

## Status
Done.

## Verification
- [x] Red step: `npx tsx -e "import { runAgent } from './src/lib/agent-runner'; void runAgent;"` fails before implementation (`MODULE_NOT_FOUND`)
- [x] `npx tsx -e "import { runAgent } from './src/lib/agent-runner'; void runAgent;"` succeeds after implementation
- [x] Runtime script verifies `log`, `result`, and `done` events
- [x] Runtime script verifies `stop()` sends SIGTERM and process completes
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm run build`

## Results
- Added `src/lib/agent-runner.ts` with:
  - `RunOptions` and `AgentProcess` interfaces
  - `runAgent(options)` returning `{ stop, events }`
- Runner implementation includes:
  - spawn via `spawn('npx', ['tsx', agentPath], { stdio: ['pipe', 'pipe', 'pipe'] })`
  - config transfer over stdin as JSON + `stdin.end()`
  - buffered stdout parsing by `\\n` with fallback info logs for non-JSON lines
  - event emission: `log`, `result`, `done`, `error`
  - stderr forwarding as error-level `log`
  - `stop()` implementation using `SIGTERM`
  - missing entry-file handling via emitted `error` event
- Verification outcomes:
  - Red step (before implementation): `npx tsx -e "import { runAgent } from './src/lib/agent-runner'; void runAgent;"` ❌ `MODULE_NOT_FOUND` (expected)
  - import check after implementation ✅
  - runtime smoke: `runAgent event smoke passed` ✅
  - runtime stop smoke: `runAgent stop smoke passed` ✅
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm run build` ✅

---

# TASK-07 — SSE Endpoint

## Status
Done.

## Verification
- [x] Red step: `npx tsx -e "import './src/app/api/agents/[id]/run/route';"` fails before implementation (`MODULE_NOT_FOUND`)
- [x] `npx tsx -e "import './src/app/api/agents/[id]/run/route';"` succeeds after implementation
- [x] `curl -N http://127.0.0.1:3000/api/agents/test/run` includes `event: log`, `event: result`, `event: done`
- [x] SSE headers are present: `Content-Type`, `Cache-Control`, `Connection`
- [x] Disconnect smoke (`curl --max-time`) executes cancel path without leaving running agent process
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm run build`

## Results
- Added `src/app/api/agents/[id]/run/route.ts` with SSE streaming endpoint.
- Implemented `GET` handler flow:
  - reads `agentId` from `await params`
  - loads config via `getConfig(agentId)`
  - starts process via `runAgent({ agentId, config })`
  - streams events with `ReadableStream` + `TextEncoder`
  - emits SSE events: `log`, `result`, `done`, `error`
  - closes stream on `done`/`error`
  - handles disconnect via `cancel()` calling `agent.stop()`
- Added JSON error responses for `404` (agent missing) and `500` (unexpected errors).
- Verification outcomes:
  - Red step (before implementation): `npx tsx -e "import './src/app/api/agents/[id]/run/route';"` ❌ `MODULE_NOT_FOUND` (expected)
  - `npx tsx -e "import './src/app/api/agents/[id]/run/route';"` ✅
  - SSE smoke (`curl -N`) ✅: stream included `event: log`, `event: result`, `event: done`
  - Header check ✅: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
  - Disconnect smoke (`curl --max-time 1`) + process check ✅: no lingering `agents/test/index.ts` node process
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm run build` ✅

---

# TASK-08 — Stop Endpoint + Active Process Store

## Status
Done.

## Verification
- [x] Red step: `npx tsx -e "import './src/app/api/agents/[id]/stop/route';"` fails before implementation (`MODULE_NOT_FOUND`)
- [x] Import checks for `stopAgent`/`isAgentRunning` and stop route succeed
- [x] Runtime script verifies active map registration + `stopAgent` + cleanup
- [x] API smoke: `POST /api/agents/test/stop` returns `404` when idle
- [x] API smoke: while `/api/agents/test/run` is active, `POST /api/agents/test/stop` returns `200`
- [x] API smoke: second `POST /api/agents/test/stop` returns `404`
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm run build`

## Results
- Extended `src/lib/agent-runner.ts` with global process tracking:
  - added module-level `activeProcesses` map
  - `runAgent()` now registers active process by `agentId`
  - cleanup on process `done` and `error` removes map entry
  - exported `stopAgent(agentId): boolean`
  - exported `isAgentRunning(agentId): boolean`
- Added `src/app/api/agents/[id]/stop/route.ts`:
  - `POST` calls `stopAgent(agentId)`
  - returns `200 { success: true }` when process was running and got stop signal
  - returns `404 { error: \"Agent is not running\" }` when no active process
  - returns `500` JSON on unexpected errors
- Verification outcomes:
  - Red step (before implementation): `npx tsx -e \"import './src/app/api/agents/[id]/stop/route';\"` ❌ `MODULE_NOT_FOUND` (expected)
  - import checks for runner exports and stop route ✅
  - runtime active-map smoke ✅ (`active process map smoke passed`)
  - API smoke on dev server ✅:
    - idle `POST /api/agents/test/stop` → `404`
    - while `/api/agents/test/run` active, `POST /api/agents/test/stop` → `200`
    - second `POST /api/agents/test/stop` → `404`
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm run build` ✅

---

# TASK-09 — Frontend — Lista agentów (strona główna)

## Status
Done.

## Verification
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `npm run dev -- --hostname 127.0.0.1 --port 3000` then `curl -sS http://127.0.0.1:3000 | grep -oE "AGENT HUB|CONFIGURED|NO CONFIG|Brak agentów|centrala // localhost" | sort -u`

## Results
- Added `src/components/AgentCard.tsx`:
  - card/link UI for `/agent/[id]`
  - displays name, description, and status badge (`CONFIGURED` / `NO CONFIG`)
  - command-center styling (dark panel, sharp corners, green-tinted border + hover glow)
- Replaced `src/app/page.tsx`:
  - server-side list rendering via direct `scanAgents()` call
  - responsive grid layout (`1-3` columns)
  - command-center header (`AGENT HUB` + blinking online indicator)
  - empty state message: `Brak agentów. Stwórz folder w agents/ z plikiem index.ts`
  - subtle footer text: `centrala // localhost`
  - set `dynamic = "force-dynamic"` to keep list request-time fresh
- Added `src/app/loading.tsx` for loading state (`Loading agents...` with amber pulse indicator)
- Updated `src/app/layout.tsx` metadata and global body classes for the dark/monospace command-center look.
- Verification outcomes:
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm run build` ✅
  - Dev smoke ✅:
    - started server on `127.0.0.1:3000`
    - `curl` output contained: `AGENT HUB`, `CONFIGURED`, `centrala // localhost`

---

# TASK-10 — Frontend — Widok agenta (config + runner + logi)

## Status
Done.

## Verification
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `npm run dev -- --hostname 127.0.0.1 --port 3000` then:
  - `curl -sS http://127.0.0.1:3000/agent/test | grep -oE "CONFIGURATION|RUN CONTROL|LOG STREAM|Save|Run"`
  - `curl -sS -X PUT http://127.0.0.1:3000/api/agents/test -H 'Content-Type: application/json' --data @agents/test/agent.config.json`
  - `curl -sS -N http://127.0.0.1:3000/api/agents/test/run | head -n 20`

## Results
- Added `src/components/ConfigForm.tsx` (`"use client"`):
  - controlled form for `model`, `systemPrompt`, `temperature`, `maxTokens`
  - model select options: `gpt-4o`, `gpt-4o-mini`, `gpt-4.1-mini`, `claude-sonnet-4-20250514`
  - Save flow via `PUT /api/agents/{id}` with inline success/error notification
  - command-center styling and monospace theme
- Added `src/components/LogViewer.tsx` (`"use client"`):
  - states for `logs`, `status` (`idle`/`running`/`finished`/`error`), and `duration`
  - Run flow via SSE `EventSource` on `/api/agents/{id}/run`
  - handles `log`, `result`, `done`, and `error` events
  - Stop flow via `POST /api/agents/{id}/stop`
  - auto-scrolling terminal-like log panel with level colors (`info`, `warn`, `error`, `debug`) and highlighted `result`
- Added `src/app/agent/[id]/page.tsx` (server component):
  - loads params with `await params` (Next.js 15)
  - gets config via `getConfig(id)` and validates agent existence via `scanAgents()`
  - renders header + back link + side-by-side `ConfigForm` and `LogViewer` (responsive)
  - command-center theme and footer (`centrala // localhost`)
- Added `src/app/agent/[id]/loading.tsx` loading UI.
- Verification outcomes:
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npm run build` ✅
  - Dev smoke ✅:
    - `GET /agent/test` contained `CONFIGURATION`, `RUN CONTROL`, `LOG STREAM`, `Save`, `Run`
    - `PUT /api/agents/test` returned `{"success":true}`
    - SSE stream emitted `event: log`, `event: result`, `event: done`

---

# TASK-11 — AgentConfig params field + ConfigForm JSON editor

## Status
Done.

## Verification
- [ ] `npm run lint` (fails on unrelated files in `agents/S01E0X`, e.g. `no-explicit-any`)
- [ ] `npx tsc --noEmit` (fails on unrelated missing dependency in `agents/S01E03/src/mcp.ts`: `openmeteo`)
- [ ] `npm run build` (fails on unrelated missing dependency in `agents/S01E01/src/main.ts`: `csv-parse/sync`)
- [x] Scoped lint: `npx eslint src/lib/config-store.ts src/components/ConfigForm.tsx`
- [x] Scoped typecheck: temporary project config including only `src/lib/config-store.ts` and `src/components/ConfigForm.tsx`
- [x] `npm run dev -- --hostname 127.0.0.1 --port 3000` then:
  - `curl -sS http://127.0.0.1:3000/agent/test | grep -oE "Agent Parameters \\(JSON\\)|Agent-specific settings" | sort -u`
  - `curl -sS http://127.0.0.1:3000/api/agents/test`

## Results
- Extended `src/lib/config-store.ts`:
  - added `params: Record<string, unknown>` to `AgentConfig`
  - added `params: {}` to `DEFAULT_CONFIG`
- Updated `src/components/ConfigForm.tsx`:
  - added `Agent Parameters (JSON)` section with helper text:
    - `Agent-specific settings — check agent README for available keys`
  - added monospace JSON textarea bound to formatted params JSON
  - on Save, parses textarea JSON and merges into `config.params`
  - invalid JSON (or non-object JSON) now shows inline error and prevents save request
- Updated `docs/prd.md` schema example to include `params`.
- Verification outcomes:
  - Full-repo checks currently fail due unrelated external files in `agents/S01E0X`:
    - `npm run lint` ❌ (`no-explicit-any` in `agents/S01E01/S01E02/S01E03/S01E05`)
    - `npx tsc --noEmit` ❌ (missing module `openmeteo` in `agents/S01E03`)
    - `npm run build` ❌ (missing module `csv-parse/sync` in `agents/S01E01`)
  - Scoped checks for this task passed ✅:
    - `npx eslint src/lib/config-store.ts src/components/ConfigForm.tsx`
    - scoped `tsc --noEmit` using temporary task config including only changed files
  - Dev smoke ✅:
    - `/agent/test` contained `Agent Parameters (JSON)` and `Agent-specific settings`
    - `GET /api/agents/test` returned `config.params: {}`

---

# TASK-12 — Migrate agent S01E01 to Agent Hub contract

## Status
Done.

## Verification
- [x] `echo '{}' | npx tsx agents/S01E01/index.ts`
- [x] `npx eslint agents/S01E01/index.ts`

## Results
- Added `agents/S01E01/agent.config.json` with full Agent Hub config and parameterized `params` values (`csvPath`, demographic filters, verify endpoint/task, OpenRouter base URL).
- Added `agents/S01E01/index.ts` implementing Agent Hub contract:
  - uses `readConfig`, `log`, `result` from `../../src/lib/agent-helpers`
  - no `console.log`/`console.error`
  - typed `S01E01Config` with validated runtime parsing
  - all runtime values read from `config`, `config.params`, and env vars (`OPENROUTER_API_KEY`, `API_KEY`)
  - preserves CSV load/filter/tag/verify flow from original script
  - exits with `process.exit(0)` on success and `process.exit(1)` on error
- Added `agents/S01E01/README.md` with env requirements and params reference table.
- Removed legacy `agents/S01E01/src/` directory.
- Verification outcomes:
  - `echo '{}' | npx tsx agents/S01E01/index.ts` ✅
    - emitted first info log (`Starting S01E01 — People Filter`) and then config-validation error log (expected for empty config)
  - `npx eslint agents/S01E01/index.ts` ✅

---

# TASK-13 — Migrate agent S01E02 to Agent Hub contract

## Status
Done.

## Verification
- [x] `echo '{}' | npx tsx agents/S01E02/index.ts`
- [x] `npx eslint agents/S01E02/index.ts`

## Results
- Added `agents/S01E02/agent.config.json` with full Agent Hub config and parameterized `params`:
  - endpoints (`locationEndpoint`, `accessLevelEndpoint`, `verifyEndpoint`)
  - task name (`verifyTask`)
  - OpenRouter base URL
  - suspects list and power plants map
- Added `agents/S01E02/index.ts` implementing Agent Hub contract:
  - imports `readConfig`, `log`, `result` from `../../src/lib/agent-helpers`
  - no `console.log`
  - typed `S01E02Config` with runtime validation
  - preserves original flow:
    - suspect locations fetch
    - closest suspect via haversine
    - OpenAI tool-call loop (max 10 iterations)
    - tool execution (`get_access_level`, `submit_answer`)
  - parameterizes model/systemPrompt/temperature/maxTokens/endpoints/suspects/powerPlants via config
  - uses `OPENROUTER_API_KEY` and `API_KEY` from environment variables
  - emits `result(finalData)` and exits with explicit success/error codes
- Added `agents/S01E02/README.md` with env requirements and params documentation.
- Removed legacy `agents/S01E02/src/` directory.
- Verification outcomes:
  - `echo '{}' | npx tsx agents/S01E02/index.ts` ✅
    - emitted first info log (`Starting S01E02 — Find Him`) then config-validation error (expected for empty config)
  - `npx eslint agents/S01E02/index.ts` ✅

---

# TASK-14 — Agent scaffolding script + template

## Status
Done.

## Verification
- [x] Red step (before implementation): `npm run new-agent TEST123` failed (`Missing script: "new-agent"`)
- [x] `npm run new-agent TEST123` succeeds after implementation
- [x] Running scaffold twice aborts on existing folder (`npm run new-agent DUP123` then `npm run new-agent DUP123` => second run exits with error)
- [x] `ls -1 agents/TEST123` shows `agent.config.json`, `index.ts`, `README.md`
- [x] `echo '{}' | npx tsx agents/TEST123/index.ts` emits `Agent started` and `Agent finished`
- [x] `rm -rf agents/TEST123` and confirmed folder removal
- [x] `npx tsx -e "import { scanAgents } from './src/lib/agent-scanner'; scanAgents().then((agents) => { const hasTemplate = agents.some((agent) => agent.id === '_template'); console.log(JSON.stringify({ count: agents.length, hasTemplate })); process.exit(hasTemplate ? 1 : 0); });"` returns `{"hasTemplate":false}`
- [x] Scoped lint: `npx eslint scripts/new-agent.ts src/lib/agent-scanner.ts agents/_template/index.ts`
- [ ] `npm run lint -- --quiet` (fails on pre-existing issues in `agents/S01E03` and `agents/S01E05`)
- [ ] `npx tsc --noEmit` (fails on pre-existing missing module `openmeteo` in `agents/S01E03/src/mcp.ts`)
- [ ] `npm run build` (fails for the same pre-existing type error in `agents/S01E03/src/mcp.ts`)

## Results
- Added scaffolding script `scripts/new-agent.ts`:
  - reads agent ID from CLI args (`npx tsx scripts/new-agent.ts <ID>`)
  - verifies `agents/_template` exists
  - aborts with error if `agents/<ID>/` already exists
  - creates `agents/<ID>/` and copies template files
  - logs every created path
- Added template boilerplate in `agents/_template/`:
  - `agent.config.json` with the requested default schema and `params`
  - `index.ts` short starter implementing Agent Hub JSON Lines contract using `readConfig`, `log`, and `result`
  - `README.md` starter documentation
- Updated `package.json`:
  - script: `"new-agent": "tsx scripts/new-agent.ts"`
  - dev dependency: `"tsx"` (required so `npm run new-agent ...` works)
- Updated `src/lib/agent-scanner.ts` to ignore directories that start with `_` (so `_template` is skipped).
- Verification outcomes:
  - Requested scaffold flow (`npm run new-agent TEST123`) ✅
  - Generated agent runtime smoke (`echo '{}' | npx tsx agents/TEST123/index.ts`) ✅
  - Cleanup (`agents/TEST123` removed) ✅
  - Scanner exclusion for `_template` ✅
