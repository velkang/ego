import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
const timestamp = (name: string) =>
  integer(name, { mode: "timestamp_ms" }).notNull();
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: timestamp("createdAt"),
  updatedAt: timestamp("updatedAt"),
});
export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt"),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt"),
  updatedAt: timestamp("updatedAt"),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});
export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", {
    mode: "timestamp_ms",
  }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", {
    mode: "timestamp_ms",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt"),
  updatedAt: timestamp("updatedAt"),
});
export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt"),
  updatedAt: timestamp("updatedAt"),
});
export const wallet = sqliteTable("wallet", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  walletId: text("wallet_id").unique(),
  address: text("address"),
  createdAt: integer("created_at").notNull(),
});
