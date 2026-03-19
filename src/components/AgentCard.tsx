import Link from "next/link";

interface AgentCardProps {
  id: string;
  name: string;
  description: string;
  hasConfig: boolean;
}

export function AgentCard({ id, name, description, hasConfig }: AgentCardProps) {
  return (
    <Link
      href={`/agent/${encodeURIComponent(id)}`}
      className="group block rounded-sm border border-[#1b2e1b] bg-[#0d1117] p-4 transition hover:shadow-lg hover:shadow-emerald-900/20 hover:border-emerald-500/60"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-sm uppercase tracking-wide text-[#c9d1d9]">{name}</h2>
        <span
          className={`rounded-sm border px-2 py-0.5 text-[10px] font-semibold tracking-wider ${hasConfig
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
            : "border-zinc-500/40 bg-zinc-500/10 text-zinc-400"
            }`}
        >
          {hasConfig ? "CONFIGURED" : "NO CONFIG"}
        </span>
      </div>

      <p className="min-h-10 text-xs leading-relaxed text-[#6b7b6b]">
        {description.length > 0 ? description : "No mission description available."}
      </p>

      <p className="mt-3 text-[11px] uppercase tracking-wider text-cyan-400/90">ID: {id}</p>
    </Link>
  );
}
