import { describe, expect, it, vi } from "vitest";
import { fetchSheetProbabilities } from "./v5-sheet-probability";

const sheetId = "10000000-0000-4000-8000-000000000001";
const body = {
  without_reroll: { success: 0.5, messy_critical: 0.1, bestial_failure: 0.2 },
  with_reroll: { success: 0.7, messy_critical: 0.15, bestial_failure: 0.1 },
  reroll_limit: 3,
  hunger_dice: 2,
  modifier_preview: {
    base_pool: 5,
    adjusted_pool: 3,
    total_delta: -2,
    applied: [{ id: "condition", label: "Paranoia", delta: -2 }],
  },
};

function options(fetcher: typeof fetch) {
  return {
    baseUrl: "https://api.example.test",
    sheetId,
    pool: 5,
    difficulty: 3,
    willpowerDice: 3,
    contextTags: ["fisico"],
    getAccessToken: vi.fn().mockResolvedValue("jwt"),
    fetcher,
  };
}

describe("sheet probability API", () => {
  it("sends only action inputs and the user token, then reads the modifier preview", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const result = await fetchSheetProbabilities(options(fetcher));
    expect(fetcher).toHaveBeenCalledWith(
      `https://api.example.test/api/v1/v5/sheets/${sheetId}/probabilities`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer jwt" }),
      }),
    );
    const payload = JSON.parse(fetcher.mock.calls[0][1].body as string);
    expect(payload).toEqual({
      pool: 5,
      difficulty: 3,
      willpower_dice: 3,
      context_tags: ["fisico"],
    });
    expect(result.modifier_preview.applied[0].label).toBe("Paranoia");
  });

  it("rejects unsafe destinations before asking for a token", async () => {
    const fetcher = vi.fn();
    const input = options(fetcher);
    input.baseUrl = "http://example.test";
    await expect(fetchSheetProbabilities(input)).rejects.toThrow("HTTPS");
    expect(input.getAccessToken).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects unreadable sheets and malformed responses", async () => {
    await expect(
      fetchSheetProbabilities(
        options(vi.fn().mockResolvedValue(new Response("", { status: 404 }))),
      ),
    ).rejects.toThrow("indisponível");
    await expect(
      fetchSheetProbabilities(
        options(
          vi
            .fn()
            .mockResolvedValue(
              new Response(JSON.stringify({ ...body, hunger_dice: "2" }), { status: 200 }),
            ),
        ),
      ),
    ).rejects.toThrow("inválida");
  });
});
