import type { User } from "better-auth";
export type Bindings = {
  DB: D1Database;
  APP_ORIGIN: string;
  BETTER_AUTH_SECRET: string;
  ACCOUNT_HASH_SECRET: string;
  PROOF_SECRET: string;
  OPERATOR_EMAILS: string;
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
  CIRCLE_API_KEY: string;
  CIRCLE_ENTITY_SECRET: string;
  CIRCLE_WALLET_SET_ID: string;
  CIRCLE_OPERATOR_WALLET_ID: string;
  JOVVA_DROPS_ADDRESS: string;
  CIRCLE_WEBHOOK_SUBSCRIPTION_ID: string;
  ARC_RPC_URL: string;
  AUTH_LIMIT: { limit(input: { key: string }): Promise<{ success: boolean }> };
  CLAIM_LIMIT: { limit(input: { key: string }): Promise<{ success: boolean }> };
};
export type AppEnvironment = {
  Bindings: Bindings;
  Variables: { user: User; sessionCreatedAt: number };
};
