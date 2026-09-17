import type { UIMessage } from "ai";

declare module "@ai-sdk/react" {
  interface UseChatOptions<UI_MESSAGE extends UIMessage = UIMessage> {
    onResponse?: (response: Response) => void;
  }
}
