import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AgentType, AiProvider, AiProviderSource } from "./ai-history.types";

type Client = SupabaseClient<Database>;
type AnyClient = Client & { from: (table: string) => any };
export type AiGateway = (model: string) => any;

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
  custom: "API personnalisée",
};

const DEFAULT_BASE_URLS: Record<Exclude<AiProvider, "custom">, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  openrouter: "https://openrouter.ai/api/v1",
};

const DEFAULT_MODELS: Record<Exclude<AiProvider, "custom">, string> = {
  openai: "gpt-5.4",
  anthropic: "claude-sonnet-4-6",
  gemini: "gemini-3.7-flash",
  openrouter: "openai/gpt-5.4",
};

function encryptionKey() {
  const secret = process.env.PACE_BYOK_ENCRYPTION_KEY;
  if (!secret) throw new Error("BYOK non configuré côté serveur : PACE_BYOK_ENCRYPTION_KEY est manquante.");
  return createHash("sha256").update(secret).digest();
}

function encryptApiKey(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

function decryptApiKey(value: string) {
  const [iv64, tag64, data64] = value.split(".");
  if (!iv64 || !tag64 || !data64) throw new Error("Secret BYOK invalide.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv64, "base64url"));
  decipher.setAuthTag(Buffer.from(tag64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data64, "base64url")), decipher.final()]).toString("utf8");
}

function normalizeBaseUrl(provider: AiProvider, custom?: string | null) {
  const value = provider === "custom" ? custom?.trim() : DEFAULT_BASE_URLS[provider];
  if (!value) throw new Error("URL API personnalisée obligatoire.");
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error("URL API invalide.");
  return value.replace(/\/$/, "");
}

function providerModel(provider: AiProvider, apiKey: string, model: string, baseUrl?: string | null): AiGateway {
  const gateway = createOpenAICompatible({
    name: `pace-byok-${provider}`,
    apiKey,
    baseURL: normalizeBaseUrl(provider, baseUrl),
    includeUsage: true,
    headers: provider === "openrouter" ? { "X-Title": "Pace OS" } : undefined,
  });
  return (selectedModel: string) => gateway(selectedModel || model);
}

export function defaultModel(provider: AiProvider) {
  return provider === "custom" ? "" : DEFAULT_MODELS[provider];
}

export async function getAiRuntimeConfig(client: Client, userId: string, agentType: AgentType) {
  const c = client as AnyClient;
  const { data, error } = await c.from("ai_preferences").select(agentType === "coach"
    ? "coach_ai_source,coach_ai_provider,coach_ai_model,coach_ai_base_url"
    : "build_ai_source,build_ai_provider,build_ai_model,build_ai_base_url").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);

  const prefix = agentType === "coach" ? "coach_ai" : "build_ai";
  const source = (data?.[`${prefix}_source`] ?? "pace") as AiProviderSource;
  const provider = (data?.[`${prefix}_provider`] ?? "gemini") as AiProvider;
  const model = String(data?.[`${prefix}_model`] ?? defaultModel(provider));
  const baseUrl = data?.[`${prefix}_base_url`] ?? null;

  if (source === "pace") {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("L’IA Pace n’est pas configurée sur le serveur.");
    const gateway = createGoogleGenerativeAI({ apiKey: key });
    return { source, provider: "gemini" as AiProvider, model: model || "gemini-2.5-flash", baseUrl: null, gateway: (selected: string) => gateway(selected || model || "gemini-2.5-flash") as any, hasKey: true };
  }

  const { data: secret, error: secretError } = await c.from("ai_provider_secrets").select("encrypted_api_key,key_last4").eq("user_id", userId).eq("provider", provider).maybeSingle();
  if (secretError) throw new Error(secretError.message);
  if (!secret?.encrypted_api_key) throw new Error(`Aucune clé ${PROVIDER_LABELS[provider]} configurée.`);
  const apiKey = decryptApiKey(secret.encrypted_api_key);
  const gateway = providerModel(provider, apiKey, model, baseUrl);
  return { source, provider, model, baseUrl, gateway, hasKey: true, keyLast4: secret.key_last4 as string };
}

export async function saveAiProviderSettings(client: Client, userId: string, input: {
  agentType: AgentType;
  source: AiProviderSource;
  provider: AiProvider;
  model: string;
  baseUrl?: string | null;
  apiKey?: string | null;
}) {
  const c = client as AnyClient;
  const model = input.model.trim() || defaultModel(input.provider);
  if (input.source === "byok") {
    if (!model) throw new Error("Modèle obligatoire.");
    normalizeBaseUrl(input.provider, input.baseUrl);
    if (input.apiKey?.trim()) {
      const secret = input.apiKey.trim();
      if (secret.length < 8) throw new Error("La clé API semble invalide.");
      await c.from("ai_provider_secrets").upsert({
        user_id: userId,
        provider: input.provider,
        encrypted_api_key: encryptApiKey(secret),
        key_last4: secret.slice(-4),
      }, { onConflict: "user_id,provider" });
    }
    const { data: existing } = await c.from("ai_provider_secrets").select("user_id").eq("user_id", userId).eq("provider", input.provider).maybeSingle();
    if (!existing) throw new Error(`Clé ${PROVIDER_LABELS[input.provider]} manquante.`);
  }

  const prefix = input.agentType === "coach" ? "coach_ai" : "build_ai";
  const patch = {
    user_id: userId,
    [`${prefix}_source`]: input.source,
    [`${prefix}_provider`]: input.provider,
    [`${prefix}_model`]: model,
    [`${prefix}_base_url`]: input.provider === "custom" ? normalizeBaseUrl(input.provider, input.baseUrl) : null,
  };
  const { error } = await c.from("ai_preferences").upsert(patch);
  if (error) throw new Error(error.message);
  return { ok: true, source: input.source, provider: input.provider, model };
}

export async function deleteAiProviderKey(client: Client, userId: string, provider: AiProvider) {
  const c = client as AnyClient;
  const { error } = await c.from("ai_provider_secrets").delete().eq("user_id", userId).eq("provider", provider);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function getAiProviderSettings(client: Client, userId: string) {
  const c = client as AnyClient;
  const { data: prefs, error } = await c.from("ai_preferences").select("coach_ai_source,coach_ai_provider,coach_ai_model,coach_ai_base_url,build_ai_source,build_ai_provider,build_ai_model,build_ai_base_url").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  const { data: secrets, error: secretError } = await c.from("ai_provider_secrets").select("provider,key_last4").eq("user_id", userId);
  if (secretError) throw new Error(secretError.message);
  const configured = new Set((secrets ?? []).map((row: { provider: AiProvider }) => row.provider));
  const make = (agentType: AgentType) => {
    const p = agentType === "coach" ? "coach_ai" : "build_ai";
    const provider = (prefs?.[`${p}_provider`] ?? "gemini") as AiProvider;
    return {
      source: (prefs?.[`${p}_source`] ?? "pace") as AiProviderSource,
      provider,
      model: String(prefs?.[`${p}_model`] ?? defaultModel(provider)),
      baseUrl: prefs?.[`${p}_base_url`] ?? "",
      keyConfigured: configured.has(provider),
      keyLast4: (secrets ?? []).find((row: { provider: AiProvider }) => row.provider === provider)?.key_last4 ?? "",
    };
  };
  return { coach: make("coach"), build: make("build"), providers: PROVIDER_LABELS };
}

function providerError(error: unknown) {
  const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 0;
  if (status === 401) return { status: 401, message: "Clé API invalide" };
  if (status === 403) return { status: 403, message: "Cette clé n’a pas les permissions nécessaires" };
  if (status === 404) return { status: 404, message: "Modèle ou endpoint introuvable" };
  if (status === 429) return { status: 429, message: "Limite de requêtes atteinte chez votre fournisseur" };
  if (status >= 500) return { status, message: "Le fournisseur IA est temporairement indisponible" };
  return { status: 0, message: "Impossible de contacter le fournisseur" };
}

export async function testAiProvider(client: Client, userId: string, input: { provider: AiProvider; model: string; baseUrl?: string | null; apiKey?: string | null }) {
  let key = input.apiKey?.trim() || "";
  if (!key) {
    const c = client as AnyClient;
    const { data, error } = await c.from("ai_provider_secrets").select("encrypted_api_key").eq("user_id", userId).eq("provider", input.provider).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.encrypted_api_key) return { ok: false, status: 401, message: "Clé API invalide" };
    key = decryptApiKey(data.encrypted_api_key);
  }
  try {
    const gateway = providerModel(input.provider, key, input.model, input.baseUrl);
    const result = await generateText({ model: gateway(input.model), prompt: "Réponds uniquement par OK." });
    return { ok: Boolean(result.text.trim()), status: 200, message: "Clé valide" };
  } catch (error) {
    return { ok: false, ...providerError(error) };
  }
}

export async function listAiProviderModels(client: Client, userId: string, input: { provider: AiProvider; baseUrl?: string | null; apiKey?: string | null }) {
  let key = input.apiKey?.trim() || "";
  if (!key) {
    const c = client as AnyClient;
    const { data, error } = await c.from("ai_provider_secrets").select("encrypted_api_key").eq("user_id", userId).eq("provider", input.provider).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.encrypted_api_key) throw new Error("Clé API manquante.");
    key = decryptApiKey(data.encrypted_api_key);
  }
  const response = await fetch(`${normalizeBaseUrl(input.provider, input.baseUrl)}/models`, { headers: { Authorization: `Bearer ${key}` } });
  if (!response.ok) throw new Error(providerError({ status: response.status }).message);
  const body = await response.json() as { data?: Array<{ id?: string; name?: string }> };
  return (body.data ?? []).filter((model) => typeof model.id === "string").map((model) => ({ id: model.id!, name: model.name ?? model.id! })).slice(0, 300);
}
