import type { UIMessage } from "ai";
import type { UseChatHelpers, UseChatOptions } from "@ai-sdk/react";

declare module "@ai-sdk/react" {
  // Pace still uses the legacy callback for client-side response telemetry.
  export function useChat<UI_MESSAGE extends UIMessage = UIMessage>(
    options?: UseChatOptions<UI_MESSAGE> & { onResponse?: (response: Response) => void },
  ): UseChatHelpers<UI_MESSAGE>;
}
