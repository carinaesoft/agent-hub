"use client";

import { useState } from "react";

import type { AgentConfig } from "@/lib/config-store";

interface ConfigFormProps {
  agentId: string;
  initialConfig: AgentConfig;
}

type SaveNotice =
  | {
    kind: "success" | "error";
    message: string;
  }
  | null;

const MODEL_OPTIONS = [
  "minimax/minimax-m2.7",
  "gpt-4o-mini",
  "gpt-4.1-mini",
  "openai/gpt-5.4-mini",
  "anthropic/claude-sonnet-4.6",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function getResponseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as unknown;
    if (isRecord(payload) && typeof payload.error === "string") {
      return payload.error;
    }
  } catch {
    return `Request failed with status ${response.status}`;
  }

  return `Request failed with status ${response.status}`;
}

export function ConfigForm({ agentId, initialConfig }: ConfigFormProps) {
  const [config, setConfig] = useState<AgentConfig>(initialConfig);
  const [paramsText, setParamsText] = useState<string>(() =>
    JSON.stringify(initialConfig.params, null, 2),
  );
  const [paramsError, setParamsError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<SaveNotice>(null);

  const handleSave = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaveNotice(null);
    setParamsError(null);

    let parsedParams: unknown;
    try {
      parsedParams = JSON.parse(paramsText);
    } catch {
      setParamsError("Invalid JSON in Agent Parameters.");
      return;
    }

    if (!isRecord(parsedParams)) {
      setParamsError("Agent Parameters must be a JSON object.");
      return;
    }

    setIsSaving(true);

    try {
      const payload: AgentConfig = { ...config, params: parsedParams };
      const response = await fetch(`/api/agents/${agentId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await getResponseError(response));
      }

      setConfig(payload);
      setParamsText(JSON.stringify(parsedParams, null, 2));

      setSaveNotice({
        kind: "success",
        message: "Configuration saved.",
      });
    } catch (error: unknown) {
      setSaveNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to save configuration.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="rounded-sm border border-[#1b2e1b] bg-[#0d1117] p-5">
      <h2 className="text-sm tracking-[0.16em] text-[#c9d1d9]">CONFIGURATION</h2>

      <form className="mt-4 space-y-4" onSubmit={handleSave}>
        <label className="block space-y-2">
          <span className="text-xs uppercase tracking-wider text-[#6b7b6b]">Model</span>
          <select
            value={config.model}
            onChange={(event) =>
              setConfig((currentConfig) => ({ ...currentConfig, model: event.target.value }))
            }
            className="w-full rounded-sm border border-[#1b2e1b] bg-black px-3 py-2 text-sm text-[#c9d1d9] outline-none transition focus:border-emerald-500/70"
          >
            {MODEL_OPTIONS.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-2">
          <span className="text-xs uppercase tracking-wider text-[#6b7b6b]">System prompt</span>
          <textarea
            rows={4}
            value={config.systemPrompt}
            onChange={(event) =>
              setConfig((currentConfig) => ({
                ...currentConfig,
                systemPrompt: event.target.value,
              }))
            }
            className="w-full rounded-sm border border-[#1b2e1b] bg-black px-3 py-2 text-sm text-[#c9d1d9] outline-none transition focus:border-emerald-500/70"
          />
        </label>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="block space-y-2">
            <span className="text-xs uppercase tracking-wider text-[#6b7b6b]">Temperature</span>
            <input
              type="number"
              step="0.1"
              min={0}
              max={2}
              value={config.temperature}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (Number.isNaN(parsed)) {
                  return;
                }

                setConfig((currentConfig) => ({ ...currentConfig, temperature: parsed }));
              }}
              className="w-full rounded-sm border border-[#1b2e1b] bg-black px-3 py-2 text-sm text-[#c9d1d9] outline-none transition focus:border-emerald-500/70"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-xs uppercase tracking-wider text-[#6b7b6b]">Max tokens</span>
            <input
              type="number"
              step={256}
              min={256}
              max={16384}
              value={config.maxTokens}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (Number.isNaN(parsed)) {
                  return;
                }

                setConfig((currentConfig) => ({ ...currentConfig, maxTokens: parsed }));
              }}
              className="w-full rounded-sm border border-[#1b2e1b] bg-black px-3 py-2 text-sm text-[#c9d1d9] outline-none transition focus:border-emerald-500/70"
            />
          </label>
        </div>

        <label className="block space-y-2">
          <span className="text-xs uppercase tracking-wider text-[#6b7b6b]">
            Agent Parameters (JSON)
          </span>
          <p className="text-[11px] text-[#6b7b6b]">
            Agent-specific settings — check agent README for available keys
          </p>
          <textarea
            rows={8}
            value={paramsText}
            onChange={(event) => {
              setParamsText(event.target.value);
              if (paramsError) {
                setParamsError(null);
              }
            }}
            className="w-full rounded-sm border border-[#1b2e1b] bg-black px-3 py-2 font-mono text-sm text-[#c9d1d9] outline-none transition focus:border-emerald-500/70"
          />
          {paramsError ? <p className="text-xs text-red-400">{paramsError}</p> : null}
        </label>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-sm border border-emerald-500/60 bg-emerald-500/20 px-4 py-2 text-xs uppercase tracking-[0.14em] text-emerald-300 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>

          {saveNotice ? (
            <p
              className={`text-xs ${saveNotice.kind === "success" ? "text-emerald-400" : "text-red-400"
                }`}
            >
              {saveNotice.message}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
