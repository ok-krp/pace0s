import { pipeline } from "@huggingface/transformers";
import { PHOTO_INSTRUCTIONS, foodAnalysisSchema, type FoodAnalysis } from "./nutrition-ai.shared";

const MODEL_ID = "HuggingFaceTB/SmolVLM-500M-Instruct";
type VisionPipeline = ((input: unknown, options?: Record<string, unknown>) => Promise<Array<{ generated_text?: string }> | { generated_text?: string }>);
let pipelinePromise: Promise<VisionPipeline> | null = null;

function getPipeline() {
  if (!pipelinePromise) {
    pipelinePromise = pipeline("image-text-to-text", MODEL_ID, {
      device: "webgpu",
      dtype: "q4",
    }) as unknown as Promise<VisionPipeline>;
  }
  return pipelinePromise;
}

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\`\`\`\s*$/i, "").trim();
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
  if (!("gpu" in navigator)) throw new Error("WebGPU indisponible dans ce navigateur. Utilise un navigateur recent compatible WebGPU.");

  const model = await getPipeline();
  const imageUrl = URL.createObjectURL(file);
  try {
    const output = await model(
      [{ role: "user", content: [{ type: "image", image: imageUrl }, { type: "text", text: buildPrompt(options?.goal, options?.hint) }] }],
      { max_new_tokens: 700, do_sample: false, return_full_text: false },
    );
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
