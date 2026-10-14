// 카테고리·설정은 DB가 정본(web에서 바뀐다). 60초 캐시.
import { db } from "./store.js";

export interface Category { id: string; label: string; instructions: string; examples: string[]; reply: string | null; auto: boolean; silent: boolean }

export interface Settings {
  auto_min_conf: number; followup_max: number; quiet_ms: number; interval_ms: number;
  business_hours: string; retention_days: number; web_base_url: string;
}

const TTL = 60_000;
function cached<T>(load: () => Promise<T>): () => Promise<T> {
  let at = 0;
  let value: T;
  return async () => {
    if (Date.now() - at >= TTL) {
      value = await load();
      at = Date.now();
    }
    return value;
  };
}

export const loadCategories = cached(async () =>
  (await db().query<Category>("SELECT id, label, instructions, examples, reply, auto, silent FROM categories ORDER BY sort, id")).rows);

export const loadSettings = cached(async (): Promise<Settings> => {
  const s = Object.fromEntries((await db().query<{ key: string; value: string }>("SELECT key, value FROM settings")).rows.map((r) => [r.key, r.value]));
  return {
    auto_min_conf: Number(s.auto_min_conf), followup_max: Number(s.followup_max),
    quiet_ms: Number(s.quiet_ms), interval_ms: Number(s.interval_ms),
    business_hours: s.business_hours, retention_days: Number(s.retention_days),
    web_base_url: s.web_base_url,
  };
});
