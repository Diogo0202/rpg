import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NexusContext, type NexusContextValue } from "./context";
import { NexusContext as StoreContext, useNexus } from "./store";

function CampaignName() {
  const { campaignName } = useNexus();
  return <p>{campaignName}</p>;
}

describe("Nexus context boundary", () => {
  it("keeps the provider and consumers on one stable context export", () => {
    const value = { campaignName: "Campanha mantida pelo provider" } as NexusContextValue;

    expect(StoreContext).toBe(NexusContext);
    render(
      <NexusContext.Provider value={value}>
        <CampaignName />
      </NexusContext.Provider>,
    );

    expect(screen.getByText("Campanha mantida pelo provider")).toBeInTheDocument();
  });
});
