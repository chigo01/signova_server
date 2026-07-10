import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { SignalService } from "../services/signal.service";

function mockApprovedHistory(items: Array<{ signal: { tradeOutcome?: string } }>) {
  const fetchCalls: string[] = [];
  mock.method(globalThis, "fetch", async (url: string | URL) => {
    fetchCalls.push(url.toString());
    return {
      ok: true,
      json: async () => ({
        success: true,
        items,
        pagination: {
          page: 1,
          limit: 100,
          total: items.length,
          totalPages: 1,
        },
      }),
      text: async () => "",
    } as Response;
  });
  return fetchCalls;
}

test("approved signal win rate counts every take-profit outcome as a win", async () => {
  const fetchCalls = mockApprovedHistory([
    { signal: { tradeOutcome: "TP1_HIT" } },
    { signal: { tradeOutcome: "TP2_HIT" } },
    { signal: { tradeOutcome: "TP_HIT" } },
    { signal: { tradeOutcome: "SL_HIT" } },
    { signal: { tradeOutcome: "PENDING" } },
  ]);

  try {
    const stats = await SignalService.getApprovedSignalsWinRate();

    assert.equal(stats.totalSignals, 5);
    assert.equal(stats.takeProfitHits, 3);
    assert.equal(stats.winRate, 60);
    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0], /\/approved-signals\/history\?/);
  } finally {
    mock.restoreAll();
  }
});
