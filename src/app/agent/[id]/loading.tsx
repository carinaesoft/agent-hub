export default function AgentLoading() {
  return (
    <main className="min-h-screen bg-[#0a0f0a] font-mono text-[#c9d1d9]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-10">
        <section className="rounded-sm border border-[#1b2e1b] bg-[#0d1117] p-5">
          <div className="flex items-center gap-3">
            <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-amber-500" />
            <p className="text-sm uppercase tracking-[0.2em] text-amber-400">
              Loading agent console...
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
