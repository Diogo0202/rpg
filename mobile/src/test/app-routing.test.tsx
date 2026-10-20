import { QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  rootRouteId,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { routeTree } from "@/routeTree.gen";

vi.mock("@/lib/nexus/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nexus/store")>();
  return {
    ...actual,
    NexusProvider: ({ children }: { children: React.ReactNode }) => children,
    useNexus: () => ({
      ready: true,
      error: null,
      engine: null,
      state: null,
      deviceId: null,
      list: () => [],
      get: () => undefined,
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
      wipeLocal: vi.fn(),
    }),
  };
});

vi.mock("@/lib/pwa", () => ({ setupServiceWorker: vi.fn() }));

describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    const matches = router.matchRoutes("/");
    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("renders the Diario child route instead of leaving the Mais page visible", async () => {
    const router = createRouter({
      routeTree,
      context: { queryClient: new QueryClient() },
      history: createMemoryHistory({ initialEntries: ["/mais/diario"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "Diário" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Mais", level: 1 })).not.toBeInTheDocument();
  });
});
