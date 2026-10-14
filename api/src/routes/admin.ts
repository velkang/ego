import type { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../env";
import { ApiError } from "../http";
import { ensureWallet } from "../circle";
import { isOperator } from "../auth";
import { availableSlug } from "../slugs";
import type { EventRow, OperationRow } from "../db";
const coordinates = {
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
};
export const eventInput = z
  .object({
    title: z.string().trim().min(1).max(100),
    venue: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000),
    ...coordinates,
    startsAt: z.number().int().positive(),
    endsAt: z.number().int().positive(),
    spots: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(100),
          ...coordinates,
          radius: z.number().min(10).max(500).default(50),
          amount: z.number().int().min(1).max(100_000_000),
          capacity: z.number().int().min(1).max(10000),
        }),
      )
      .min(1)
      .max(100),
  })
  .refine(
    (v) => v.endsAt > v.startsAt && v.endsAt > Date.now(),
    "Invalid event dates",
  )
  .refine(
    (v) =>
      Number.isSafeInteger(
        v.spots.reduce((sum, s) => sum + s.amount * s.capacity, 0),
      ),
    "Budget too large",
  );
export function registerAdminRoutes(app: Hono<AppEnvironment>) {
  app.use("/v1/admin/*", async (c, next) => {
    if (!isOperator(c.env, c.get("user").email))
      throw new ApiError("OPERATOR_REQUIRED", 403);
    await next();
  });
  app.get("/v1/admin/events", async (c) => {
    const events = (
      await c.env.DB.prepare(
        "SELECT * FROM event ORDER BY created_at DESC LIMIT 100",
      ).all<EventRow>()
    ).results;
    const operations = (
      await c.env.DB.prepare(
        "SELECT * FROM operation ORDER BY created_at DESC LIMIT 100",
      ).all<OperationRow>()
    ).results;
    return c.json({ events, operations });
  });
  app.post("/v1/admin/events", async (c) => {
    const value = eventInput.parse(await c.req.json());
    const wallet = await ensureWallet(c.env, c.get("user").id);
    const id = crypto.randomUUID();
    const budget = value.spots.reduce(
      (sum, s) => sum + s.amount * s.capacity,
      0,
    );
    const rows = await c.env.DB.prepare(
      "SELECT slug FROM event WHERE slug IS NOT NULL",
    ).all<{ slug: string }>();
    const taken = new Set(rows.results.map((row) => row.slug));
    for (let attempt = 0; attempt < 100; attempt++) {
      const slug = availableSlug(value.title, taken);
      try {
        await c.env.DB.batch([
          c.env.DB.prepare(
            "INSERT INTO event (id,title,venue,description,latitude,longitude,starts_at,ends_at,status,budget,created_at,slug,creator_id,funding_wallet_id,funding_address) VALUES (?,?,?,?,?,?,?,?,'draft',?,?,?,?,?,?)",
          ).bind(
            id,
            value.title,
            value.venue,
            value.description,
            value.latitude,
            value.longitude,
            value.startsAt,
            value.endsAt,
            budget,
            Date.now(),
            slug,
            c.get("user").id,
            wallet.id,
            wallet.address,
          ),
          ...value.spots.map((s) =>
            c.env.DB.prepare(
              "INSERT INTO spot (id,event_id,title,latitude,longitude,radius,amount,capacity,remaining) VALUES (?,?,?,?,?,?,?,?,?)",
            ).bind(
              crypto.randomUUID(),
              id,
              s.title,
              s.latitude,
              s.longitude,
              s.radius,
              s.amount,
              s.capacity,
              s.capacity,
            ),
          ),
        ]);
        return c.json({ id, slug }, 201);
      } catch (error) {
        const message =
          String(error) + String((error as { cause?: unknown }).cause ?? "");
        if (!message.includes("UNIQUE constraint failed: event.slug"))
          throw error;
        taken.add(slug);
      }
    }
    throw new ApiError("EVENT_SLUG_UNAVAILABLE", 409);
  });
  // Team membership never authorizes spending another creator's wallet.
  // Creator-paid actions use the same ownership, fee review and recent OTP path.
  app.post("/v1/admin/events/:id/actions", () => {
    throw new ApiError("CREATOR_FUNDING_REQUIRED", 403);
  });
  app.post("/v1/admin/operations/:id/retry", () => {
    throw new ApiError("CREATOR_FUNDING_REQUIRED", 403);
  });
}
