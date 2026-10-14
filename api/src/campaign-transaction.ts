import { chainIdentifier, USDC_ADDRESS } from "@ego/chain";
import { escrowAddress } from "./circle";
import type { Bindings } from "./env";
import type { EventRow, SpotRow } from "./db";

export const launchPhases = ["create", "approve", "fund", "activate"] as const;
export type CampaignAction = "launch" | "pause" | "resume" | "close" | "refund";
export async function campaignTransaction(
  env: Bindings,
  event: EventRow,
  phase: string,
) {
  const id = chainIdentifier(event.id);
  let address = escrowAddress(env);
  let signature: string;
  let parameters: unknown[];
  if (phase === "create") {
    const spots = (
      await env.DB.prepare("SELECT * FROM spot WHERE event_id = ? ORDER BY id")
        .bind(event.id)
        .all<SpotRow>()
    ).results;
    signature =
      "createCampaign(bytes32,uint64,uint64,bytes32[],uint256[],uint32[],address,bool)";
    parameters = [
      id,
      String(Math.floor(event.starts_at / 1000)),
      String(Math.floor(event.ends_at / 1000)),
      spots.map((s) => chainIdentifier(s.id)),
      spots.map((s) => String(s.amount)),
      spots.map((s) => String(s.capacity)),
      event.funding_address,
      !!event.single_claim,
    ];
  } else if (phase === "approve") {
    signature = "approve(address,uint256)";
    parameters = [address, String(event.budget)];
    address = USDC_ADDRESS;
  } else if (phase === "fund") {
    signature = "fund(bytes32,uint256)";
    parameters = [id, String(event.budget)];
  } else if (phase === "pause" || phase === "resume") {
    signature = "setPaused(bytes32,bool)";
    parameters = [id, phase === "pause"];
  } else {
    signature = `${phase}(bytes32)`;
    parameters = [id];
  }
  return { address, signature, parameters };
}
