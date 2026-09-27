import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function createSqliteD1({ migrations = [], seed } = {}) {
  const database = new DatabaseSync(":memory:");
  for (const migration of migrations) database.exec(readFileSync(migration, "utf8"));
  seed?.(database);

  return {
    prepare(sql) {
      const prepared = database.prepare(sql);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        run() {
          const result = prepared.run(...args);
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        },
        first() { return prepared.get(...args) ?? null; },
        all() { return { results: prepared.all(...args) }; },
        raw() { return { results: prepared.all(...args).map((row) => Object.values(row)) }; },
      };
    },
    batch(statements) {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.run());
        database.exec("COMMIT");
        return Promise.resolve(results);
      } catch (error) {
        database.exec("ROLLBACK");
        return Promise.reject(error);
      }
    },
    close() { database.close(); },
  };
}

export function repositoryMigrations(root) {
  return readdirSync(new URL("../../../migrations/", root))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort()
    .map((name) => new URL(`../../../migrations/${name}`, root));
}
