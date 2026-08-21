import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/** Legacy provider retained for nutrition photo/advice features. Coach/BUILD BYOK never use this gateway. */
export const createLovableAiGatewayProvider = (lovableApiKey: string) =>
  createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: {
      "Lovable-API-Key": lovableApiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
  });
