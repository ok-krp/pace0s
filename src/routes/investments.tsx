import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/investments")({
  beforeLoad: () => { throw redirect({ to: "/finance", search: { tab: "investments" } }); },
});
