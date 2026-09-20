import { pipeline } from "@huggingface/transformers";
import { PHOTO_INSTRUCTIONS, foodAnalysisSchema, type FoodAnalysis } from "./nutrition-ai.shared";

const MODEL_ID = "HuggingFaceTB/SmolVLM-500M-Instruct";
type VisionPipeline = ((input: unknown, options?: Record<string, unknown>) => Promise<Array<{ generated_text?: string }> | { generated_text?: string }>);
let pipelinePromise: Promise<VisionPipeline> | null = null;

type WebGpuNavigator = Navigator & {
  gpu?: {
    requestAdapter: () => Promise<unknown>;
  };
};

async function getPreferredDevice(): Promise<"webgpu" | "wasm"> {
  if (typeof navigator === "undefined") return "wasm";

  const gpu = (navigator as WebGpuNavigator).gpu;
  if (!gpu) return "wasm";

  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

async function createPipeline(device: "webgpu" | "wasm") {
  return pipeline("image-to-text", MODEL_ID, { device, dtype: device === "webgpu" ? "q4f16" : "q8" }) as unknown as VisionPipeline;
}

async function getPipeline() {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const preferred = await getPreferredDevice();
      try {
        return await createPipeline(preferred);
      } catch (error) {
        if (preferred !== "webgpu") throw error;
        return createPipeline("wasm");
      }
    })();
  }
  return pipelinePromise;
}

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("Le modele local n a pas renvoye un JSON exploitable.");
  }
}

function buildPrompt(goal?: string, hint?: string) {
  return [
    PHOTO_INSTRUCTIONS,
    "Analyse cette photo localement. Aucun service distant.",
    "IMPORTANT : retourne uniquement le JSON demande. Aucun markdown.",
    goal ? "Objectif : " + goal + "." : "",
    hint ? "Indice : " + hint + "." : "",
  ].filter(Boolean).join("\n\n");
}

export async function analyzeFoodPhotoLocally(file: File, options?: { goal?: string; hint?: string }): Promise<FoodAnalysis> {
  if (typeof window === "undefined") throw new Error("Analyse locale disponible uniquement dans le navigateur.");

  const model = await getPipeline();
  const imageUrl = URL.createObjectURL(file);
  try {
    const output = await model(imageUrl, {
      max_new_tokens: 700,
      do_sample: false,
      prompt: buildPrompt(options?.goal, options?.hint),
    });
    const item = Array.isArray(output) ? output[0] : output;
    const generated = typeof item?.generated_text === "string" ? item.generated_text : "";
    if (!generated) throw new Error("Le modele local n a produit aucune analyse.");

    const parsed = extractJson(generated);
    const result = foodAnalysisSchema.safeParse(parsed);
    if (!result.success) throw new Error("Le modele local a renvoye une analyse nutritionnelle invalide.");
    return result.data;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}
