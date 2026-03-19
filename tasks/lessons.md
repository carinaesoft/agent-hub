# Lessons Learned

## 2026-03-17 — create-next-app temporary directory naming

- Failure mode: `create-next-app` failed when the temporary directory name started with a dot (`.tmp-next15`) because npm package naming rules disallow names starting with `.`.
- Detection signal: CLI error `Could not create a project called ".tmp-next15" because of npm naming restrictions`.
- Prevention rule: Use temporary scaffold directory names that are valid npm package names (for example, `tmp-next15`).

## 2026-03-17 — shell interpolation inside `tsx -e` command

- Failure mode: Used shell interpolation syntax inside a quoted `tsx -e` command, causing `bad substitution` and invalid stdout writes.
- Detection signal: Bash error `bad substitution` and Node `ERR_INVALID_ARG_TYPE` during verification.
- Prevention rule: Use single-quoted `tsx -e` scripts and avoid shell-side interpolation inside inline JavaScript snippets.

## 2026-03-18 — passing typed config to generic record API

- Failure mode: Passed `AgentConfig` directly to `runAgent()` which expects `Record<string, unknown>`, causing a TypeScript incompatibility.
- Detection signal: `TS2322` error (`AgentConfig` not assignable to `Record<string, unknown>`) during typecheck.
- Prevention rule: Normalize strongly typed config objects to plain records (`{ ...config }`) before passing them to generic `Record<string, unknown>` APIs.

## 2026-03-18 — unreliable red-step using named import presence

- Failure mode: Used `npx tsx -e "import { stopAgent } from './src/lib/agent-runner'; ..."` as a red-step check, but it did not fail even before implementing the export.
- Detection signal: command exited successfully when failure was expected.
- Prevention rule: For red steps, prefer checks that fail deterministically at runtime (for example, importing a missing file path or executing behavior that requires the missing symbol), not checks that depend on transpiler/module interop quirks.

## 2026-03-18 — template runtime crash on partial stdin config

- Failure mode: Template agent accessed `config.params.openrouterBaseURL` directly, which crashed when stdin config was `{}` and `params` was missing.
- Detection signal: `echo '{}' | npx tsx agents/TEST123/index.ts` failed with `Cannot read properties of undefined (reading 'openrouterBaseURL')`.
- Prevention rule: Treat stdin config as partial input and normalize optional nested objects before reading their fields.
