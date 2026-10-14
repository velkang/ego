# Ego

A venue-hosted money hunt on Arc. Visitors discover events, walk to reward spots, and collect USDC. One account can win once per event.

## Local development

Requires Node 22.18+, pnpm, and Foundry.

```sh
pnpm install
pnpm db:migrate:local
pnpm dev
# Another terminal:
pnpm web:dev
```

Open `http://localhost:5173`. The API uses port 8797. Vite proxies API requests to it.

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
| `EGO_DROPS_ADDRESS`                      | Deployed Arc mainnet escrow address                              |
| `CIRCLE_WEBHOOK_SUBSCRIPTION_ID`         | Expected Circle v2 notification subscription                     |
