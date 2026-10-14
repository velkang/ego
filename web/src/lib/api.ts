const messages: Record<string, string> = {
  REAUTH_REQUIRED: "Verify your email again to authorize this payment.",
  INSUFFICIENT_BALANCE:
    "Your wallet needs enough USDC for the reward and network fees.",
  WALLET_BUSY: "Another payment is still processing. Wait for it to finish.",
  QUOTE_EXPIRED: "This fee quote expired. Review the transfer again.",
  INVALID_PROOF: "This code or answer is incorrect, expired, or unavailable.",
  PRIZE_NOT_ASSIGNED: "This prize is assigned to a different email address.",
  CREATOR_FUNDING_REQUIRED:
    "The creator must authorize funding from their wallet.",
  INVALID_RECIPIENT: "Enter a different, valid receiving wallet address.",
  EVENT_OPERATION_PENDING:
    "This campaign already has an operation in progress.",
  EVENT_NOT_FOUND: "This campaign could not be found. Check the link and try again.",
  LOCATION_REQUIRED: "Turn on location to claim this money drop.",
  SIGN_IN_REQUIRED: "Sign in to collect this drop.",
  OPERATOR_REQUIRED: "This page is for the Ego team.",
  STALE_LOCATION:
    "Your location reading expired. Try again for a fresh reading.",
  LOCATION_INACCURATE:
    "Your location is not precise enough yet. Move to an open area and try again.",
  TOO_FAR:
    "You’re still outside this drop’s claiming area. Walk a little closer.",
  SPOT_EXHAUSTED: "All rewards at this spot have been collected.",
  SPOT_UNAVAILABLE: "This drop is no longer available. Choose another spot.",
  EVENT_EXPIRED: "This event has ended.",
  EVENT_UNAVAILABLE: "This event is not accepting claims right now.",
  RATE_LIMITED: "A few too many attempts. Wait a minute and try again.",
  SERVICE_UNAVAILABLE:
    "The service is temporarily unavailable. Try again shortly.",
  CIRCLE_NOT_CONFIGURED:
    "Wallets are not configured yet. Please contact the event organizer.",
  AUTH_NOT_CONFIGURED:
    "Sign-in is not configured yet. Please contact the event organizer.",
};
export class RequestError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(
      messages[code] || "We couldn’t complete that request. Please try again.",
    );
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!navigator.onLine)
    throw new Error(
      "You’re offline. Reconnect to view availability or collect a drop.",
    );
  let response: Response;
  try {
    response = await fetch(`/v1${path}`, {
      ...options,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch {
    throw new Error(
      "Couldn’t reach Ego. Check your connection and try again.",
    );
  }
  const body = await response.json().catch(() => {
    throw new RequestError("SERVICE_UNAVAILABLE", response.status);
  });
  if (!response.ok)
    throw new RequestError(
      body.error || "SERVICE_UNAVAILABLE",
      response.status,
    );
  return body as T;
}
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
