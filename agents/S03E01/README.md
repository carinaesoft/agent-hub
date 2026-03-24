# Agent: S03E01 — Sensor Anomaly Detector

## Description
Wykrywa anomalie w 10 000 odczytach sensorów elektrowni. Łączy walidację programistyczną (zakresy, nieaktywne sensory) z klasyfikacją notatek operatora przez LLM (batch + deduplikacja).

## Anomaly types detected
1. **OUT_OF_RANGE** — aktywny sensor zgłasza wartość poza normą
2. **UNEXPECTED_DATA** — nieaktywny sensor ma niezerową wartość
3. **OPERATOR_MISMATCH** — operator mówi OK, ale dane mają problem
4. **OPERATOR_FALSE_ALARM** — operator zgłasza problem, ale dane są OK

## Required env vars
- `OPENROUTER_API_KEY` — klucz do OpenRouter
- `API_KEY` — klucz do hub.ag3nts.org

## Params
| Key | Default | Description |
|-----|---------|-------------|
| `dataDir` | `./sensors` | Ścieżka do rozpakowanych plików JSON (relatywna do folderu agenta lub absolutna) |
| `verifyUrl` | `https://hub.ag3nts.org/verify` | Endpoint weryfikacji |
| `task` | `evaluation` | Nazwa zadania |
| `batchSize` | `100` | Ile unikalnych notatek w jednym zapytaniu do LLM |
| `openrouterBaseURL` | `https://openrouter.ai/api/v1` | Base URL dla OpenRouter |

## Setup
1. Pobierz `sensors.zip` z `https://hub.ag3nts.org/dane/sensors.zip`
2. Rozpakuj do folderu (np. `agents/S03E01/sensors/`)
3. Ustaw `dataDir` w config na ścieżkę do rozpakowanych JSONów
4. Uruchom agenta z GUI lub: `cat agents/S03E01/agent.config.json | npx tsx agents/S03E01/index.ts`

## Cost optimization
- ~2000 unikalnych notatek (z 10 000 plików) → ~5x deduplikacja
- Batching po 100 notatek → ~20 zapytań do LLM (zamiast 10 000)
- gpt-4o-mini jako domyślny model (tanie, wystarczająco dobre do klasyfikacji sentymentu)