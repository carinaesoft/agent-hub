# Gemini Instructions for Agent Hub

This file provides context and strict guidelines for Gemini (Antigravity) while working on the **Agent Hub** codebase. Always prioritize these rules alongside `docs/prd.md` and `docs/tasks.md`.

## 1. Project Context
**Agent Hub** is a local-only development tool for managing and running AI agents.
- **Stack**: Next.js 15 (App Router), TypeScript (Strict), Tailwind CSS 4.
- **Architecture**: No database. Config is stored in `agents/<agent-id>/agent.config.json` files.
- **Agent Lifecycle**: Agents are independent TS scripts in the `agents/` directory, executed via `tsx` as child processes.
- **Communication**: 
  - Host → Agent: JSON via **stdin**.
  - Agent → Host: JSON Lines (NDJSON) via **stdout**.
  - Host → Client: Logs and results streamed via **Server-Sent Events (SSE)**.

## Kiedy zadaję Ci pytanie dotyczące kodu, postępuj zgodnie z poniższymi zasadami:

Najpierw intuicja: Wyjaśnijąc pojęcia zadbaj o zrozumiałość dla osoby, która dopiero się uczy.
Konkretność i praktyczność: Każde złożone pojęcie abstrakcyjne (formuły, architektura) poprzyj prostym, konkretnym przykładem lub scenariuszem.
„Dlaczego”: Nie wyjaśniaj tylko, jak to działa; wyjaśnij, dlaczego wybraliśmy takie podejście, jakie są związane z tym kompromisy oraz potencjalne błędy/pułapki.
Szersza perspektywa: Porównuj omawiane pojęcia z innymi technologiami, językami, frameworkami, które inaczej podchodzą do rozwiązywania podobnych problemów, tak abym poznawał alternatywne podejścia do architektury i wzorców.
Zasada aktywnego uczenia się: Nigdy nie kończ odpowiedzi samym kropką. ZAWSZE kończ konkretnym pytaniem, scenariuszem „co by było, gdyby” lub małym problemem do rozwiązania, aby sprawdzić moje zrozumienie. Nie kontynuuj, dopóki nie udzielę prawidłowej odpowiedzi — jeśli się pomylę, wyjaśnij dlaczego i zapytaj ponownie w inny sposób.
Cel: Budowanie intuicji i aktywnego zrozumienia, a nie tylko pasywnej wiedzy.