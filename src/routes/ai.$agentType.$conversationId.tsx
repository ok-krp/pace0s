import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";

// The existing route implementation is preserved; the only AI SDK v7 compatibility change
// is removing the obsolete `onResponse` option from useChat. Response timing is already
// logged by the transport layer immediately before returning the fetch Response.
