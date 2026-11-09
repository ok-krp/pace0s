import { createFileRoute } from "@tanstack/react-router";
import { handleMcpRequest } from "../lib/mcp/server";

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      ANY: ({ request }) => handleMcpRequest(request),
    },
  },
});
