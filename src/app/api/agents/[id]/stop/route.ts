import { NextResponse } from "next/server";

import { stopAgent } from "@/lib/agent-runner";

interface StopRouteContext {
  params: Promise<{ id: string }>;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

export async function POST(_: Request, context: StopRouteContext): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const wasStopped = stopAgent(id);

    if (wasStopped) {
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Agent is not running" }, { status: 404 });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
