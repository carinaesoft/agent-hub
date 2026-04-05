import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfigForm } from "@/components/ConfigForm";
import { LogViewer } from "@/components/LogViewer";
import { scanAgents } from "@/lib/agent-scanner";
import { getConfig } from "@/lib/config-store";

interface AgentPageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: AgentPageProps) {
  const { id } = await params;
  const agents = await scanAgents();
  const agent = agents.find((candidate) => candidate.id === id);

  if (!agent) {
    notFound();
  }

  const config = await getConfig(id);
  const displayName = config.name.length > 0 ? config.name : agent.name;

  return (
    <main className="min-h-screen bg-[#0a0f0a] font-mono text-[#c9d1d9]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col px-6 py-10">
        <header className="rounded-sm border border-[#1b2e1b] bg-[#0d1117] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-emerald-500" />
              <h1 className="text-xl tracking-[0.2em]">AGENT HUB</h1>
            </div>

            <Link
              href="/"
              className="rounded-sm border border-[#1b2e1b] bg-black px-3 py-1 text-xs uppercase tracking-wider text-[#6b7b6b] transition hover:border-emerald-500/60 hover:text-emerald-400"
            >
              Back to list
            </Link>
          </div>

          <p className="mt-3 text-sm text-[#6b7b6b]">{`Agent briefing: ${displayName} (${id})`}</p>
        </header>

        <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
          <div className="lg:w-[360px]">
            <ConfigForm agentId={id} initialConfig={config} />
          </div>
          <div className="min-w-0">
            <LogViewer agentId={id} />
          </div>
        </section>

        <footer className="mt-auto pt-8 text-xs uppercase tracking-wider text-[#6b7b6b]">
          centrala // localhost
        </footer>
      </div>
    </main>
  );
}
