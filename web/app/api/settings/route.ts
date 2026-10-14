import { z } from "zod";
import { tx } from "@/lib/db";
import { adminFrom, notAllowed, withJson } from "@/lib/http";

// settings 값은 text라 문자열로 받고 키마다 범위를 잰다(원장 R6).
const int = (min: number, max: number) =>
  z.string().regex(/^\d{1,9}$/).refine((v) => +v >= min && +v <= max);
const unit = z.string().regex(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/);

const Body = z
  .object({
    auto_min_conf: unit,
    followup_max: unit,
    quiet_ms: int(5000, 600000),
    interval_ms: int(5000, 300000),
    retention_days: int(1, 3650),
    business_hours: z.string().regex(/^\d\d:\d\d-\d\d:\d\d$/),
    web_base_url: z.url({ protocol: /^https?$/ }).max(200),
  })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0);

// 한 트랜잭션: 바뀐 키만 upsert하고 키마다 audit setting_set {key, prev}. 범위 밖은 withJson이 400(아무것도 안 바뀜).
export const PATCH = withJson(Body, async (b, req) => {
  const s = await adminFrom(req);
  if (s instanceof Response) return s;
  return tx(async (c) => {
    for (const [key, value] of Object.entries(b) as [string, string][]) {
      const prev: string | null = (await c.query("SELECT value FROM settings WHERE key = $1 FOR UPDATE", [key])).rows[0]?.value ?? null;
      if (prev === value) continue;
      await c.query("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2", [key, value]);
      await c.query("INSERT INTO audit_log (user_id, action, target, detail) VALUES ($1, 'setting_set', $2, $3)", [s.uid, key, { key, prev }]);
    }
    const rows = (await c.query<{ key: string; value: string }>("SELECT key, value FROM settings")).rows;
    return Response.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  });
});

export { notAllowed as GET, notAllowed as POST, notAllowed as PUT, notAllowed as DELETE };
