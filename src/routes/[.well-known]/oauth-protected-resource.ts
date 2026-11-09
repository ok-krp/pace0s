import { createFileRoute } from "@tanstack/react-router";
import { oauthProtectedResourceMetadata } from "../../lib/mcp/server";

export const Route = createFileRoute("/.well-known/oauth-protected-resource")({
  server: {
    handlers: {
      GET: ({ request }) => oauthProtectedResourceMetadata(request),
      HEAD: ({ request }) => {
        const response = oauthProtectedResourceMetadata(request);
        return new Response(null, { status: response.status, headers: response.headers });
      },
      OPTIONS: () => new Response(null, {
        status: 204,
        headers: {
          allow: "GET, HEAD, OPTIONS",
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, HEAD, OPTIONS",
          "access-control-allow-headers": "content-type, authorization",
        },
      }),
    },
  },
});
