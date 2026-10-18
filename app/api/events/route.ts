// Server-Sent Events: alert, alert_ack, call, client_status, crisis. Heartbeat comment every 20 seconds.
import { subscribe } from "@/lib/events";

const HEARTBEAT_MS = 20 * 1000;

export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      send(": connected\n\n");
      const unsubscribe = subscribe((type, data) => send(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      const timer = setInterval(() => send(": heartbeat\n\n"), HEARTBEAT_MS);
      cleanup = () => {
        clearInterval(timer);
        unsubscribe();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
