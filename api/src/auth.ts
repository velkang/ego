import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Bindings } from "./env";
import { database } from "./db";
import * as schema from "./schema";
export function auth(env: Bindings) {
  return betterAuth({
    database: drizzleAdapter(database(env.DB), { provider: "sqlite", schema }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_ORIGIN,
    basePath: "/v1/auth",
    trustedOrigins: [env.APP_ORIGIN],
    emailAndPassword: { enabled: false },
    plugins: [
      emailOTP({
        expiresIn: 300,
        allowedAttempts: 5,
        storeOTP: "hashed",
        async sendVerificationOTP({ email, otp }) {
          if (!env.RESEND_API_KEY || !env.EMAIL_FROM)
            throw new Error("Email delivery is not configured");
          const result = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: env.EMAIL_FROM,
              to: email,
              subject: "Your Jovva sign-in code",
              text: `Your Jovva code is ${otp}. It expires in 5 minutes. If you did not request this, ignore this email.`,
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (!result.ok) throw new Error("Email delivery failed");
        },
      }),
    ],
  });
}
export const isOperator = (env: Bindings, email: string) =>
  (env.OPERATOR_EMAILS ?? "").split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
