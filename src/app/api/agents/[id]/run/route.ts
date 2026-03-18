import { scanAgents } from "@/lib/agent-scanner";
import { getConfig } from "@/lib/config-store";
import { runAgent } from "@/lib/agent-runner";

interface AgentRunRouteContext {
  params: Promise<{ id: string }>;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}

function jsonErrorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function agentExists(agentId: string): Promise<boolean> {
  const agents = await scanAgents();
  return agents.some((agent) => agent.id === agentId);
}

export async function GET(_: Request, context: AgentRunRouteContext): Promise<Response> {
  try {
    const { id: agentId } = await context.params;

    if (!(await agentExists(agentId))) {
      return jsonErrorResponse(404, "Agent not found");
    }

    const config = await getConfig(agentId);
    const runnerConfig: Record<string, unknown> = { ...config };
    const encoder = new TextEncoder();
    let isClosed = false;
    let agent: ReturnType<typeof runAgent> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const sendEvent = (event: string, data: unknown): void => {
          if (isClosed) {
            return;
          }

          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        const closeStream = (): void => {
          if (isClosed) {
            return;
          }

          isClosed = true;
          controller.close();
        };

        agent = runAgent({ agentId, config: runnerConfig });

        const logListener = (payload: unknown): void => {
          sendEvent("log", payload);
        };
        const resultListener = (payload: unknown): void => {
          sendEvent("result", payload);
        };
        const doneListener = (payload: unknown): void => {
          sendEvent("done", payload);
          closeStream();
        };
        const errorListener = (payload: unknown): void => {
          sendEvent("error", payload);
          closeStream();
        };

        agent.events.on("log", logListener);
        agent.events.on("result", resultListener);
        agent.events.on("done", doneListener);
        agent.events.on("error", errorListener);
      },
      cancel() {
        isClosed = true;
        agent?.stop();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    return jsonErrorResponse(500, getErrorMessage(error));
  }
}
