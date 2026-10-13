export function slugBase(title: string): string {
  const base =
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "event";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    base,
  )
    ? `${base}-event`
    : base;
}

export function availableSlug(
  title: string,
  taken: ReadonlySet<string>,
): string {
  const base = slugBase(title);
  let slug = base;
  for (let suffix = 2; taken.has(slug); suffix++) slug = `${base}-${suffix}`;
  return slug;
}
