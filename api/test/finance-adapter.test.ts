import { afterEach, expect, it, vi } from "vitest";
import { parseAbi } from "viem";
import { BridgeKit } from "@circle-fin/bridge-kit";
import { SwapKit } from "@circle-fin/swap-kit";
import { EarnKit } from "@circle-fin/earn-kit";
import {
  financeAdapter,
  listEarnVaults,
  vaultInfo,
  providerQuote,
  earnSummary,
  executeProvider,
  swapPairs,
  bridge,
  destinationChains,
} from "../src/finance-provider";
import type { Bindings } from "../src/env";
const vaultState = vi.hoisted(() => ({
  underlying: "0x3600000000000000000000000000000000000000",
}));
vi.mock("../src/circle", () => ({
  rpc: () => ({
    readContract: async ({ functionName }: { functionName: string }) =>
      functionName === "decimals" ? 18 : vaultState.underlying,
  }),
}));
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

afterEach(() => {
  vi.restoreAllMocks();
  vaultState.underlying = call.address;
});
it("lists Circle-supported Arc USDC vaults as selectable candidates", async () => {
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
      enabled: true,
    }),
  ]);
});

const knownVault = {
  chain: "Arc",
  asset: "USDC",
  assetAddress: call.address,
  vaultAddress: context.address,
  name: "USDC vault",
  protocol: "MORPHO",
  currentApy: 0.03,
  fee: { performance: 0.1, management: null },
  liquidity: "100.123456",
};
it("validates each selected vault through Circle and its onchain underlying", async () => {
  const lookup = vi
    .spyOn(EarnKit.prototype, "getVaults")
    .mockResolvedValue({ vaults: [knownVault] } as never);
  expect((await vaultInfo(env, context.address)).vaultAddress).toBe(
    context.address,
  );
  expect(lookup).toHaveBeenCalledWith(
    expect.objectContaining({
      vaults: [{ chain: "Arc", vaultAddress: context.address }],
    }),
  );
  vaultState.underlying = "0x3333333333333333333333333333333333333333";
  await expect(vaultInfo(env, context.address)).rejects.toMatchObject({
    code: "UNSUPPORTED_VAULT",
  });
});
it("rejects unrecognized, mismatched, other-chain and other-asset vaults", async () => {
  const lookup = vi.spyOn(EarnKit.prototype, "getVaults");
  for (const vaults of [
    [],
    [{ ...knownVault, chain: "Arc_Testnet" }],
    [{ ...knownVault, asset: "EURC" }],
    [
      {
        ...knownVault,
        vaultAddress: "0x3333333333333333333333333333333333333333",
      },
    ],
  ]) {
    lookup.mockResolvedValue({ vaults } as never);
    await expect(vaultInfo(env, context.address)).rejects.toMatchObject({
      code: "UNSUPPORTED_VAULT",
    });
  }
});
it("uses the selected vault in real provider quotes and translates insufficient funds", async () => {
  vi.spyOn(EarnKit.prototype, "getVaults").mockResolvedValue({
    vaults: [knownVault],
  } as never);
  const estimate = vi
    .spyOn(EarnKit.prototype, "getDepositQuote")
    .mockResolvedValue({ fees: [] } as never);
  const input = {
    kind: "earn-deposit" as const,
    asset: "USDC" as const,
    amount: "10000",
    vaultAddress: context.address,
  };
  const result = await providerQuote(
    env,
    { id: "wallet", address: context.address },
    input,
  );
  expect(result.vault?.address).toBe(context.address);
  expect(estimate).toHaveBeenCalledWith(
    expect.objectContaining({ vaultAddress: context.address, amount: "0.01" }),
  );
  estimate.mockRejectedValue({
    code: 1104,
    message: "The wallet does not hold enough tokens for this deposit.",
  });
  await expect(
    providerQuote(env, { id: "wallet", address: context.address }, input),
  ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
});
it("preserves 18-decimal USDC gas fees in swap estimates", async () => {
  vi.spyOn(SwapKit.prototype, "estimate").mockResolvedValue({
    estimatedOutput: { amount: "0.9" },
    stopLimit: { amount: "0.8955" },
    fees: [{ token: "USDC", amount: "0.029202215788550721", type: "gas" }],
  } as never);
  const result = await providerQuote(
    env,
    { id: "wallet", address: context.address },
    { kind: "swap", asset: "USDC", outputAsset: "EURC", amount: "1000000" },
  );
  expect(result.expected).toBe("0.9");
  expect(result.fees[0]).toMatchObject({
    decimals: 18,
    amount: "0.029202215788550721",
  });
  expect(swapPairs()).toHaveLength(6);
});

it("reads the selected vault position with lossless underlying and share precision", async () => {
  vi.spyOn(EarnKit.prototype, "getVaults").mockResolvedValue({
    vaults: [knownVault],
  } as never);
  const position = vi
    .spyOn(EarnKit.prototype, "getPosition")
    .mockResolvedValue({
      currentBalance: "1.123456",
      shares: "0.5",
      pnl: {
        status: "available",
        principalDeposited: "1",
        totalYieldEarned: "0.123456",
      },
    } as never);
  const summary = await earnSummary(
    env,
    { id: "wallet", address: context.address },
    context.address,
  );
  expect(position).toHaveBeenCalledWith(
    expect.objectContaining({ vaultAddress: context.address }),
  );
  expect(summary.position).toEqual({
    value: "1123456",
    shares: "500000000000000000",
    principal: "1000000",
    gain: "123456",
  });
});
it("executes against the reviewed selected vault rather than a configured default", async () => {
  const deposit = vi
    .spyOn(EarnKit.prototype, "deposit")
    .mockResolvedValue({ txHash: `0x${"aa".repeat(32)}` } as never);
  await executeProvider(
    env,
    { id: "wallet", address: context.address },
    {
      kind: "earn-deposit",
      asset: "USDC",
      amount: "10000",
      vaultAddress: context.address,
    },
    "0.01",
    undefined,
    null,
    vi.fn(),
  );
  expect(deposit).toHaveBeenCalledWith(
    expect.objectContaining({ vaultAddress: context.address, amount: "0.01" }),
  );
});

it("discovers only provider-confirmed mainnet routes with destination forwarding", async () => {
  const check = vi
    .spyOn(bridge().providers[0], "supportsRoute")
    .mockImplementation(
      (source, destination, asset, forwarder) =>
        source.chain === "Arc" &&
        destination.chain === "Base" &&
        asset === "USDC" &&
        forwarder === true,
    );
  vi.spyOn(bridge().providers[1], "supportsRoute").mockResolvedValue(false);
  const destinations = await destinationChains();
  expect(destinations.map(({ id, assets }) => ({ id, assets }))).toEqual([
    { id: "Base", assets: ["USDC"] },
  ]);
  expect(check).toHaveBeenCalledWith(
    expect.objectContaining({ chain: "Arc", isTestnet: false }),
    expect.objectContaining({ chain: "Base", isTestnet: false }),
    "USDC",
    true,
  );
});

it("requires a destination transaction for relayer-delivered token withdrawals", async () => {
  const mocked = vi.spyOn(bridge(), "bridge").mockResolvedValue({
    state: "success",
    steps: [
      { name: "forward", state: "success", txHash: `0x${"aa".repeat(32)}` },
    ],
  } as never);
  const input = {
    kind: "withdraw" as const,
    asset: "EURC" as const,
    amount: "1000000",
    destination: "Ethereum",
    recipient: context.address,
  };
  const result = await executeProvider(
    env,
    { id: "wallet", address: context.address },
    input,
    "0.9999",
    undefined,
    null,
    vi.fn(),
  );
  expect(result.complete).toBe(true);
  mocked.mockResolvedValue({
    state: "success",
    steps: [{ name: "forward", state: "success" }],
  } as never);
  expect(
    (
      await executeProvider(
        env,
        { id: "wallet", address: context.address },
        input,
        "0.9999",
        undefined,
        null,
        vi.fn(),
      )
    ).complete,
  ).toBe(false);
});
