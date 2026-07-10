import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/water")({
  beforeLoad: () => { throw redirect({ to: "/nutrition", search: { tab: "water" } }); },
});
