import { NextResponse } from "next/server";

import { scanAgents } from "@/lib/agent-scanner";
import { getConfig, saveConfig, type AgentConfig } from "@/lib/config-store";

interface AgentRouteContext {
  params: Promise<{ id: string }>;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAgentConfig(value: unknown): value is AgentConfig {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.model === "string" &&
    typeof value.systemPrompt === "string" &&
    typeof value.temperature === "number" &&
    typeof value.maxTokens === "number" &&
    Array.isArray(value.env) &&
    value.env.every((item) => typeof item === "string")
  );
}

async function agentExists(agentId: string): Promise<boolean> {
  const agents = await scanAgents();
  return agents.some((agent) => agent.id === agentId);
}

export async function GET(_: Request, context: AgentRouteContext): Promise<NextResponse> {
  try {
    const { id } = await context.params;

    if (!(await agentExists(id))) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const config = await getConfig(id);
    return NextResponse.json({ id, config });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: Request, context: AgentRouteContext): Promise<NextResponse> {
  try {
    const { id } = await context.params;

    if (!(await agentExists(id))) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const payload = (await request.json()) as unknown;
    if (!isAgentConfig(payload)) {
      return NextResponse.json({ error: "Invalid config payload" }, { status: 400 });
    }

    await saveConfig(id, payload);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
