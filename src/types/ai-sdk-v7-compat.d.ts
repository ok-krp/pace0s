declare module "@ai-sdk/react" {
  // AI SDK v5+ removed useChat.onResponse; Pace still uses this callback for debug telemetry.
  // Keep the legacy option accepted without altering the runtime hook implementation.
  export function useChat(options: any): any;
}
