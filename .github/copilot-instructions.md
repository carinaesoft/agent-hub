# Copilot instructions for Agent Hub

This file is a strict add-on to the project's specs (`docs/prd.md`, `docs/tasks.md`).
Follow both. When they conflict, follow the stricter rule.

## Purpose
Make Copilot's output reliable in a real codebase by enforcing:
- small, verifiable changes
- clear acceptance criteria
- a verification story
- no secrets / no tokens in terminal output or logs
- safe-by-default local tool execution

---

## Project Context

**Agent Hub** is a local-only solo dev tool for managing and running AI agents.
- Stack: Next.js 15 (App Router), TypeScript (strict), Tailwind CSS
- Agents live in `agents/` folder (root level, outside `src/`)
- Each agent is a child process spawned via `npx tsx`
- Config stored as JSON files (`agent.config.json` per agent)
- Logs streamed via Server-Sent Events (SSE)
- No database, no auth, no deployment — localhost only

Key specs to reference before implementing:
- `docs/prd.md` — requirements, architecture, API contracts, agent contract
- `docs/tasks.md` — task breakdown with acceptance criteria

---

## Core Operating Rules

### Spec First
- Before writing code, read the relevant section of `docs/prd.md`.
- Follow the agent contract (Section 6 of PRD): stdin for config, stdout for JSON Lines.
- Follow the API contract (Section 7 of PRD): endpoint shapes, status codes, response formats.
- If a task prompt conflicts with the PRD, follow the PRD.

### Minimal Dependencies & Minimal Changes
- Prefer existing patterns in the repo.
- Do not add new libraries unless explicitly required for the task.
- Avoid broad refactors, formatting-only sweeping changes, or restructuring unrelated files.
- Use only what Next.js 15, Node.js built-ins, and Tailwind provide — no ORMs, no state managers, no UI libraries beyond what's listed in the task.

### Stop-the-Line Rule (When Anything Unexpected Happens)
If you hit:
- build errors
- lint failures
- typecheck failures (`npx tsc --noEmit`)
- runtime crashes
- behavior regressions

Then:
1) STOP adding features
2) diagnose the root cause
3) fix it
4) re-run verification
5) document the outcome in `tasks/todo.md`

---

## Mandatory Repo Artifacts (Process Outputs)

For any non-trivial task (3+ steps, multi-file change, or anything involving process management):
1) Create or update `tasks/todo.md` with the current task status.
2) Add a *Verification* checklist to `tasks/todo.md` with exact commands and/or manual repro steps.
3) After completing work, add a short *Results* section to `tasks/todo.md`:
   - what changed (high-level)
   - where (file paths)
   - how it was verified (commands + outcomes)
4) Update `tasks/lessons.md` *only if*:
   - a mistake was made and corrected, OR
   - a regression was found, OR
   - an assumption turned out wrong.
   Each lesson must include: failure mode, detection signal, prevention rule.

If these files do not exist, create them.

---

## Verification Is Not Optional

Before claiming a task is done, you MUST:
- run the verification commands listed in `tasks/todo.md`, and
- report pass/fail status in `tasks/todo.md` Results.

If you cannot run verification (missing tools/permissions), say so explicitly and list the exact commands the developer must run.

### Default minimum verification (Next.js + TypeScript project)
Use the repo's existing tooling first. If not present, the minimum baseline is:

1) Type check:
- `npx tsc --noEmit`

2) Build check:
- `npm run build`

3) Dev server smoke:
- `npm run dev` → verify localhost:3000 loads without errors

4) Agent contract smoke (after TASK-02):
- `echo '{"model":"test"}' | npx tsx agents/test/index.ts`
- Verify: stdout contains valid JSON Lines, exit code 0

5) API smoke (after TASK-05):
- `curl http://localhost:3000/api/agents` → returns JSON with agents array
- `curl http://localhost:3000/api/agents/test` → returns agent config

6) SSE smoke (after TASK-07):
- `curl -N http://localhost:3000/api/agents/test/run` → streams SSE events
- Verify: receives `event: log`, `event: result`, `event: done`

Always record exactly what you ran in `tasks/todo.md`.

---

## Security / Privacy Guardrails

### Never leak secrets
- Never print or log raw API keys (OPENAI_API_KEY, TASK_API_KEY, etc.).
- Never include secrets in error messages, log output, or SSE events.
- Never commit secrets. Use `.env` and provide `.env.example` with key names only.
- Agent stdout/stderr is streamed to the browser — treat it as potentially visible.
- If an agent accidentally logs an API key, the runner should NOT relay it to SSE.

### Configuration handling
- `agent.config.json` is non-secret configuration (model, prompt, temperature).
- API keys belong in `.env` (root level), passed to agents via `process.env` inheritance.
- `.env` is local only and MUST be in `.gitignore`.
- `.env.example` contains key names without values.

---

## Rule: Terminal & Browser Output Has No Secrets
- Treat SSE events, browser console, and terminal output as shareable.
- Never echo secrets back to the user in any channel.
- Agent runner MUST NOT include `process.env` contents in SSE events.
- Config objects sent via stdin to agents MUST NOT contain raw API keys — agents inherit env vars from the spawned process.

---

## Rule: The only language for code and documents is English
- All code, comments, variable names, type definitions, and documentation MUST be in English.
- `agent.config.json` fields (name, description, systemPrompt) MAY contain Polish or any language — these are user content, not code.
- Git commit messages in English.

---

## TypeScript Rules

### Strict mode is mandatory
- `tsconfig.json` must have `strict: true`.
- No `any` types unless explicitly justified with a `// eslint-disable-next-line` comment explaining why.
- Prefer `unknown` over `any` for untyped external data, then narrow with type guards.

### Shared types
- Shared interfaces (AgentConfig, AgentInfo, LogEntry, etc.) live in `src/lib/types.ts`.
- Do not redefine the same type in multiple files.
- Agent helpers (`src/lib/agent-helpers.ts`) are imported by agents via relative paths — they MUST NOT use `@/` path aliases (agents are outside `src/`).

### Error handling
- All `fs/promises` calls must be wrapped in try/catch.
- All JSON.parse calls must be wrapped in try/catch.
- API routes must return proper HTTP status codes (400, 404, 500) with `{ error: string }` body.
- Child process errors must be caught and emitted as SSE error events.

---

## Next.js 15 Rules

### App Router specifics
- `params` is a Promise in Next.js 15 — always `await params` before using.
- Server Components are the default — only add `"use client"` when the component needs interactivity (useState, useEffect, event handlers).
- API routes use `NextResponse` from `next/server`.
- Do not mix Pages Router patterns (getServerSideProps, etc.) with App Router.

### File structure
- Pages: `src/app/**/page.tsx`
- API routes: `src/app/api/**/route.ts`
- Shared components: `src/components/`
- Backend logic: `src/lib/`
- Agents: `agents/` (root level, NOT in src/)

---

## Agent Contract Rules

### Every agent MUST:
- Read config from stdin (JSON, single line)
- Output ONLY valid JSON Lines to stdout
- Each line: `{"type":"log"|"result","level?":"info"|"warn"|"error"|"debug","message?":"...","data?":{},"timestamp":"ISO"}`
- Exit with code 0 on success, non-zero on failure
- NOT use `console.log()` — use `process.stdout.write()` via agent-helpers

### Agent runner MUST:
- Send config via `child.stdin.write()` + `child.stdin.end()`
- Parse stdout line by line (split by `\n`)
- Handle malformed JSON lines gracefully (wrap as info log)
- Forward stderr as error-level logs
- Track start time and report duration on exit
- Register/unregister from activeProcesses map

---

## Output Style Expectations (for Copilot)
- Prefer incremental commits/patches with small diffs.
- One task = one logical commit.
- Commit message format: `feat(TASK-XX): short description`
- Do not combine multiple tasks in one commit.
- Do not modify files outside the scope of the current task.