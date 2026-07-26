import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listFoodLog from "./tools/list-food-log";
import addFoodLog from "./tools/add-food-log";
import listHealthSamples from "./tools/list-health-samples";
import getProfile from "./tools/get-profile";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "pace-mcp",
  title: "Pace",
  version: "0.1.0",
  instructions:
    "Tools for the Pace personal-OS app: read the signed-in user's food log and health samples, log new meals, and read their profile. All calls act as the authenticated user via Supabase RLS.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getProfile, listFoodLog, addFoodLog, listHealthSamples],
});
