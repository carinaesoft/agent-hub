import { AgentCard } from "@/components/AgentCard";
import { scanAgents } from "@/lib/agent-scanner";

export const dynamic = "force-dynamic";

export default async function Home() {
  const agents = await scanAgents();

  return (
    <main className="min-h-screen bg-[#0a0f0a] font-mono text-[#c9d1d9]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-10">
        <header className="mb-8 rounded-sm border border-[#1b2e1b] bg-[#0d1117] p-5">
          <div className="flex items-center gap-3">
            <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-emerald-500" />
            <h1 className="text-xl tracking-[0.2em]">AGENT HUB</h1>
          </div>
          <p className="mt-2 text-sm text-[#6b7b6b]">
            Command center for autonomous field operations and covert compute missions.
          </p>
        </header>

        {agents.length > 0 ? (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                id={agent.id}
                name={agent.name}
                description={agent.description}
                hasConfig={agent.hasConfig}
              />
            ))}
          </section>
        ) : (
          <section className="rounded-sm border border-[#1b2e1b] bg-[#0d1117] p-6 text-sm text-[#6b7b6b]">
            Brak agentów. Stwórz folder w agents/ z plikiem index.ts
          </section>
        )}

        <footer className="mt-auto pt-8 text-xs uppercase tracking-wider text-[#6b7b6b]">
          centrala // localhost
        </footer>
      </div>
    </main>
  );
}
