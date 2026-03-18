# Agent Hub — Product Requirements Document

## 1. Overview

### Problem Statement

Podczas pracy z kursem AI Devs 4, każde zadanie wymaga zbudowania agenta AI. Struktura agenta jest powtarzalna — zmienia się logika, ale szkielet (model, system prompt, klucze API, obsługa odpowiedzi) jest zawsze podobny. Obecnie każdy agent to osobny skrypt uruchamiany z terminala, bez centralnego miejsca do zarządzania konfiguracją, podglądu logów czy historii uruchomień.

### Solution

**Agent Hub** — lokalna aplikacja webowa (solo dev tool), która:

- automatycznie wykrywa agentów w folderze `agents/`
- pozwala konfigurować każdego agenta z poziomu GUI (model, system prompt, parametry)
- uruchamia agenta jako child process i streamuje logi w real-time
- zachowuje pełną elastyczność — każdy agent to nadal niezależny skrypt TS, który można odpalić z CLI

### Użytkownik

Jeden developer (Bartosz) pracujący lokalnie nad zadaniami AI Devs 4. Narzędzie nie wymaga autentykacji, multi-tenancy ani deploymentu na serwer.

---

## 2. User Stories

### US-1: Przeglądanie listy agentów

> Jako developer, chcę zobaczyć listę wszystkich agentów wykrytych z folderu `agents/`, żebym wiedział jakie zadania mam zrobione i mógł szybko wybrać agenta do uruchomienia.

**Acceptance Criteria:**

- WHEN aplikacja startuje, THEN system skanuje folder `agents/` i wyświetla listę agentów
- WHEN folder agenta zawiera `agent.config.json`, THEN system wyświetla nazwę i opis agenta z tego pliku
- WHEN folder agenta NIE zawiera `agent.config.json`, THEN system wyświetla nazwę folderu jako fallback
- WHEN nowy folder pojawi się w `agents/`, THEN lista odświeża się po przeładowaniu strony

### US-2: Konfiguracja agenta z GUI

> Jako developer, chcę edytować konfigurację agenta (model, system prompt, temperature, max tokens) z poziomu przeglądarki, żebym nie musiał edytować plików JSON ręcznie przy każdym eksperymencie.

**Acceptance Criteria:**

- WHEN wybieram agenta z listy, THEN widzę formularz z jego aktualną konfiguracją
- WHEN edytuję pole i klikam "Save", THEN konfiguracja zapisuje się do pliku `agent.config.json`
- WHEN config zawiera pole `model`, THEN mogę wybrać model z dropdowna (lista wspieranych modeli)
- WHEN config zawiera pole `systemPrompt`, THEN mogę edytować go w textarea
- WHEN config zawiera pola `temperature` i `maxTokens`, THEN mogę je edytować w polach numerycznych

### US-3: Uruchomienie agenta i podgląd logów w real-time

> Jako developer, chcę uruchomić agenta jednym kliknięciem i widzieć jego logi na żywo w przeglądarce, żebym nie musiał przełączać się do terminala.

**Acceptance Criteria:**

- WHEN klikam "Run" na stronie agenta, THEN system uruchamia agenta jako child process
- WHEN agent wypisuje dane na stdout, THEN logi pojawiają się w panelu logów w real-time (< 500ms opóźnienia)
- WHEN agent wypisuje na stderr, THEN logi pojawiają się oznaczone jako error (inny kolor)
- WHEN agent kończy pracę, THEN widzę status zakończenia (exit code) i czas trwania
- WHEN agent jest w trakcie pracy, THEN widzę wskaźnik "running" i przycisk "Stop"
- WHEN klikam "Stop", THEN child process jest zabijany (SIGTERM)

---

## 3. Scope

### MVP (v0.1) — In Scope

| Feature             | Opis                                                    |
| ------------------- | ------------------------------------------------------- |
| Agent Scanner       | Skanowanie folderu `agents/` i wykrywanie agentów       |
| Config GUI          | Formularz edycji konfiguracji per agent                 |
| Agent Runner        | Uruchamianie agenta jako child process (spawn)          |
| Real-time Logs      | Streaming stdout/stderr do przeglądarki (SSE)           |
| Config Persistence  | Zapis konfiguracji do `agent.config.json` (pliki JSON)  |

### Out of Scope (v0.2+)

| Feature              | Powód odroczenia                                        |
| -------------------- | ------------------------------------------------------- |
| Historia uruchomień  | Nice-to-have, ale nie blokuje pracy na MVP              |
| Edytor kodu agenta   | VS Code / Cursor lepiej się do tego nadaje              |
| Multi-user / auth    | Solo dev tool — niepotrzebne                            |
| Deploy na serwer     | Narzędzie lokalne                                       |
| Testy E2E            | Dodamy po ustabilizowaniu MVP                           |

---

## 4. Tech Stack

| Layer       | Technologia         | Uzasadnienie                                        |
| ----------- | ------------------- | --------------------------------------------------- |
| Framework   | Next.js 15 (App Router) | Full-stack w jednym projekcie, React + API routes |
| Język       | TypeScript          | Type safety, spójność z agentami                    |
| Runtime     | Node.js 20+         | LTS, child_process, natywny TS support via tsx      |
| Agent exec  | child_process.spawn | Izolacja agentów, kill support, stdout/stderr streaming |
| Streaming   | Server-Sent Events  | Prostsze niż WebSocket, wystarczające dla logów one-way |
| Config      | Pliki JSON          | Zero zależności, łatwy git tracking                 |
| Styling     | Tailwind CSS        | Szybki prototyping, zero konfiguracji w Next.js     |
| Agent runner| tsx                 | Uruchamianie plików .ts bez kompilacji              |

---

## 5. Architektura — High Level

```
┌─────────────────────────────────────────────────┐
│                   PRZEGLĄDARKA                   │
│                                                  │
│  ┌─────────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Agent List   │  │ Config   │  │ Log Viewer │  │
│  │ (React)      │  │ Form     │  │ (SSE)      │  │
│  └──────┬───────┘  └────┬─────┘  └─────┬──────┘  │
│         │               │              │          │
└─────────┼───────────────┼──────────────┼──────────┘
          │               │              │
    GET /api/agents  PUT /api/agents/:id  GET /api/agents/:id/run (SSE)
          │               │              │
┌─────────┼───────────────┼──────────────┼──────────┐
│         ▼               ▼              ▼          │
│  ┌─────────────┐  ┌──────────┐  ┌────────────┐   │
│  │ Agent       │  │ Config   │  │ Agent      │   │
│  │ Scanner     │  │ Store    │  │ Runner     │   │
│  │ (lib)       │  │ (lib)    │  │ (lib)      │   │
│  └──────┬──────┘  └────┬─────┘  └─────┬──────┘   │
│         │               │              │          │
│    reads folder    reads/writes    spawn + stream │
│         │               │              │          │
│         ▼               ▼              ▼          │
│  ┌──────────────────────────────────────────────┐ │
│  │              FILE SYSTEM                      │ │
│  │  agents/S01E01/index.ts                       │ │
│  │  agents/S01E01/agent.config.json              │ │
│  └──────────────────────────────────────────────┘ │
│                   NEXT.JS SERVER                  │
└───────────────────────────────────────────────────┘
```

---

## 6. Kontrakt agenta

Każdy agent MUSI spełniać następujący kontrakt:

### Struktura folderu

```
agents/<AGENT_ID>/
├── index.ts              ← entry point (wymagany)
├── agent.config.json     ← konfiguracja (opcjonalny — GUI może go stworzyć)
└── ...                   ← dodatkowe pliki agenta (dowolne)
```

### agent.config.json — schema

```json
{
  "name": "string — nazwa wyświetlana w GUI",
  "description": "string — krótki opis co agent robi",
  "model": "string — np. 'gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-20250514'",
  "systemPrompt": "string — system prompt przekazywany do agenta",
  "temperature": "number — 0.0 - 2.0, domyślnie 0.7",
  "maxTokens": "number — domyślnie 4096",
  "env": ["string[] — lista wymaganych zmiennych środowiskowych"],
  "params": { "key": "value — agent-specific config map (any keys)" }
}
```

### Komunikacja serwer → agent

Konfiguracja przekazywana przez **stdin** jako JSON (jednoliniowy):

```
{"model":"gpt-4o","systemPrompt":"...","temperature":0.7,"maxTokens":4096,"params":{}}
```

### Komunikacja agent → serwer

Agent wypisuje na **stdout** linie JSON (JSON Lines / NDJSON):

```
{"type":"log","level":"info","message":"Pobieram dane z API...","timestamp":"..."}
{"type":"log","level":"error","message":"Błąd połączenia","timestamp":"..."}
{"type":"result","data":{"answer":"..."},"timestamp":"..."}
```

Obsługiwane typy: `log` (logi bieżące), `result` (wynik końcowy).
Obsługiwane poziomy logów: `info`, `warn`, `error`, `debug`.

Agent NIE powinien pisać na stdout niczego poza tymi JSON lines.

---

## 7. API Endpoints

### GET /api/agents

Zwraca listę wykrytych agentów.

```json
{
  "agents": [
    {
      "id": "S01E01",
      "name": "Poligon Agent",
      "description": "Agent do zadania Poligon",
      "hasConfig": true
    }
  ]
}
```

### GET /api/agents/:id

Zwraca konfigurację konkretnego agenta.

```json
{
  "id": "S01E01",
  "name": "Poligon Agent",
  "config": {
    "model": "gpt-4o",
    "systemPrompt": "...",
    "temperature": 0.7,
    "maxTokens": 4096,
    "env": ["OPENAI_API_KEY"]
  }
}
```

### PUT /api/agents/:id

Zapisuje konfigurację agenta. Body = config object.

### GET /api/agents/:id/run

**SSE endpoint.** Uruchamia agenta i streamuje eventy:

```
event: log
data: {"level":"info","message":"Start...","timestamp":"..."}

event: log
data: {"level":"error","message":"Coś poszło nie tak","timestamp":"..."}

event: result
data: {"data":{"answer":"RESULT123"},"timestamp":"..."}

event: done
data: {"exitCode":0,"duration":3241}
```

### POST /api/agents/:id/stop

Wysyła SIGTERM do działającego procesu agenta.

---

## 8. Ograniczenia i decyzje

| Decyzja                          | Uzasadnienie                                          |
| -------------------------------- | ----------------------------------------------------- |
| Brak bazy danych                 | Pliki JSON wystarczą dla solo dev tool                 |
| Brak autentykacji                | Localhost only                                         |
| SSE zamiast WebSocket            | Prostsze, jednokierunkowe — wystarczające dla logów   |
| spawn zamiast dynamic import     | Izolacja procesów, kill support, CLI compatibility     |
| tsx jako runner                  | Brak kroku kompilacji, natywne TS execution            |
| Jeden agent na raz               | Uproszczenie MVP — brak kolejkowania                   |

---

## 9. Definition of Done (MVP)

- [ ] `npm run dev` startuje aplikację na localhost
- [ ] Strona główna wyświetla listę agentów z folderu `agents/`
- [ ] Kliknięcie na agenta otwiera widok z formularzem konfiguracji
- [ ] Zmiana konfiguracji i "Save" zapisuje do `agent.config.json`
- [ ] Kliknięcie "Run" uruchamia agenta i pokazuje logi w real-time
- [ ] Kliknięcie "Stop" zabija proces agenta
- [ ] Istnieje agent testowy (`agents/test/index.ts`) do weryfikacji przepływu
