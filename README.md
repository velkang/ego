# Jovva

A venue-hosted money hunt on Arc Testnet. Visitors discover events, walk to reward spots, and collect test USDC. One account can win once per event.

## Workspace

- `web`: Vite/React PWA. Pages, components, and browser helpers follow Stillwater and Tideweave.
- `api`: independently deployed Hono Worker, Better Auth email OTP, Drizzle/D1, Circle wallets and payout reconciliation.
- `chain`: browser-safe Arc constants, JovvaDrops ABI, money formatting and location checks.
- `contracts`: non-upgradeable JovvaDrops escrow, Foundry tests and deployment script.

The web Worker forwards `/v1/*` and `/health` to the API via a service binding. API/session requests stay on the web origin. A frontend release does not redeploy the API.

## Local development

Requires Node 22.18+, pnpm, and Foundry.

```sh
pnpm install
pnpm db:migrate:local
pnpm dev
# Another terminal:
pnpm web:dev
```

Open `http://localhost:5173`. The API uses port 8797 to avoid conflicting with existing projects on 8787. Vite proxies API requests to it.

For an optional, **explicitly illustrative local event**, run:

```sh
pnpm exec wrangler d1 execute jovva --local -c api/wrangler.jsonc --file api/seed.local.sql
```

Never apply that fixture remotely. It is not a funded event and will not pay rewards. No events or successful payouts are fabricated by the production app.

## Configuration

Copy `api/.dev.vars.example` to `api/.dev.vars` and configure:

| Setting                                  | Purpose                                                          |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                     | Random secret of at least 32 characters for authentication       |
| `ACCOUNT_HASH_SECRET`                    | Separate stable secret for pseudonymous onchain claim identities |
| `RESEND_API_KEY`, `EMAIL_FROM`           | Email OTP delivery from a verified sending domain                |
| `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET` | Circle developer-controlled wallet authorization                 |
| `CIRCLE_WALLET_SET_ID`                   | Wallet set used for recipients                                   |
| `CIRCLE_OPERATOR_WALLET_ID`              | Separate funded operator wallet for escrow calls and gas         |
| `JOVVA_DROPS_ADDRESS`                    | Deployed Arc Testnet escrow address                              |
| `CIRCLE_WEBHOOK_SUBSCRIPTION_ID`         | Expected Circle v2 notification subscription                     |

Set `APP_ORIGIN` to the exact web origin and `OPERATOR_EMAILS` to a comma-separated allowlist in the API Wrangler configuration. For local overrides, these can also go in `.dev.vars`. Do not put secrets in Vite variables. Keep `ACCOUNT_HASH_SECRET` stable while events exist; rotating it changes onchain account identifiers.

Maps use MapLibre with OpenFreeMap’s Positron basemap. No API key is required. Attribution remains visible, and map failures offer Retry plus accessible event/reward lists.

Circle wallets are custodial/developer-controlled: Jovva authorizes wallet operations; visitors do not hold the keys. Email authentication and account sessions are handled by Better Auth, separately from Circle. Resend's free tier currently allows 100 emails/day and 3,000/month, including retries.

## Deploy to Cloudflare

1. Create a D1 database: `pnpm exec wrangler d1 create jovva`. Replace the placeholder database ID in `api/wrangler.jsonc`.
2. Set the API's `APP_ORIGIN` and `OPERATOR_EMAILS`. Add each secret with `pnpm exec wrangler secret put NAME -c api/wrangler.jsonc`.
3. Run `pnpm db:migrate:remote`, then `pnpm api:deploy`.
4. Run `pnpm web:deploy`. Its `API` binding expects the Worker named `jovva-api`.
5. Configure Circle v2 webhooks for transactions at `https://YOUR_WEB_ORIGIN/v1/webhooks/circle`. Store the subscription ID in the API secrets. Signatures are checked against Circle's published ECDSA key using the raw body. Notifications trigger fresh transaction/receipt reads and are deduplicated.

Worker names are `jovva-web` and `jovva-api`. They have separate deployment commands. Do not point production at the local preview database. Configure testnet credentials only for this milestone.

## Escrow and event operations

Deploy the contract with an operator address matching the Circle operator wallet. Its operator and USDC token are immutable. Run `pnpm contracts:build`, set `JOVVA_OPERATOR_ADDRESS`, then use Foundry's authenticated account options:

```sh
forge script contracts/script/DeployJovvaDrops.s.sol --root contracts \
  --rpc-url https://rpc.testnet.arc.io --account YOUR_DEPLOYER_ACCOUNT --broadcast
```

Add the resulting contract address to the API configuration. Fund the Circle operator wallet with test USDC from the Circle faucet for both rewards and gas. Visitors require no starting balance.

The team dashboard is `/admin`. Save an event draft with spots, schedules, reward amounts and capacities. **Fund & activate** tracks four operations: create immutable event configuration, approve USDC, fund the full budget, and activate. This can take several scheduled reconciliation runs; the UI shows the current phase. Other controls pause/resume claims, close events, and refund unused funds to the recorded funder. Configuration stays fixed after creation. Definite transaction failures can be retried at their failed phase.

Amounts in the API/database/escrow use integer ERC-20 USDC units (6 decimals). Native gas units use 18 decimals on Arc and are never added to those values or displayed as another balance.

## Claims and recovery

Claim eligibility requires an authenticated, verified email account, an active event, remaining spot capacity, and a fresh location reading within its radius. Default radius is 50 m; maximum reported accuracy is 50 m; readings older than 15 seconds are rejected. The backend cannot attest that GPS is genuine. Nearby indoor spots can overlap.

D1 batches atomically decrement capacity and create a reservation; a partial unique index allows one nonfailed claim per account/event. A trigger rechecks event timing and status inside the reservation. Wallet provisioning and payout submissions have persisted idempotency keys.

The claim remains pending until Circle reports completion **and** an Arc receipt contains the matching JovvaDrops payout event, recipient and amount. Network errors never return a slot prematurely. On a definite failed/cancelled/denied transaction, the backend checks onchain claim state before releasing capacity. A cron runs every minute to recover outstanding claims and operator operations. Failed recovery emits structured logs without credentials; already-paid mismatches remain reserved for operator investigation.

GPS data is checked for eligibility and is not stored in claim records. Identity policy is intentionally per account, not per person; multiple-email abuse is unresolved.

## Verification

```sh
pnpm check
pnpm test
pnpm contracts:test
pnpm web:build
pnpm api:build
pnpm smoke:local
pnpm smoke:arc
```

`api:build` is a deployment dry run. `smoke:local` executes the built API plus a separate forwarding Worker in Miniflare with real D1 and mocked Circle, Resend and RPC responses. It checks OTP/session forwarding, operator permissions, wallet idempotency, payout receipt verification, account-event limits, concurrent final-slot claims, private claim access and signed/duplicate/tampered webhooks. It also exercises event creation, funding, activation, pause/resume, closure and refunds. It submits no external transactions or emails.

Axios is pinned through a pnpm override to `1.19.0`: version `1.20.0`'s fetch adapter supplies an unsupported `cache: default` option inside the complete Workers bundle. The smoke test protects this integration when dependencies change.

`smoke:arc` verifies live chain ID and USDC decimals. To also create a recipient wallet, fund an isolated escrow event, and pay 1 test USDC, load the required environment variables and set `LIVE_ARC_TRANSACTIONS=1`. Run `pnpm contracts:build` first. The operator wallet must already have test USDC and the escrow must already be deployed. The script does not deploy the contract or invent credentials. If a transaction times out, inspect its Circle ID before rerunning.

Before a venue pilot, test the installed and browser PWA on physical iOS and Android devices outdoors and indoors. Record GPS accuracy, claim completion, payout latency, and recovery failures. Desktop emulation does not verify device GPS or home-screen installation.

Public host registration, indoor positioning hardware, QR checks, cash-out and mainnet release are outside this milestone.

## Event URLs and navigation

Events have stable, unique slugs such as `/events/garden-gathering`. Both migration commands run the slug backfill after applying SQL migrations; complete that step before deploying the new API. Existing UUID detail requests remain supported, and the browser replaces legacy UUID URLs with the canonical slug. New duplicate titles receive numeric suffixes. UUIDs still identify claims, operator operations, and escrow events.

Explore is a full-screen map with event markers and expandable lists. Selecting an event reveals reward markers and claiming circles; selecting a reward opens its sheet. Explore and Wallet use floating bottom navigation, hidden during a hunt and arrival. Foreground tracking stops on closure or navigation.

The local seed remains unfunded development data. Its event title and description are ordinary product content; setup details are kept here rather than repeated in visitor screens. The deployment still uses Arc Testnet and Circle test wallets. Removing environment labels from the interface does not change chain or payout configuration.
