import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/recipes")({
  beforeLoad: () => { throw redirect({ to: "/nutrition", search: { tab: "recipes" } }); },
});
