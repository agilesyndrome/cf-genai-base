import { auditLog, eventLog } from "../events/index.js";

export interface D1Environment {
  DB?: D1Database;
}

export interface D1AuditOptions {
  who?: string;
}

/** Return the environment's D1 binding with audit logging around executing methods. */
export function createD1(env: unknown, { who = "system:read" }: D1AuditOptions = {}): D1Database {
  const db = (env as D1Environment | null)?.DB;
  if (!db) throw new Error("A DB binding is required");
  return auditedD1(db, who);
}

export function auditedD1(db: D1Database, who = "system:read"): D1Database {
  return new Proxy(db, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property === "prepare") {
        return (sql: string) => auditedStatement(target.prepare(sql), who, sql);
      }
      if (property === "batch") {
        return (statements: D1PreparedStatement[]) => {
          auditD1(who, "BATCH");
          const batch = Reflect.get(target, "batch") as D1Database["batch"] | undefined;
          return typeof batch === "function"
            ? batch.call(target, statements)
            : Promise.all(statements.map((statement) => statement.run()));
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function auditedEnv<Env extends D1Environment>(env: Env, who = "system:read"): Env {
  if (!env.DB) return env;
  const result = Object.create(env) as Env;
  result.DB = auditedD1(env.DB, who);
  return result;
}

function auditedStatement(statement: D1PreparedStatement, who: string, sql: string): D1PreparedStatement {
  return new Proxy(statement, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (
        typeof property === "string"
        && ["run", "first", "all", "raw"].includes(property)
        && typeof value === "function"
      ) {
        return (...args: unknown[]) => {
          auditD1(who, sql);
          return value.apply(target, args);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function auditD1(who: string, sql: string): void {
  const operation = String(sql).trim().match(/^(SELECT|INSERT|UPDATE|DELETE|REPLACE|WITH)/i)?.[1]?.toLowerCase() ?? "execute";
  eventLog("debug", "d1.operation", { who, operation });
  auditLog({ who, operation, resource: "d1" });
}
