import { simulateThrow } from "./simulate.ts";
import type { SimulateReply, SimulateRequest } from "./simulate-client.ts";

/** Runs the physics of a throw off the main thread, so the page keeps painting while it computes. */
self.onmessage = (event: MessageEvent<SimulateRequest>) => {
  const { id, requests, seed, aim } = event.data;
  let reply: SimulateReply;
  try {
    reply = { id, thrown: simulateThrow(requests, seed, aim) };
  } catch (error) {
    reply = { id, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(reply);
};
