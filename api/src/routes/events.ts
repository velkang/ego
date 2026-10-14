import type { Hono } from "hono";
import { distanceMeters } from "@jovva/chain";
import type { AppEnvironment } from "../env";
import type { EventRow, SpotRow, ClaimRow } from "../db";
import { ApiError } from "../http";
import { auth } from "../auth";
export function registerEventRoutes(app: Hono<AppEnvironment>) {
  app.get("/v1/drops", async (c) => {
    const viewer =
      c.req.header("cookie") && c.env.BETTER_AUTH_SECRET
        ? await auth(c.env).api.getSession({ headers: c.req.raw.headers })
        : null;
    const userId = viewer?.user.id ?? null;
    const drops = (
      await c.env.DB.prepare(
        "SELECT spot.*,event.slug AS event_slug,event.title AS campaign_title,event.venue,event.status AS event_status FROM spot JOIN event ON event.id = spot.event_id WHERE event.kind = 'map' AND event.status IN ('active','paused') AND event.ends_at > ? AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM claim WHERE claim.user_id = ? AND claim.event_id = event.id AND claim.status != 'failed' AND (event.single_claim = 1 OR claim.spot_id = spot.id))) ORDER BY event.created_at DESC LIMIT 200",
      )
        .bind(Date.now(), userId, userId)
        .all()
    ).results;
    return c.json({ drops });
  });
  app.get("/v1/events", async (c) => {
    const latitude = Number(c.req.query("latitude")),
      longitude = Number(c.req.query("longitude"));
    const located =
      c.req.query("latitude") !== undefined &&
      c.req.query("longitude") !== undefined &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180;
    const rows = await c.env.DB.prepare(
      "SELECT event.*, COALESCE((SELECT SUM(remaining) FROM spot WHERE event_id = event.id),0) as remaining, COALESCE((SELECT MIN(amount) FROM spot WHERE event_id = event.id),0) as min_amount, COALESCE((SELECT MAX(amount) FROM spot WHERE event_id = event.id),0) as max_amount FROM event WHERE kind = 'map' AND status IN ('active','paused') AND ends_at > ? ORDER BY starts_at LIMIT 100",
    )
      .bind(Date.now())
      .all<
        EventRow & { remaining: number; min_amount: number; max_amount: number }
      >();
    const events = rows.results.map((event) => ({
      ...event,
      distance: located ? distanceMeters({ latitude, longitude }, event) : null,
    }));
    if (located) events.sort((a, b) => a.distance! - b.distance!);
    return c.json({ events });
  });
  app.get("/v1/events/:id", async (c) => {
    const event = await c.env.DB.prepare(
      "SELECT * FROM event WHERE (id = ? OR slug = ?) AND status != 'draft' AND status != 'launching'",
    )
      .bind(c.req.param("id"), c.req.param("id"))
      .first<EventRow>();
    if (!event) throw new ApiError("EVENT_NOT_FOUND", 404);
    const spots = (
      await c.env.DB.prepare(
        "SELECT * FROM spot WHERE event_id = ? ORDER BY amount DESC,title",
      )
        .bind(event.id)
        .all<SpotRow>()
    ).results;
    const clues = (
      await c.env.DB.prepare(
        "SELECT spot_id,clue FROM drop_proof WHERE spot_id IN (SELECT id FROM spot WHERE event_id = ?)",
      )
        .bind(event.id)
        .all<{ spot_id: string; clue: string }>()
    ).results;
    let claimedSpots: string[] = [];
    let claim: ReturnType<typeof import("../claims").publicClaim> | null = null;
    if (c.req.header("cookie") && c.env.BETTER_AUTH_SECRET) {
      const session = await auth(c.env).api.getSession({
        headers: c.req.raw.headers,
      });
      if (session) {
        claimedSpots = (
          await c.env.DB.prepare(
            "SELECT spot_id FROM claim WHERE event_id = ? AND user_id = ? AND status != 'failed'",
          )
            .bind(event.id, session.user.id)
            .all<{ spot_id: string }>()
        ).results.map((row) => row.spot_id);
        const row = await c.env.DB.prepare(
          "SELECT * FROM claim WHERE event_id = ? AND user_id = ? AND status != 'failed' ORDER BY created_at DESC LIMIT 1",
        )
          .bind(event.id, session.user.id)
          .first<ClaimRow>();
        if (row) {
          const { publicClaim } = await import("../claims");
          claim = publicClaim(row);
        }
      }
    }
    return c.json({
      event: {
        ...event,
        funding_wallet_id: undefined,
        funding_address: undefined,
        funding_fee: undefined,
        funding_quote_id: undefined,
        funding_quote_at: undefined,
        creator_id: undefined,
      },
      spots: spots.map((s) => ({
        ...s,
        claimed: claimedSpots.includes(s.id),
        clue: clues.find((p) => p.spot_id === s.id)?.clue,
      })),
      claim: event.single_claim ? claim : null,
    });
  });
}
