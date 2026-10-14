import { DatabaseSync } from "node:sqlite";
export function d1(sql: DatabaseSync): D1Database {
  function prepare(query: string) {
    let args: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) {
        args = values;
        return statement;
      },
      async first() {
        return sql.prepare(query).get(...(args as never[])) ?? null;
      },
      async run() {
        const result = sql.prepare(query).run(...(args as never[]));
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      async all() {
        return {
          results: sql.prepare(query).all(...(args as never[])),
          success: true,
        };
      },
    };
    return statement;
  }
  return {
    prepare,
    async batch(statements: { run(): Promise<unknown> }[]) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sql.exec("COMMIT");
        return results;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}
