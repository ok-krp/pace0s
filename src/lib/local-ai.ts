import { pipeline } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/Qwen3-0.6B-ONNX";
const MODEL_REVISION = "main";
const READY_KEY = "pace.local-ai.ready.v2";
const LOCAL_DEADLINE_MS = 8_500;
const MAX_NEW_TOKENS = 160;

type LocalGeneratedText = string | Array<{ role?: string; content?: string }>;
type LocalTextGenerator = {
  (messages: LocalAiMessage[], options: { max_new_tokens: number; do_sample: boolean }): Promise<Array<{ generated_text?: LocalGeneratedText }>>;
};

export type LocalAiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LocalAiProfile = "fast" | "standard" | "cloud";

let generator: LocalTextGenerator | null = null;
let loading: Promise<LocalTextGenerator> | null = null;

function browserDeviceMemory() {
  const value = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof value === "number" ? value : 4;
}

export function getLocalAiProfile(): LocalAiProfile {
  if (typeof window === "undefined" || !("gpu" in navigator)) return "cloud";
  const cores = navigator.hardwareConcurrency || 2;
  const memory = browserDeviceMemory();
  if (cores >= 8 && memory >= 8) return "fast";
  if (cores >= 4 && memory >= 4) return "standard";
  return "cloud";
}

export function localAiSupported() {
  return getLocalAiProfile() !== "cloud";
}

export function localAiReady() {
  return localAiSupported() && localStorage.getItem(READY_KEY) === "1";
}

async function getGenerator() {
  if (generator) return generator;
  if (!loading) {
    loading = pipeline("text-generation", MODEL_ID, {
      device: "webgpu",
      dtype: "q4f16",
      revision: MODEL_REVISION,
    }) as unknown as Promise<LocalTextGenerator>;
  }
  try {
    generator = await loading;
    localStorage.setItem(READY_KEY, "1");
    return generator;
  } finally {
    loading = null;
  }
}

export function warmLocalAi() {
  if (!localAiSupported()) return Promise.resolve(false);
  return getGenerator().then(() => true).catch(() => {
    localStorage.removeItem(READY_KEY);
    return false;
  });
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise,
    new Promise<T | null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

export async function generateLocalAi(messages: LocalAiMessage[]) {
  if (!localAiSupported()) return null;
  try {
    const pipe = await withDeadline(getGenerator(), LOCAL_DEADLINE_MS);
    if (!pipe) return null;

    const output = await withDeadline(
      pipe(messages, {
        max_new_tokens: MAX_NEW_TOKENS,
        do_sample: false,
      }),
      LOCAL_DEADLINE_MS,
    );
    if (!output) return null;

    const generated = output[0]?.generated_text;
    if (Array.isArray(generated)) {
      const last = generated.at(-1);
      return typeof last?.content === "string" ? last.content.trim() : null;
    }
    return typeof generated === "string" ? generated.trim() : null;
  } catch {
    localStorage.removeItem(READY_KEY);
    return null;
  }
}
