import { createFileRoute } from "@tanstack/react-router";

const MAX_BODY_BYTES = 12_000;

export const Route = createFileRoute("/api/error-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const contentLength = Number(request.headers.get("content-length") || 0);
          if (contentLength > MAX_BODY_BYTES) {
            return new Response(JSON.stringify({ error: "Payload too large" }), { status: 413, headers: { "content-type": "application/json" } });
          }

          const body = await request.json();
          const report = {
            timestamp: typeof body?.timestamp === "string" ? body.timestamp : new Date().toISOString(),
            context: typeof body?.context === "string" ? body.context.slice(0, 120) : "unknown",
            name: typeof body?.name === "string" ? body.name.slice(0, 120) : "UnknownError",
            message: typeof body?.message === "string" ? body.message.slice(0, 1000) : "Unknown error",
            stack: typeof body?.stack === "string" ? body.stack.slice(0, 5000) : undefined,
            url: typeof body?.url === "string" ? body.url.slice(0, 1000) : undefined,
            pathname: typeof body?.pathname === "string" ? body.pathname.slice(0, 300) : undefined,
            visualTheme: typeof body?.visualTheme === "string" ? body.visualTheme.slice(0, 30) : undefined,
            userAgent: typeof body?.userAgent === "string" ? body.userAgent.slice(0, 500) : undefined,
            details: typeof body?.details === "string" ? body.details.slice(0, 1000) : undefined,
          };

          console.error("[PaceErrorReport]", JSON.stringify(report));
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
        } catch (error) {
          console.error("[PaceErrorReport] invalid request", error);
          return new Response(JSON.stringify({ error: "Invalid error report" }), { status: 400, headers: { "content-type": "application/json" } });
        }
      },
    },
  },
});
