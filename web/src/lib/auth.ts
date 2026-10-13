import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";
export const authClient = createAuthClient({
  basePath: "/v1/auth",
  plugins: [emailOTPClient()],
});
