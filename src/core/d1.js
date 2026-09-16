import { auditLog, eventLog } from "./events.js";

export function createD1(env, { who = "system:read" } = {}) {
  if (!env?.DB) throw new Error("A DB binding is required");
  const db = env.DB;
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      return new Proxy(statement, { get(target, property) {
        const value = target[property];
        if (typeof value !== "function" || !["run", "first", "all", "raw"].includes(property)) return typeof value === "function" ? value.bind(target) : value;
        return async (...args) => { auditD1(who, sql); return value.apply(target, args); };
      }});
    },
    async batch(statements) {
      auditD1(who, "BATCH");
      return typeof db.batch === "function" ? db.batch(statements) : Promise.all(statements.map((statement) => statement.run()));
    },
  };
}

export function auditedD1(db, who = "system:read") {
  if (!db) return db;
  return new Proxy(db, {
    get(target, property) {
      const value = target[property];
      if (property === "prepare") return (sql) => {
        const statement = value.call(target, sql);
        return new Proxy(statement, {
          get(statementTarget, statementProperty) {
            const method = statementTarget[statementProperty];
            if (!["run", "first", "all", "raw"].includes(statementProperty) || typeof method !== "function") return typeof method === "function" ? method.bind(statementTarget) : method;
            return async (...args) => { auditD1(who, sql); return method.apply(statementTarget, args); };
          },
        });
      };
      if (property === "batch") return (statements) => { auditD1(who, "BATCH"); return typeof value === "function" ? value.call(target, statements) : Promise.all(statements.map((statement) => statement.run())); };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function auditedEnv(env, who = "system:read") {
  if (!env?.DB) return env;
  const result = Object.create(env);
  result.DB = auditedD1(env.DB, who);
  return result;
}

function auditD1(who, sql) {
  const operation = String(sql).trim().match(/^(SELECT|INSERT|UPDATE|DELETE|REPLACE|WITH)/i)?.[1]?.toLowerCase() || "execute";
  eventLog("debug", "d1.operation", { who, operation });
  auditLog({ who, operation, resource: "d1" });
}
