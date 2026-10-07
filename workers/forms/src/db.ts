// Tiger Soul — admin data API on Cloudflare D1
//
// admin/tsdb.js turns the portal's Supabase-style calls
// (sb.from("profiles").select("*").eq("id", x)...) into one JSON request:
//
//   POST /api/db  { table, op, columns?, filters?, order?, values?, single?, returning? }
//
// This file turns that request into parameterised SQL. Table and column names
// are checked against TABLES, so nothing from the request reaches the SQL
// text except names on that list. Only signed-in admins get here (see auth.ts).

export type Row = Record<string, unknown>;

/** Every table the portal may touch, with its columns. */
export const TABLES: Record<string, string[]> = {
  profiles: ["id", "first_name", "last_name", "email", "phone", "country", "notes", "unsubscribed_at", "created_at", "updated_at"],
  waivers: ["id", "profile_id", "full_name", "email", "phone", "signature", "date_signed", "signed_at", "created_at"],
  screenings: ["id", "profile_id", "full_name", "email", "phone", "offering", "answers", "created_at"],
  contact_messages: ["id", "profile_id", "name", "email", "phone", "topic", "message", "source", "created_at"],
  program_sessions: ["id", "program", "label", "starts_on", "ends_on", "location", "created_at"],
  program_enrollments: ["id", "profile_id", "program", "session_id", "accommodation", "payment_plan", "payment_link", "payment_status", "status", "notes", "created_at", "updated_at"],
  campaigns: ["id", "name", "subject", "preview_text", "content_html", "audience_type", "audience_program", "audience_ids", "status", "scheduled_at", "recipient_count", "sent_by", "sent_at", "created_at", "updated_at"],
  campaign_recipients: ["id", "campaign_id", "profile_id", "email", "status", "provider_id", "error", "created_at"],
};

/** Columns stored as JSON text. Parsed on the way out, stringified on the way in. */
const JSON_COLUMNS = new Set(["answers", "audience_ids"]);

type Filter = { col: string; op: "eq" | "neq" | "in" | "is" | "lte" | "gte" | "lt" | "gt"; val: unknown };
type Order = { col: string; asc: boolean };
export type DbRequest = {
  table: string;
  op: "select" | "insert" | "update" | "delete" | "upsert";
  columns?: string;
  filters?: Filter[];
  order?: Order[];
  limit?: number;
  values?: Row | Row[];
  onConflict?: string;
  single?: boolean;
  maybeSingle?: boolean;
  returning?: boolean;
};
export type DbResult = { data: unknown; error: { message: string } | null };

class BadRequest extends Error {}

const now = () => new Date().toISOString();

function checkCol(table: string, col: string): string {
  if (!TABLES[table].includes(col)) throw new BadRequest(`Unknown column ${table}.${col}`);
  return col;
}

function encode(col: string, v: unknown): unknown {
  if (v === undefined) return null;
  if (JSON_COLUMNS.has(col) && v !== null && typeof v !== "string") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

export function decodeRow(row: Row): Row {
  for (const col of JSON_COLUMNS) {
    if (typeof row[col] === "string") {
      try { row[col] = JSON.parse(row[col] as string); } catch { /* leave as text */ }
    }
  }
  return row;
}

function whereClause(table: string, filters: Filter[] = [], params: unknown[]): string {
  if (!filters.length) return "";
  const parts = filters.map((f) => {
    const col = checkCol(table, f.col);
    switch (f.op) {
      case "eq": params.push(encode(col, f.val)); return `${col} = ?`;
      case "neq": params.push(encode(col, f.val)); return `${col} <> ?`;
      case "lt": params.push(f.val); return `${col} < ?`;
      case "lte": params.push(f.val); return `${col} <= ?`;
      case "gt": params.push(f.val); return `${col} > ?`;
      case "gte": params.push(f.val); return `${col} >= ?`;
      case "is":
        if (f.val === null) return `${col} IS NULL`;
        throw new BadRequest("is() only supports null");
      case "in": {
        const list = Array.isArray(f.val) ? f.val : [];
        if (!list.length) return "0";
        params.push(...list.map((v) => encode(col, v)));
        return `${col} IN (${list.map(() => "?").join(", ")})`;
      }
      default: throw new BadRequest(`Unsupported filter ${String((f as Filter).op)}`);
    }
  });
  return " WHERE " + parts.join(" AND ");
}

function selectList(table: string, columns?: string): string {
  const raw = (columns || "*").trim();
  if (raw === "*") return "*";
  return raw.split(",").map((c) => checkCol(table, c.trim())).join(", ");
}

/** Fill the defaults Postgres used to supply: id, timestamps. */
function withDefaults(table: string, row: Row): Row {
  const cols = TABLES[table];
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[checkCol(table, k)] = encode(k, v);
  if (cols.includes("id") && !out.id) out.id = crypto.randomUUID();
  if (cols.includes("created_at") && !out.created_at) out.created_at = now();
  if (cols.includes("updated_at") && !out.updated_at) out.updated_at = now();
  if (table === "profiles" && typeof out.email === "string") out.email = out.email.trim().toLowerCase();
  return out;
}

export async function runQuery(db: D1Database, q: DbRequest): Promise<DbResult> {
  try {
    if (!q || !TABLES[q.table]) throw new BadRequest("Unknown table");
    const table = q.table;
    const params: unknown[] = [];
    let rows: Row[] = [];

    if (q.op === "select") {
      let sql = `SELECT ${selectList(table, q.columns)} FROM ${table}` + whereClause(table, q.filters, params);
      if (q.order?.length) sql += " ORDER BY " + q.order.map((o) => `${checkCol(table, o.col)} ${o.asc ? "ASC" : "DESC"}`).join(", ");
      if (q.limit) sql += ` LIMIT ${Math.max(1, Math.min(10000, Math.floor(q.limit)))}`;
      rows = (await db.prepare(sql).bind(...params).all<Row>()).results ?? [];
    } else if (q.op === "insert" || q.op === "upsert") {
      const list = (Array.isArray(q.values) ? q.values : [q.values ?? {}]).map((r) => withDefaults(table, r));
      if (!list.length) return { data: [], error: null };
      const stmts = list.map((r) => {
        const cols = Object.keys(r);
        let sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
        if (q.op === "upsert") {
          const conflict = (q.onConflict || "id").split(",").map((c) => checkCol(table, c.trim()));
          const updates = cols.filter((c) => !conflict.includes(c) && c !== "id" && c !== "created_at");
          sql += ` ON CONFLICT (${conflict.join(", ")}) DO ` +
            (updates.length ? `UPDATE SET ${updates.map((c) => `${c} = excluded.${c}`).join(", ")}` : "NOTHING");
        }
        return db.prepare(sql + " RETURNING *").bind(...cols.map((c) => r[c]));
      });
      const results = await db.batch<Row>(stmts);
      rows = results.flatMap((r) => r.results ?? []);
    } else if (q.op === "update") {
      if (!q.filters?.length) throw new BadRequest("Refusing to update every row");
      const patch = Object.entries(q.values as Row ?? {});
      if (!patch.length) throw new BadRequest("Nothing to update");
      if (TABLES[table].includes("updated_at") && !patch.some(([k]) => k === "updated_at")) patch.push(["updated_at", now()]);
      const set = patch.map(([k, v]) => { params.push(encode(k, v)); return `${checkCol(table, k)} = ?`; }).join(", ");
      const sql = `UPDATE ${table} SET ${set}` + whereClause(table, q.filters, params) + " RETURNING *";
      rows = (await db.prepare(sql).bind(...params).all<Row>()).results ?? [];
    } else if (q.op === "delete") {
      if (!q.filters?.length) throw new BadRequest("Refusing to delete every row");
      const sql = `DELETE FROM ${table}` + whereClause(table, q.filters, params) + " RETURNING id";
      rows = (await db.prepare(sql).bind(...params).all<Row>()).results ?? [];
    } else {
      throw new BadRequest("Unknown operation");
    }

    rows = rows.map(decodeRow);
    if (q.single || q.maybeSingle) {
      if (rows.length > 1) return { data: null, error: { message: "More than one row matched" } };
      if (!rows.length) return q.single ? { data: null, error: { message: "No rows found" } } : { data: null, error: null };
      return { data: rows[0], error: null };
    }
    const returnsRows = q.op === "select" || q.returning;
    return { data: returnsRows ? rows : null, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!(err instanceof BadRequest)) console.error("db:", msg);
    return { data: null, error: { message: msg.replace(/^D1_ERROR:\s*/, "") } };
  }
}

/** Find-or-create a client by email; returns the profile id. Used by the forms. */
export async function upsertProfile(
  db: D1Database,
  p: { email: string; firstName?: string; lastName?: string; phone?: string; country?: string },
): Promise<string> {
  const email = p.email.trim().toLowerCase();
  const row = await db.prepare(
    `INSERT INTO profiles (id, email, first_name, last_name, phone, country, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (email) DO UPDATE SET
       first_name = COALESCE(NULLIF(excluded.first_name, ''), profiles.first_name),
       last_name  = COALESCE(NULLIF(excluded.last_name, ''), profiles.last_name),
       phone      = COALESCE(NULLIF(excluded.phone, ''), profiles.phone),
       country    = COALESCE(NULLIF(excluded.country, ''), profiles.country),
       updated_at = excluded.updated_at
     RETURNING id`,
  ).bind(crypto.randomUUID(), email, p.firstName ?? "", p.lastName ?? "", p.phone ?? "", p.country ?? "", now(), now())
    .first<{ id: string }>();
  return row!.id;
}

/** Inserts one row with defaults filled; used by the forms and campaigns. */
export async function insertRow(db: D1Database, table: string, values: Row): Promise<void> {
  const r = withDefaults(table, values);
  const cols = Object.keys(r);
  await db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
    .bind(...cols.map((c) => r[c])).run();
}
