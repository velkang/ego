import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { availableSlug, slugBase } from "../src/slugs";

describe("event slugs", () => {
  it("normalizes titles and uses a readable fallback", () => {
    expect(slugBase("  Café — Garden Gathering!  ")).toBe(
      "cafe-garden-gathering",
    );
    expect(slugBase("東京")).toBe("event");
  });
  it("resolves duplicate titles and occupied numeric suffixes", () => {
    const taken = new Set(["garden-gathering", "garden-gathering-2"]);
    expect(availableSlug("Garden gathering", taken)).toBe("garden-gathering-3");
  });
  it("backfills legacy events without changing IDs and enforces uniqueness", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(
      readFileSync(
        new URL("../migrations/0001_initial.sql", import.meta.url),
        "utf8",
      ),
    );
    for (const id of ["first", "second"])
      db.prepare(
        "INSERT INTO event VALUES (?, 'Garden gathering','Park','',0,0,1,2,'active',100,1)",
      ).run(id);
    db.exec(
      readFileSync(
        new URL("../migrations/0003_event_slugs.sql", import.meta.url),
        "utf8",
      ),
    );
    const taken = new Set<string>();
    for (const row of db
      .prepare("SELECT id,title FROM event ORDER BY id")
      .all() as { id: string; title: string }[]) {
      const slug = availableSlug(row.title, taken);
      taken.add(slug);
      db.prepare("UPDATE event SET slug = ? WHERE id = ?").run(slug, row.id);
    }
    expect(db.prepare("SELECT id,slug FROM event ORDER BY id").all()).toEqual([
      { id: "first", slug: "garden-gathering" },
      { id: "second", slug: "garden-gathering-2" },
    ]);
    expect(() =>
      db
        .prepare("UPDATE event SET slug='garden-gathering' WHERE id='second'")
        .run(),
    ).toThrow(/UNIQUE/);
    db.close();
  });
});
