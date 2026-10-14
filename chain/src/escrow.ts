import { keccak256, stringToHex, parseAbi } from "viem";
export const chainIdentifier = (id: string) => keccak256(stringToHex(id));
export const egoDropsAbi = parseAbi([
  "function createEvent(bytes32 id,uint64 startsAt,uint64 endsAt,bytes32[] spotIds,uint256[] amounts,uint32[] capacities)",
  "function createCampaign(bytes32 id,uint64 startsAt,uint64 endsAt,bytes32[] spotIds,uint256[] amounts,uint32[] capacities,address funder,bool single)",
  "function claimedDrop(bytes32 eventId,bytes32 spotId,bytes32 accountId) view returns (bool)",
  "function fund(bytes32 id,uint256 amount)",
  "function activate(bytes32 id)",
  "function setPaused(bytes32 id,bool paused)",
  "function close(bytes32 id)",
  "function refund(bytes32 id)",
  "function claim(bytes32 eventId,bytes32 spotId,bytes32 accountId,address recipient)",
  "function hasClaimed(bytes32 eventId,bytes32 accountId) view returns (bool)",
  "function events(bytes32 id) view returns (uint64 startsAt,uint64 endsAt,uint256 required,uint256 remaining,address funder,bool active,bool paused,bool closed)",
  "event Claimed(bytes32 indexed eventId,bytes32 indexed spotId,bytes32 indexed accountId,address recipient,uint256 amount)",
]);
