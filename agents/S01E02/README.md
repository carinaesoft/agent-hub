# S01E02 — Find Him

Finds the suspect who was closest to a power plant, retrieves that suspect's access level,
and submits the answer to centrala.

## Required env vars
- OPENROUTER_API_KEY — OpenRouter API key
- API_KEY — Centrala API key

## Configurable params
| Key | Type | Description |
|-----|------|-------------|
| openrouterBaseURL | string | OpenRouter API base URL |
| locationEndpoint | string | Endpoint used to fetch suspect location points |
| accessLevelEndpoint | string | Endpoint used to fetch suspect access level |
| verifyEndpoint | string | Centrala verification endpoint |
| verifyTask | string | Task name sent during verification |
| suspects | array | Initial list of suspects (`name`, `surname`, `born`) |
| powerPlants | object | Map of plant name to `{ lat, lng, code }` |
