# Ego

**A USDC wallet with fun ways to get paid, built on Arc.**

Ego turns programmable money into things people actually enjoy:

- **Prizes and bounties.** An organiser locks prize money on Arc once and lists the winners' emails. Each winner claims with their email, with no wallet or crypto needed up front. Anything unclaimed goes back to the organiser automatically.
- **Money Drops.** Someone hides USDC across public places for a set time window. People hunt it on a map with a compass, and claim it when they're within 30 m.
- **Codes, event QR codes and puzzles.** Giveaways people claim with a code, a scan at a venue, or the answer to a riddle.
- **A real wallet** for what you win: send, receive, and (next) swap and earn.

"Ego" means _money_ in Igbo. The first test city is Enugu, Nigeria, but Ego works anywhere.

## Why Arc

| Ego needs                                                 | Arc gives                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Prize money that's provably there before anyone claims it | USDC locked in a contract on-chain, visible on the explorer                                                         |
| Instant, believable payouts                               | Sub-second deterministic finality (our mainnet test: about 1.8 s from tap to receipt, network round trips included) |
| Claims for people with no crypto                          | Gas is paid in USDC, so Ego's relayer pays a fraction of a cent per claim for the winner                            |
| Predictable costs for organisers                          | Low, dollar-denominated fees                                                                                        |

Live app: [ego.velkan.xyz](https://ego.velkan.xyz)

## Contract

**EgoDrops:** [`0x764A562328697711B7ED62d864cC06c873c9f26A`](https://explorer.arc.io/address/0x764A562328697711B7ED62d864cC06c873c9f26A)

Creators fully fund campaign escrow before activation and pay the fees for funding and campaign management. Ego pays the gas for reward claims. The contract enforces campaign budgets, drop capacities, and duplicate-claim limits. Campaigns normally allow one reward per account; creators can allow multiple distinct drops, and named prizes are individually claimable.

Creators can recover unused funds after closing a campaign or after it expires. Refunds require a creator transaction. Claim cards represent confirmed payouts; the contract does not mint NFTs.

## App

The app uses Vite and React, a Hono API on Cloudflare Workers, D1, Better Auth email OTPs, and Circle developer-controlled wallets. Email sign-in provisions or recovers the account’s wallet. Resend sends authentication codes only; creators share campaign links themselves.

Map discovery uses MapLibre and OpenFreeMap. GPS is approximate and spoofable; map claims require a fresh location reading with acceptable accuracy. Receipts show success only after payout confirmation.

## Local development

Requires Node 22.18+, pnpm, and Foundry.

Copy `api/.dev.vars.example` to `api/.dev.vars` and configure the values before using authentication or transaction flows.

```sh
pnpm install
pnpm db:migrate:local
pnpm dev
# Another terminal:
pnpm web:dev
```

Open `http://localhost:5173`. The API uses port 8797; Vite proxies API requests to it.

## Configuration

Keep credentials in the API Worker’s secrets or the ignored local `api/.dev.vars` file.

| Setting                                  | Purpose                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `APP_ORIGIN`                             | Frontend origin; localhost for development, `https://ego.velkan.xyz` in production |
| `ARC_RPC_URL`                            | Arc mainnet RPC endpoint                                                           |
| `BETTER_AUTH_SECRET`                     | Authentication secret of at least 32 random characters                             |
| `ACCOUNT_HASH_SECRET`, `PROOF_SECRET`    | Separate stable secrets for account identifiers and proof protection               |
| `RESEND_API_KEY`, `EMAIL_FROM`           | Authentication email delivery from a verified domain                               |
| `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET` | Circle developer-controlled wallet credentials                                     |
| `CIRCLE_WALLET_SET_ID`                   | Wallet set for account wallets                                                     |
| `CIRCLE_OPERATOR_WALLET_ID`              | Funded operator wallet for reward payouts and claim gas                            |
| `EGO_DROPS_ADDRESS`                      | EgoDrops contract address listed above                                             |
| `CIRCLE_WEBHOOK_SUBSCRIPTION_ID`         | Expected Circle notification subscription                                          |
| `OPERATOR_EMAILS`                        | Comma-separated operator allowlist                                                 |
