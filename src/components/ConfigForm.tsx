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

type ParamFieldType = "string" | "number" | "boolean" | "json";

interface ParamField {
  key: string;
  type: ParamFieldType;
  valueText: string;
  boolValue: boolean;
}

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

function getParamFieldType(value: unknown): ParamFieldType {
  if (typeof value === "string") {
    return "string";
  }

  if (typeof value === "number") {
    return "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  return "json";
}

function paramsToFields(params: Record<string, unknown>): ParamField[] {
  return Object.entries(params).map(([key, value]) => {
    const type = getParamFieldType(value);

    if (type === "boolean") {
      return {
        key,
        type,
        valueText: "",
        boolValue: value as boolean,
      };
    }

    if (type === "number") {
      return {
        key,
        type,
        valueText: String(value),
        boolValue: false,
      };
    }

    if (type === "json") {
      return {
        key,
        type,
        valueText: JSON.stringify(value, null, 2) ?? "null",
        boolValue: false,
      };
    }

    return {
      key,
      type,
      valueText: value as string,
      boolValue: false,
    };
  });
}

function parseParamsText(paramsText: string): { params: Record<string, unknown> } | { error: string } {
  let parsedParams: unknown;

  try {
    parsedParams = JSON.parse(paramsText);
  } catch {
    return { error: "Invalid JSON in Parameters." };
  }

  if (!isRecord(parsedParams)) {
    return { error: "Parameters must be a JSON object." };
  }

  return { params: parsedParams };
}

function parseParamFields(paramFields: ParamField[]): { params: Record<string, unknown> } | { error: string } {
  const parsedParams: Record<string, unknown> = {};

  for (const field of paramFields) {
    const key = field.key.trim();

    if (key.length === 0) {
      return { error: "Parameter key cannot be empty." };
    }

    if (Object.prototype.hasOwnProperty.call(parsedParams, key)) {
      return { error: `Duplicate parameter key: "${key}".` };
    }

    if (field.type === "string") {
      parsedParams[key] = field.valueText;
      continue;
    }

    if (field.type === "number") {
      if (field.valueText.trim().length === 0) {
        return { error: `Parameter "${key}" must be a valid number.` };
      }

      const parsedNumber = Number(field.valueText);
      if (!Number.isFinite(parsedNumber)) {
        return { error: `Parameter "${key}" must be a valid number.` };
      }

      parsedParams[key] = parsedNumber;
      continue;
    }

    if (field.type === "boolean") {
      parsedParams[key] = field.boolValue;
      continue;
    }

    try {
      parsedParams[key] = JSON.parse(field.valueText);
    } catch {
      return { error: `Parameter "${key}" contains invalid JSON.` };
    }
  }

  return { params: parsedParams };
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
  const [paramFields, setParamFields] = useState<ParamField[]>(() =>
    paramsToFields(initialConfig.params),
  );
  const [isRawParamsView, setIsRawParamsView] = useState(false);
  const [newParamKey, setNewParamKey] = useState("");
  const [newParamValue, setNewParamValue] = useState("");
  const [paramsError, setParamsError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<SaveNotice>(null);

  const handleToggleParamsView = (): void => {
    setParamsError(null);

    if (isRawParamsView) {
      const result = parseParamsText(paramsText);
      if ("error" in result) {
        setParamsError(result.error);
        return;
      }

      setParamFields(paramsToFields(result.params));
      setIsRawParamsView(false);
      return;
    }

    const result = parseParamFields(paramFields);
    if ("error" in result) {
      setParamsError(result.error);
      return;
    }

    setParamsText(JSON.stringify(result.params, null, 2));
    setIsRawParamsView(true);
  };

  const handleAddParameter = (): void => {
    const key = newParamKey.trim();
    setParamsError(null);

    if (key.length === 0) {
      setParamsError("Parameter key is required.");
      return;
    }

    if (paramFields.some((field) => field.key === key)) {
      setParamsError(`Parameter "${key}" already exists.`);
      return;
    }

    setParamFields((currentFields) => [
      ...currentFields,
      {
        key,
        type: "string",
        valueText: newParamValue,
        boolValue: false,
      },
    ]);
    setNewParamKey("");
    setNewParamValue("");
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaveNotice(null);
    setParamsError(null);

    const result = isRawParamsView ? parseParamsText(paramsText) : parseParamFields(paramFields);
    if ("error" in result) {
      setParamsError(result.error);
      return;
    }

    const parsedParams = result.params;
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
      setParamFields(paramsToFields(parsedParams));

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

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs uppercase tracking-wider text-[#6b7b6b]">PARAMETERS</span>
            <button
              type="button"
              onClick={handleToggleParamsView}
              className="rounded-sm border border-[#1b2e1b] bg-black px-2 py-1 text-[11px] uppercase tracking-wider text-[#6b7b6b] transition hover:border-emerald-500/60 hover:text-emerald-400"
            >
              {isRawParamsView ? "Key-Value" : "Raw JSON"}
            </button>
          </div>
          <p className="text-[11px] text-[#6b7b6b]">
            Agent-specific settings — check agent README for available keys
          </p>

          {isRawParamsView ? (
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
          ) : (
            <div className="space-y-3">
              <div className="rounded-sm border border-[#1b2e1b]">
                {paramFields.length === 0 ? (
                  <p className="px-3 py-2 font-mono text-xs text-[#6b7b6b]">No parameters defined.</p>
                ) : (
                  paramFields.map((field, index) => (
                    <div
                      key={`${field.key}-${index}`}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start gap-2 border-b border-[#1b2e1b] px-2 py-1.5 last:border-b-0"
                    >
                      <div className="rounded-sm border border-[#1b2e1b] bg-black px-2 py-1.5 font-mono text-xs text-[#c9d1d9]">
                        {field.key}
                      </div>

                      {field.type === "boolean" ? (
                        <label className="flex items-center gap-2 rounded-sm border border-[#1b2e1b] bg-black px-3 py-2 font-mono text-sm text-[#c9d1d9]">
                          <input
                            type="checkbox"
                            checked={field.boolValue}
                            onChange={(event) => {
                              setParamFields((currentFields) =>
                                currentFields.map((currentField, currentIndex) =>
                                  currentIndex === index
                                    ? { ...currentField, boolValue: event.target.checked }
                                    : currentField,
                                ),
                              );
                            }}
                            className="size-3.5"
                          />
                          <span>{field.boolValue ? "true" : "false"}</span>
                        </label>
                      ) : field.type === "json" ? (
                        <textarea
                          rows={3}
                          value={field.valueText}
                          onChange={(event) => {
                            setParamFields((currentFields) =>
                              currentFields.map((currentField, currentIndex) =>
                                currentIndex === index
                                  ? { ...currentField, valueText: event.target.value }
                                  : currentField,
                              ),
                            );
                            if (paramsError) {
                              setParamsError(null);
                            }
                          }}
                          className="w-full rounded-sm border border-[#1b2e1b] bg-black px-3 py-2 font-mono text-sm text-[#c9d1d9] outline-none transition focus:border-emerald-500/70"
                        />
                      ) : (
                        <input
                          type={field.type === "number" ? "number" : "text"}
                          step={field.type === "number" ? "any" : undefined}
                          value={field.valueText}
                          onChange={(event) => {
                            setParamFields((currentFields) =>
                              currentFields.map((currentField, currentIndex) =>
                                currentIndex === index
                                  ? { ...currentField, valueText: event.target.value }
                                  : currentField,
                              ),
                            );
                            if (paramsError) {
                              setParamsError(null);
                            }
                          }}
                          className="w-full rounded-sm border border-[#1b2e1b] bg-black px-3 py-2 font-mono text-sm text-[#c9d1d9] outline-none transition focus:border-emerald-500/70"
                        />
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
                <input
                  type="text"
                  value={newParamKey}
                  placeholder="new_key"
                  onChange={(event) => setNewParamKey(event.target.value)}
                  className="w-full rounded-sm border border-[#1b2e1b] bg-black px-3 py-2 font-mono text-sm text-[#c9d1d9] outline-none transition focus:border-emerald-500/70"
                />
                <input
                  type="text"
                  value={newParamValue}
                  placeholder="value"
                  onChange={(event) => setNewParamValue(event.target.value)}
                  className="w-full rounded-sm border border-[#1b2e1b] bg-black px-3 py-2 font-mono text-sm text-[#c9d1d9] outline-none transition focus:border-emerald-500/70"
                />
                <button
                  type="button"
                  onClick={handleAddParameter}
                  className="rounded-sm border border-[#1b2e1b] bg-black px-3 py-2 text-xs uppercase tracking-wider text-[#6b7b6b] transition hover:border-emerald-500/60 hover:text-emerald-400"
                >
                  Add Parameter
                </button>
              </div>
            </div>
          )}

          {paramsError ? <p className="text-xs text-red-400">{paramsError}</p> : null}
        </div>

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
