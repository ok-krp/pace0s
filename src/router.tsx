import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { Route as WatchRouteImport } from "./routes/watch";

// Register Watch directly on the generated root tree. This avoids relying on a stale
// generated route tree while keeping the route compatible with TanStack Router.
const WatchRoute = WatchRouteImport.update({
  id: "/watch",
  path: "/watch",
  getParentRoute: () => routeTree as any,
} as any);

const runtimeRouteTree = (routeTree as any).addChildren([WatchRoute]);

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree: runtimeRouteTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
