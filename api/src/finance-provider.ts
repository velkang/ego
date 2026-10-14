import { BridgeKit, type BridgeResult } from "@circle-fin/bridge-kit";
import { SwapKit } from "@circle-fin/swap-kit";
import { EarnKit } from "@circle-fin/earn-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import {
  isAddress,
  parseAbi,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import {
  assetAmount,
  assetDefinition,
  assetUnits,
  walletAssets,
  type AssetBalance,
  type FinanceCapabilities,
  type FinanceRequest,
  type EarnSummary,
  type EarnVaultList,
  type FinanceFee,
} from "@ego/chain";
import type { Bindings } from "./env";
import { rpc } from "./circle";
import { ApiError } from "./http";

export const tokenAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
let bridgeKit: BridgeKit | undefined;
export const bridge = () =>
  (bridgeKit ||= new BridgeKit({ disableErrorReporting: true }));
export const earn = () =>
  new EarnKit({ disableAnalytics: true, disableErrorReporting: true });
export const swap = () =>
  new SwapKit({ disableAnalytics: true, disableErrorReporting: true });
export type PreparedCall = { to: Hex; data: Hex; value: string };
export type Wallet = { id: string; address: string };
export type Executor = (call: PreparedCall) => Promise<string>;
export function financeJson(value: unknown) {
  return JSON.stringify(value, (key, item) => {
    if (
      [
        "apiKey",
        "kitKey",
        "entitySecret",
        "headers",
        "cause",
        "error",
      ].includes(key)
    )
      return undefined;
    return typeof item === "bigint" ? item.toString() : item;
  });
}
// The SDK prepares calls, but only our persisted executor may broadcast them.
// Wrap both entry points: providers use prepareAction and direct prepare.
export function financeAdapter(env: Bindings, execute?: Executor) {
  const adapter = createCircleWalletsAdapter({
    apiKey: env.CIRCLE_API_KEY,
    entitySecret: env.CIRCLE_ENTITY_SECRET,
  });
  const prepare = adapter.prepare.bind(adapter);
  const action = adapter.prepareAction.bind(adapter);
  type Prepared = Awaited<ReturnType<typeof prepare>>;
  const wrap = (request: Prepared): Prepared => {
    if (request.type !== "evm") throw new ApiError("FINANCE_UNAVAILABLE", 503);
    return {
      ...request,
      execute: async () => {
        if (!execute || !request.getCallData)
          throw new ApiError("FINANCE_UNAVAILABLE", 503);
        const call = request.getCallData();
        return execute({
          to: call.to,
          data: call.data,
          value: (call.value || 0n).toString(),
        });
      },
    };
  };
  adapter.prepare = async (...args) => wrap(await prepare(...args));
  adapter.prepareAction = async (...args) => wrap(await action(...args));
  adapter.supportsAtomicBatch = async () => false;
  adapter.batchExecute = async () => {
    throw new ApiError("FINANCE_UNAVAILABLE", 503);
  };
  return adapter;
}
const verifiedTokens = new Map<string, number>();
const tokenChecks = new Map<string, Promise<void>>();
export async function verifyAssets(env: Bindings) {
  const key = env.ARC_RPC_URL || "default";
  if ((verifiedTokens.get(key) || 0) > Date.now()) return;
  const existing = tokenChecks.get(key);
  if (existing) return existing;
  const check = (async () => {
    const client = rpc(env);
    if ((await client.getChainId()) !== 5042)
      throw new ApiError("FINANCE_UNAVAILABLE", 503);
    await Promise.all(
      walletAssets.map(async (asset) => {
        const decimals = await client.readContract({
          address: asset.address,
          abi: tokenAbi,
          functionName: "decimals",
        });
        const symbol = await client.readContract({
          address: asset.address,
          abi: tokenAbi,
          functionName: "symbol",
        });
        if (
          decimals !== asset.decimals ||
          symbol.toLowerCase() !== asset.symbol.toLowerCase()
        )
          throw new ApiError("FINANCE_UNAVAILABLE", 503);
      }),
    );
    verifiedTokens.set(key, Date.now() + 300_000);
  })();
  tokenChecks.set(key, check);
  try {
    await check;
  } finally {
    tokenChecks.delete(key);
  }
}
export async function extraBalances(
  env: Bindings,
  address: string,
  usdc: string | null,
): Promise<AssetBalance[]> {
  const result: AssetBalance[] = [{ symbol: "USDC", decimals: 6, units: usdc }];
  for (const asset of walletAssets.slice(1)) {
    let units: string | null = null;
    try {
      await verifyAssets(env);
      units = (
        await rpc(env).readContract({
          address: asset.address,
          abi: tokenAbi,
          functionName: "balanceOf",
          args: [address as Address],
        })
      ).toString();
    } catch {
      /* Preserve an unavailable asset instead of fabricating zero. */
    }
    result.push({ symbol: asset.symbol, decimals: asset.decimals, units });
  }
  return result;
}
export async function destinationChains() {
  const kit = bridge();
  const chains = kit.getSupportedChains({ isTestnet: false });
  const source = chains.find((c) => c.chain === "Arc");
  if (!source) return [];
  const destinations = await Promise.all(
    chains
      .filter((c) => c.chain !== "Arc" && ["evm", "solana"].includes(c.type))
      .map(async (c) => {
        const assets: ("USDC" | "EURC")[] = [];
        for (const asset of ["USDC", "EURC"] as const) {
          if (!(asset === "USDC" ? c.usdcAddress : c.eurcAddress)) continue;
          if (asset === "USDC" && !c.cctp?.forwarderSupported?.destination)
            continue;
          try {
            const supported =
              asset === "USDC"
                ? await kit.providers[0].supportsRoute(source, c, asset, true)
                : await kit.providers[1].supportsRoute(source, c, asset, true);
            if (supported) assets.push(asset);
          } catch {
            /* Do not advertise a route whose support cannot be established. */
          }
        }
        return {
          definition: c,
          id: c.chain,
          name: c.name,
          type: c.type,
          assets,
        };
      }),
  );
  return destinations.filter((c) => c.assets.length);
}
export function swapPairs() {
  const supported = swap()
    .getSupportedChains()
    .some(
      (chain) =>
        chain.chain === "Arc" &&
        !chain.isTestnet &&
        chain.type === "evm" &&
        chain.chainId === 5042,
    );
  if (!supported) return [];
  return walletAssets.flatMap((from) =>
    walletAssets
      .filter((to) => to.symbol !== from.symbol)
      .map((to) => ({ from: from.symbol, to: to.symbol })),
  );
}
export async function capabilities(
  env: Bindings,
): Promise<FinanceCapabilities> {
  const empty = {
    swap: false,
    swapPairs: [],
    earn: false,
    earnDiscovery: true,
    withdraw: false,
    assets: walletAssets,
    destinations: [],
  };
  try {
    await verifyAssets(env);
  } catch {
    return empty;
  }
  const destinations = (await destinationChains()).map(
    ({ definition: _, ...route }) => route,
  );
  const earnReady = earn()
    .getSupportedChains()
    .some((chain) => chain.chain === "Arc" && !chain.isTestnet);
  return {
    swap: swapPairs().length > 0,
    swapPairs: swapPairs(),
    earn: earnReady,
    earnDiscovery: true,
    withdraw: destinations.length > 0,
    assets: walletAssets,
    destinations,
  };
}
export function validRecipient(address: string, type: string) {
  if (type === "evm") return isAddress(address) && !/^0x0{40}$/i.test(address);
  if (type !== "solana" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))
    return false;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const char of address)
    value = value * 58n + BigInt(alphabet.indexOf(char));
  const bytes = value === 0n ? 0 : Math.ceil(value.toString(2).length / 8);
  return bytes + (address.match(/^1*/)?.[0].length || 0) === 32 && value !== 0n;
}
export async function vaultInfo(
  env: Bindings,
  address = env.EARN_VAULT_ADDRESS,
) {
  if (!address || !isAddress(address))
    throw new ApiError("UNSUPPORTED_VAULT", 409);
  const result = await earn().getVaults({
    vaults: [{ chain: "Arc", vaultAddress: address }],
    config: { apiKey: env.CIRCLE_API_KEY },
  });
  const vault = result.vaults[0];
  if (
    !vault ||
    vault.chain !== "Arc" ||
    vault.vaultAddress.toLowerCase() !== address.toLowerCase()
  )
    throw new ApiError("UNSUPPORTED_VAULT", 409);
  const asset = vault.asset;
  if (
    vault.assetAddress.toLowerCase() !==
      walletAssets[0].address.toLowerCase() ||
    asset !== "USDC"
  )
    throw new ApiError("UNSUPPORTED_VAULT", 409);
  const underlying = await rpc(env).readContract({
    address: vault.vaultAddress as Address,
    abi: parseAbi(["function asset() view returns(address)"]),
    functionName: "asset",
  });
  if (underlying.toLowerCase() !== walletAssets[0].address.toLowerCase())
    throw new ApiError("UNSUPPORTED_VAULT", 409);
  return vault;
}
export async function earnSummary(
  env: Bindings,
  wallet: Wallet,
  address?: string,
): Promise<EarnSummary> {
  const vault = await vaultInfo(env, address);
  const position = await earn().getPosition({
    from: {
      adapter: financeAdapter(env),
      chain: "Arc",
      address: wallet.address,
    },
    vaultAddress: vault.vaultAddress,
    config: { apiKey: env.CIRCLE_API_KEY },
  });
  const pnl = position.pnl;
  const shareDecimals = await rpc(env).readContract({
    address: vault.vaultAddress as Address,
    abi: tokenAbi,
    functionName: "decimals",
  });
  const raw = (amount: string, decimals = 6) =>
    amount.startsWith("-")
      ? `-${assetUnits(amount.slice(1), decimals)}`
      : assetUnits(amount, decimals);
  return {
    assetDecimals: 6,
    shareDecimals,
    vault: {
      address: vault.vaultAddress,
      name: vault.name,
      provider: vault.protocol,
      apy: vault.currentApy,
      fees: `Performance fee: ${vault.fee.performance === null ? "Unavailable" : `${(vault.fee.performance * 100).toFixed(2)}% of returns`}. Annual management fee: ${vault.fee.management === null ? "Not specified" : `${(vault.fee.management * 100).toFixed(2)}%`}. Included in position value.`,
      liquidity: raw(vault.liquidity),
    },
    position: {
      value: raw(position.currentBalance),
      shares: raw(position.shares, shareDecimals),
      principal:
        pnl.status === "available" ? raw(pnl.principalDeposited) : null,
      gain: pnl.status === "available" ? raw(pnl.totalYieldEarned) : null,
    },
  };
}
export async function providerQuote(
  env: Bindings,
  wallet: Wallet,
  request: FinanceRequest,
) {
  const adapter = financeAdapter(env);
  const from = { adapter, chain: "Arc" as const, address: wallet.address };
  const amount = assetAmount(
    request.amount,
    assetDefinition(request.asset).decimals,
  );
  let fees: (Omit<FinanceFee, "decimals"> & { decimals?: number })[] = [],
    expected = amount,
    minimum = amount,
    output = request.asset;
  let providerQuote: unknown;
  let vaultReview:
    | { address: string; name: string; provider: string }
    | undefined;
  if (request.kind === "swap") {
    output = request.outputAsset!;
    const quote = await swap().estimate({
      from,
      tokenIn: request.asset,
      tokenOut: output,
      amountIn: amount,
      config: {
        apiKey: env.CIRCLE_API_KEY,
        allowanceStrategy: "approve",
        slippageBps: request.slippageBps,
      },
    });
    expected = quote.estimatedOutput.amount;
    minimum = quote.stopLimit.amount;
    if ((quote.fees || []).some((f) => f.amount === null))
      throw new ApiError("FEE_UNAVAILABLE", 503);
    fees = (quote.fees || []).map((f) => ({
      symbol: f.token,
      amount: f.amount!,
      label: f.type === "gas" ? "Estimated network fee" : f.type,
      ...(f.type === "gas" ? { decimals: 18 } : {}),
    }));
  } else if (request.kind === "withdraw" && request.destination !== "Arc") {
    const route = (await destinationChains()).find(
      (r) =>
        r.id === request.destination &&
        r.assets.includes(request.asset as "USDC" | "EURC"),
    );
    if (!route || !validRecipient(request.recipient!, route.type))
      throw new ApiError("INVALID_RECIPIENT");
    const quote = await bridge().estimate({
      from,
      to: {
        chain: route.definition,
        recipientAddress: request.recipient!,
        useForwarder: true,
      },
      token: request.asset,
      amount,
      config: {
        transferSpeed: "SLOW",
        batchTransactions: false,
        feePayment: "destination",
      },
    });
    if (quote.fees.some((f) => f.amount === null || f.error))
      throw new ApiError("FEE_UNAVAILABLE", 503);
    fees = quote.fees.map((f) => ({
      symbol: f.token,
      amount: f.amount!,
      label: f.type,
    }));
    if (fees.some((f) => f.symbol !== request.asset))
      throw new ApiError("FEE_UNAVAILABLE", 503);
    const feeUnits = fees.reduce(
      (sum, f) =>
        sum +
        BigInt(assetUnits(f.amount, assetDefinition(request.asset).decimals)),
      0n,
    );
    if (BigInt(request.amount) <= feeUnits)
      throw new ApiError("INSUFFICIENT_BALANCE", 409);
    expected = minimum = assetAmount(
      (BigInt(request.amount) - feeUnits).toString(),
      assetDefinition(request.asset).decimals,
    );
    providerQuote = quote.quote;
  } else if (request.kind.startsWith("earn-")) {
    const vault = await vaultInfo(env, request.vaultAddress);
    vaultReview = {
      address: vault.vaultAddress,
      name: vault.name,
      provider: vault.protocol,
    };
    const params = {
      from,
      vaultAddress: vault.vaultAddress,
      amount,
      config: { apiKey: env.CIRCLE_API_KEY, batchTransactions: false },
    };
    if (request.kind === "earn-deposit") {
      const quote = await earn()
        .getDepositQuote(params)
        .catch((error: unknown) => {
          if (
            (error as { code?: number }).code === 1104 &&
            /wallet does not hold enough tokens/i.test((error as Error).message)
          )
            throw new ApiError("INSUFFICIENT_BALANCE", 409);
          throw error;
        });
      fees = quote.fees.map((f) => ({
        symbol: f.symbol,
        amount: f.amount,
        label: "Vault fee",
      }));
    } else {
      const quote = await earn().getWithdrawalQuote(params);
      if (
        BigInt(assetUnits(quote.maxWithdrawable.amount, 6)) <
        BigInt(request.amount)
      )
        throw new ApiError("INSUFFICIENT_LIQUIDITY", 409);
      fees = quote.fees.map((f) => ({
        symbol: f.symbol,
        amount: f.amount,
        label: "Vault fee",
      }));
      const deductions = quote.fees
        .filter((f) => f.symbol === "USDC")
        .reduce((sum, f) => sum + BigInt(assetUnits(f.amount, 6)), 0n);
      if (deductions >= BigInt(request.amount))
        throw new ApiError("INSUFFICIENT_BALANCE", 409);
      expected = minimum = assetAmount(
        (BigInt(request.amount) - deductions).toString(),
        6,
      );
    }
  }
  return {
    fees,
    expected,
    minimum,
    output,
    providerQuote,
    vault: vaultReview,
  };
}
export async function executeProvider(
  env: Bindings,
  wallet: Wallet,
  request: FinanceRequest,
  minimum: string,
  providerQuote: unknown,
  recovery: string | null,
  execute: Executor,
) {
  const adapter = financeAdapter(env, execute);
  const from = { adapter, chain: "Arc" as const, address: wallet.address };
  const amount = assetAmount(
    request.amount,
    assetDefinition(request.asset).decimals,
  );
  if (request.kind === "withdraw") {
    if (request.destination === "Arc") {
      const hash = await execute({
        to: assetDefinition(request.asset).address,
        value: "0",
        data: encodeFunctionData({
          abi: tokenAbi,
          functionName: "transfer",
          args: [request.recipient! as Address, BigInt(request.amount)],
        }),
      });
      return { complete: true, hash };
    }
    const kit = bridge();
    const result = recovery
      ? await kit.retry(JSON.parse(recovery) as BridgeResult<string>, {
          from: adapter,
        })
      : await kit.bridge({
          from,
          to: {
            chain: request.destination as Parameters<
              typeof kit.bridge
            >[0]["to"]["chain"],
            recipientAddress: request.recipient!,
            useForwarder: true,
          },
          token: request.asset,
          amount,
          quote: providerQuote,
          config: {
            transferSpeed: "SLOW",
            batchTransactions: false,
            feePayment: "destination",
            maxFee: assetAmount(
              (
                BigInt(request.amount) -
                BigInt(
                  assetUnits(minimum, assetDefinition(request.asset).decimals),
                )
              ).toString(),
              assetDefinition(request.asset).decimals,
            ),
          },
        });
    const delivery = result.steps.find(
      (s) => ["mint", "forward"].includes(s.name) && s.state === "success",
    );
    return {
      complete: result.state === "success" && !!delivery?.txHash,
      hash: delivery?.txHash,
      recovery: financeJson(result),
    };
  }
  if (request.kind === "swap") {
    const result = await swap().swap({
      from,
      tokenIn: request.asset,
      tokenOut: request.outputAsset!,
      amountIn: amount,
      config: {
        apiKey: env.CIRCLE_API_KEY,
        allowanceStrategy: "approve",
        slippageBps: request.slippageBps,
        stopLimit: minimum,
      },
    });
    return { complete: true, hash: result.txHash };
  }
  const params = {
    from,
    vaultAddress: request.vaultAddress!,
    amount,
    config: { apiKey: env.CIRCLE_API_KEY, batchTransactions: false },
  };
  const result =
    request.kind === "earn-deposit"
      ? await earn().deposit(params)
      : await earn().withdraw(params);
  return {
    complete: true,
    hash: "txHash" in result ? result.txHash : undefined,
  };
}

export async function listEarnVaults(
  env: Bindings,
  page: number,
): Promise<EarnVaultList> {
  const result = await earn().exploreVaults({
    chain: "Arc",
    page,
    pageSize: 100,
    config: { apiKey: env.CIRCLE_API_KEY },
  });
  return {
    page,
    hasMore: page < result.pagination.totalPages,
    vaults: result.vaults
      .filter(
        (v) =>
          v.chain === "Arc" &&
          v.asset === "USDC" &&
          v.assetAddress.toLowerCase() ===
            walletAssets[0].address.toLowerCase(),
      )
      .map((v) => ({
        address: v.vaultAddress,
        name: v.name,
        provider: v.protocol,
        apy: Number.isFinite(v.currentApy) ? v.currentApy : null,
        performanceFee: v.fee.performance,
        managementFee: v.fee.management,
        liquidity: assetUnits(v.liquidity, 6),
        decimals: 6,
        enabled: true,
      })),
  };
}
