import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.paceos.app",
  appName: "PaceOS",
  webDir: ".output/public",
  android: {
    allowMixedContent: false,
  },
};

export default config;
