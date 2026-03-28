# Agent: S03E02 — Firmware Debugger

## Description
Explores a restricted Linux VM via shell API to diagnose, fix, and launch the ECCS cooler firmware. Uses function calling with two tools: `shell_command` (with automatic ban detection + wait + retry) and `verify_answer`.

## Required env vars
- `OPENROUTER_API_KEY` — OpenRouter API key
- `API_KEY` — hub.ag3nts.org API key

## Params
| Key | Type | Description |
|-----|------|-------------|
| `shellUrl` | string | Shell API endpoint |
| `verifyUrl` | string | Verification endpoint |
| `task` | string | Task name for verification |
| `maxIterations` | number | Max agent loop iterations |
| `banRetryDelayMs` | number | Min wait time after ban (ms) |
| `maxBanRetries` | number | Max retries after ban per command |

## Ban handling
The shell API bans you temporarily (code `-733`/`-735`) if you violate security rules (e.g. reading .gitignore'd files, accessing /etc). The `shell_command` tool automatically:
1. Detects ban response codes
2. Waits `seconds_left` (or `banRetryDelayMs` minimum)
3. Retries up to `maxBanRetries` times
4. Returns a descriptive error if all retries fail

The agent sees a clean message, not raw error codes.