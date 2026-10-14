import { afterEach, expect, it, vi } from "vitest";
import { parseAbi } from "viem";
import { BridgeKit } from "@circle-fin/bridge-kit";
import { EarnKit } from "@circle-fin/earn-kit";
import { financeAdapter, listEarnVaults } from "../src/finance-provider";
import type { Bindings } from "../src/env";
const env = {
  CIRCLE_API_KEY: "unconfigured",
  CIRCLE_ENTITY_SECRET: "00".repeat(32),
} as Bindings;
const context = {
  chain: "Arc" as const,
  address: "0x2222222222222222222222222222222222222222",
};
const call = {
  address: "0x3600000000000000000000000000000000000000" as const,
  abi: parseAbi([
    "function transfer(address recipient,uint256 amount) returns(bool success)",
  ]),
  functionName: "transfer" as const,
  args: ["0x3333333333333333333333333333333333333333", 1n],
};
it("prepares real SDK calldata but blocks execution without a persisted executor", async () => {
  const request = await financeAdapter(env).prepare(call, context);
  expect(request.type).toBe("evm");
  await expect(request.execute()).rejects.toMatchObject({
    code: "FINANCE_UNAVAILABLE",
  });
});
it("routes real SDK prepared calls exclusively through the provided executor", async () => {
  const execute = vi.fn(async () => `0x${"aa".repeat(32)}`);
  const adapter = financeAdapter(env, execute);
  const prepared = await adapter.prepare(call, context);
  expect(await prepared.execute()).toBe(`0x${"aa".repeat(32)}`);
  expect(execute).toHaveBeenCalledExactlyOnceWith({
    to: call.address,
    data: expect.stringMatching(/^0xa9059cbb/),
    value: "0",
  });
  expect(await adapter.supportsAtomicBatch({} as never)).toBe(false);
  await expect(
    adapter.batchExecute([], {} as never, {
      fromAddress: context.address as `0x${string}`,
    }),
  ).rejects.toMatchObject({ code: "FINANCE_UNAVAILABLE" });
});
it("uses SDK mainnet definitions for Arc Earn and forwarded withdrawal destinations", () => {
  const arc = new EarnKit()
    .getSupportedChains()
    .find((chain) => chain.chain === "Arc");
  expect(arc).toMatchObject({ isTestnet: false, chainId: 5042 });
  expect(
    new BridgeKit()
      .getSupportedChains({ isTestnet: false })
      .some(
        (chain) =>
          chain.chain === "Base" && chain.cctp?.forwarderSupported?.destination,
      ),
  ).toBe(true);
});

afterEach(() => vi.restoreAllMocks());
it("lists only real Arc USDC vaults without enabling discovery results for deposits", async () => {
  const vault = {
    chain: "Arc",
    asset: "USDC",
    assetAddress: call.address,
    vaultAddress: context.address,
    name: "Provider USDC",
    protocol: "Provider",
    currentApy: 0.03,
    fee: { performance: 0.1, management: null },
    liquidity: "123.456789",
  };
  const explore = vi
    .spyOn(EarnKit.prototype, "exploreVaults")
    .mockResolvedValue({
      vaults: [
        vault,
        { ...vault, chain: "Arc_Testnet" },
        { ...vault, assetAddress: context.address },
      ],
      pagination: { totalPages: 2 },
    } as never);
  const result = await listEarnVaults(env, 1);
  expect(explore).toHaveBeenCalledWith(
    expect.objectContaining({ chain: "Arc", page: 1, pageSize: 100 }),
  );
  expect(result.hasMore).toBe(true);
  expect(result.vaults).toEqual([
    expect.objectContaining({
      address: context.address,
      liquidity: "123456789",
      decimals: 6,
      performanceFee: 0.1,
      managementFee: null,
      enabled: false,
    }),
  ]);
});
