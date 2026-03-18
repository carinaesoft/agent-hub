import { NextResponse } from "next/server";

import { scanAgents } from "@/lib/agent-scanner";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

export async function GET(): Promise<NextResponse> {
  try {
    const agents = await scanAgents();
    return NextResponse.json({ agents });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
