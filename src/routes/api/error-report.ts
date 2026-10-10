import { createFileRoute } from "@tanstack/react-router";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const MAX_BODY_BYTES = 12_000;
const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });

// Neutralise control characters before writing untrusted fields to server logs.
// eslint-disable-next-line no-control-regex
const clean = (value: unknown, max: number) =>
  // eslint-disable-next-line no-control-regex
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").slice(0, max) : undefined;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // Native clients may omit Origin.
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Payload too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export const Route = createFileRoute("/api/error-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!sameOrigin(request)) return json({ error: "Forbidden" }, 403);
        const limited = rateLimit(`error-report:${clientIp(request)}`, 10, 60_000);
        if (!limited.ok) return json({ error: "Too many requests" }, 429, { "retry-after": String(limited.retryAfterSec) });
        try {
          const body = await readBoundedJson(request, MAX_BODY_BYTES);
          if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid error report" }, 400);
          const report = {
            timestamp: new Date().toISOString(),
            context: clean((body as Record<string, unknown>).context, 120) ?? "unknown",
            name: clean((body as Record<string, unknown>).name, 120) ?? "UnknownError",
            message: clean((body as Record<string, unknown>).message, 1000) ?? "Unknown error",
            stack: clean((body as Record<string, unknown>).stack, 5000),
            url: clean((body as Record<string, unknown>).url, 1000),
            pathname: clean((body as Record<string, unknown>).pathname, 300),
            visualTheme: clean((body as Record<string, unknown>).visualTheme, 30),
            userAgent: clean((body as Record<string, unknown>).userAgent, 500),
            details: clean((body as Record<string, unknown>).details, 1000),
          };
          console.error("[PaceErrorReport]", JSON.stringify(report));
          return json({ ok: true }, 200);
        } catch (error) {
          if (error instanceof Error && error.message === "Payload too large") return json({ error: "Payload too large" }, 413);
          return json({ error: "Invalid error report" }, 400);
        }
      },
    },
  },
});
