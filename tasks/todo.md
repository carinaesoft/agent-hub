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
