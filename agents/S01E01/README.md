# S01E01 — People Filter

Filters suspects from a CSV file by demographic criteria,
tags their jobs using LLM, and verifies results with centrala API.

## Required env vars
- OPENROUTER_API_KEY — OpenRouter API key
- API_KEY — Centrala verification API key

## Configurable params
| Key | Type | Description |
|-----|------|-------------|
| csvPath | string | Path to CSV file (relative to agent dir) |
| filterGender | string | Gender filter (M/F) |
| filterCity | string | City filter |
| filterAgeMin | number | Minimum age |
| filterAgeMax | number | Maximum age |
| filterTag | string | Job tag to filter by |
| verifyEndpoint | string | Centrala verification URL |
| verifyTask | string | Task name for verification |
| openrouterBaseURL | string | OpenRouter API base URL |
