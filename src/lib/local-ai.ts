import { pipeline } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/Qwen3-0.6B-ONNX";
const MODEL_REVISION = "main";
const READY_KEY = "pace.local-ai.ready.v2";
const LOCAL_ENABLED_KEY = "pace.ai.local.enabled";
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

function hardwareProfile(): Exclude<LocalAiProfile, "cloud"> | "cloud" {
  if (typeof window === "undefined" || !("gpu" in navigator)) return "cloud";
  const cores = navigator.hardwareConcurrency || 2;
  const memory = browserDeviceMemory();
  if (cores >= 8 && memory >= 8) return "fast";
  if (cores >= 4 && memory >= 4) return "standard";
  return "cloud";
}

export function getLocalAiProfile(): LocalAiProfile {
  if (typeof window === "undefined") return "cloud";
  if (localStorage.getItem(LOCAL_ENABLED_KEY) !== "1") return "cloud";
  return hardwareProfile();
}

export function localAiSupported() {
  return hardwareProfile() !== "cloud";
}

export function setLocalAiEnabled(enabled: boolean) {
  if (enabled) localStorage.setItem(LOCAL_ENABLED_KEY, "1");
  else {
    localStorage.removeItem(LOCAL_ENABLED_KEY);
    localStorage.removeItem(READY_KEY);
  }
}

export function localAiReady() {
  return getLocalAiProfile() !== "cloud" && localStorage.getItem(READY_KEY) === "1";
}

async function getGenerator() {
  if (generator) return generator;
  if (!localAiSupported()) return null;
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
  if (getLocalAiProfile() === "cloud") return Promise.resolve(false);
  return getGenerator().then((value) => value !== null).catch(() => {
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
  if (getLocalAiProfile() === "cloud") return null;
  const startedAt = performance.now();
  try {
    const remaining = () => Math.max(0, LOCAL_DEADLINE_MS - (performance.now() - startedAt));
    const pipe = await withDeadline(getGenerator(), remaining());
    if (!pipe) return null;

    const generationBudget = remaining();
    if (generationBudget <= 0) return null;
    const output = await withDeadline(
      pipe(messages, {
        max_new_tokens: MAX_NEW_TOKENS,
        do_sample: false,
      }),
      generationBudget,
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
