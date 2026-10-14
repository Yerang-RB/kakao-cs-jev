"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fromView, OPS_GROUPS, toView } from "@/lib/ops";
import { usePatch } from "../Act";

export type Cat = {
  id: string;
  label: string;
  instructions: string;
  examples: string[];
  reply: string | null;
  auto: boolean;
  silent: boolean;
  sort: number;
};

const lines = (v: FormDataEntryValue | null) => String(v ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

// 오른쪽 편집 패널(c 없으면 새 카테고리). 분류 시험은 이 폼(form.cat)의 저장 전 값도 읽는다.
export function CategoryForm({ c }: { c?: Cat }) {
  const router = useRouter();
  const { patch, error, busy } = usePatch(`/api/categories/${c?.id}`);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="cat"
      data-id={c?.id}
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        const f = new FormData(e.currentTarget);
        const id = c?.id ?? String(f.get("id")).trim();
        const reply = String(f.get("reply") ?? "");
        const ok = await patch(
          {
            action: "upsert",
            label: String(f.get("label")),
            instructions: String(f.get("instructions")),
            examples: lines(f.get("examples")),
            reply: reply.trim() ? reply : null,
            auto: f.get("auto") === "on",
            silent: f.get("silent") === "on",
            sort: Number(f.get("sort")),
          },
          `/api/categories/${encodeURIComponent(id)}`,
        );
        if (ok) {
          setSaved(true);
          if (!c) router.push(`/settings?id=${encodeURIComponent(id)}`);
        }
      }}
    >
      <header className="d-head">
        <Link href="/settings" className="back">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>카테고리
        </Link>
        <div className="d-title"><h2>{c ? c.label : "새 카테고리"}</h2></div>
      </header>
      <div className="d-body">
        <div className="two">
          <label className="fld"><span>이름</span><input name="label" required maxLength={50} defaultValue={c?.label} /></label>
          <label className="fld"><span>순서</span><input name="sort" type="number" min={0} max={9999} required defaultValue={c?.sort ?? 0} /></label>
        </div>
        {c ? (
          <label className="fld"><span>ID</span><input value={c.id} readOnly className="ro" /><small>만든 뒤에는 바꿀 수 없습니다.</small></label>
        ) : (
          <label className="fld"><span>ID</span><input name="id" required pattern="[a-z][a-z0-9_]{1,31}" /><small>영문 소문자·숫자·_ 로 씁니다. 만든 뒤에는 바꿀 수 없습니다.</small></label>
        )}
        <label className="fld"><span>분류 기준</span><textarea name="instructions" rows={2} maxLength={500} defaultValue={c?.instructions} /></label>
        <label className="fld">
          <span>예상 질문</span>
          <textarea name="examples" rows={4} defaultValue={c?.examples.join("\n")} />
          <small>한 줄에 하나씩 적습니다. 분류 정확도에 가장 크게 영향을 줍니다.</small>
        </label>
        <label className="fld">
          <span>답변 템플릿</span>
          <textarea name="reply" rows={3} maxLength={2000} defaultValue={c?.reply ?? ""} />
          <small>비우면 자동응답하지 않습니다.</small>
        </label>
        <div className="toggles">
          <label>
            <span className="tx"><b>자동응답</b><span>확신도가 기준 이상이면 위 템플릿으로 바로 답합니다.</span></span>
            <input type="checkbox" name="auto" role="switch" defaultChecked={c?.auto} />
          </label>
          <label>
            <span className="tx"><b>무음</b><span>답장도 알림도 없이 처리 기록에만 남깁니다.<br />상담 큐에는 올라가지 않습니다.</span></span>
            <input type="checkbox" name="silent" role="switch" defaultChecked={c?.silent} />
          </label>
        </div>
      </div>
      <footer className="d-actions">
        {c && (
          <button
            type="button"
            className="ghost danger"
            disabled={busy}
            onClick={async () => {
              if (confirm(`「${c.label}」 카테고리를 삭제할까요?`) && (await patch({ action: "delete" }))) router.push("/settings");
            }}
          >
            삭제
          </button>
        )}
        {saved && <span className="muted" role="status">저장했습니다</span>}
        {error && <span className="error" role="alert">{error}</span>}
        <div className="buttons">
          <button type="submit" className="primary" disabled={busy}>{c ? "저장" : "추가"}</button>
        </div>
      </footer>
    </form>
  );
}

type Result = { category: string; probabilities: Record<string, number>; urgent: number; followup: number };

// 분류 시험: 저장된 카테고리 + 편집 패널의 저장 전 값(form.cat)으로 분류해 본다. 입력 문장은 저장하지 않는다.
export function Preview({ cats }: { cats: Cat[] }) {
  const { patch, error, busy } = usePatch("/api/classify-preview", "POST");
  const [res, setRes] = useState<{ r: Result; labels: Map<string, string> }>();
  return (
    <form
      className="tryit preview"
      onSubmit={async (e) => {
        e.preventDefault();
        const byId = new Map(cats.map((c) => [c.id, { id: c.id, label: c.label, instructions: c.instructions, examples: c.examples }]));
        for (const form of document.querySelectorAll<HTMLFormElement>("form.cat")) {
          const f = new FormData(form);
          const id = form.dataset.id || String(f.get("id") ?? "").trim();
          const label = String(f.get("label") ?? "").trim();
          if (id && label) byId.set(id, { id, label, instructions: String(f.get("instructions")), examples: lines(f.get("examples")) });
        }
        const categories = [...byId.values()];
        const r = await patch({ inquiry: String(new FormData(e.currentTarget).get("inquiry")), categories });
        if (r) setRes({ r, labels: new Map(categories.map((c) => [c.id, c.label])) });
      }}
    >
      <span className="lbl">분류 시험</span>
      <div className="in">
        <input name="inquiry" required maxLength={2000} placeholder="고객 문의 문장을 넣어 분류를 시험해 보세요" aria-label="미리보기 문장" />
        <button type="submit" disabled={busy}>{busy ? "분류 중…" : "분류해 보기"}</button>
      </div>
      {error && <span className="error" role="alert">{error}</span>}
      {res && (() => {
        const top = Object.entries(res.r.probabilities).sort((a, b) => b[1] - a[1]);
        const name = (id: string) => res.labels.get(id) ?? id;
        return (
          <p className="res" role="status">
            <span>결과 <b className="preview-label">{name(res.r.category)}</b>{top[0] && <b>{` ${Math.round(top[0][1] * 100)}%`}</b>}</span>
            {top.slice(1, 3).map(([id, p], i) => <span key={id}>{`${i + 2}위 ${name(id)} ${Math.round(p * 100)}%`}</span>)}
            <span>{`긴급 ${res.r.urgent.toFixed(2)}`}</span>
            <span>{`후속 ${res.r.followup.toFixed(2)}`}</span>
          </p>
        );
      })()}
    </form>
  );
}

// 운영 설정: 세 묶음, 단위 붙은 입력칸(%·초는 화면에서만 — lib/ops.ts). 바꾼 값이 있으면 아래 저장 막대.
export function OpsForm({ values }: { values: Record<string, string> }) {
  const { patch, error, busy } = usePatch("/api/settings");
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState<string[]>([]);
  const [bad, setBad] = useState("");
  const fields = OPS_GROUPS.flatMap((g) => g.fields);
  const initial = Object.fromEntries(fields.map((x) => [x.key, toView(x.unit, values[x.key] ?? "")]));
  const recount = (form: HTMLFormElement) => {
    const f = new FormData(form);
    setDirty(fields.filter((x) => String(f.get(x.key)).trim() !== initial[x.key]).map((x) => x.key));
  };
  return (
    <form
      className="ops"
      onInput={(e) => {
        setSaved(false);
        recount(e.currentTarget);
      }}
      onReset={() => {
        setDirty([]);
        setBad("");
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const body: Record<string, string> = {};
        for (const x of fields) {
          const v = fromView(x.unit, String(f.get(x.key)));
          if (v === null) return setBad(`${x.label}: 숫자로 적어 주세요`);
          body[x.key] = v;
        }
        setBad("");
        if (await patch(body)) {
          setSaved(true);
          setDirty([]);
        }
      }}
    >
      {OPS_GROUPS.map((g) => (
        <section key={g.title} className="group">
          <h3>{g.title}</h3>
          <p>{g.desc}</p>
          <div className="frows">
            {g.fields.map((x) => (
              <div key={x.key} className="frow">
                <label htmlFor={`ops-${x.key}`} className="k"><b>{x.label}</b><span>{x.hint}</span></label>
                <div className={dirty.includes(x.key) ? "uin changed" : "uin"}>
                  <input id={`ops-${x.key}`} name={x.key} required defaultValue={initial[x.key]} inputMode={x.unit ? "decimal" : undefined} />
                  {x.unit && <span className="u">{x.unit}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {saved && <p className="saved" role="status">저장했습니다</p>}
      {(dirty.length > 0 || bad || error) && (
        <div className="savebar">
          <span>{bad || error || `바꾼 값 ${dirty.length}개가 아직 저장되지 않았습니다`}</span>
          <button type="reset">되돌리기</button>
          <button type="submit" className="primary" disabled={busy}>저장</button>
        </div>
      )}
    </form>
  );
}

function TempPassword({ value }: { value: string }) {
  return (
    <p className="temp-password" role="status">
      임시 비밀번호: <code>{value}</code> — 이 화면을 닫으면 다시 볼 수 없습니다.
    </p>
  );
}

export function CreateUser() {
  const { patch, error, busy } = usePatch("/api/users", "POST");
  const [pw, setPw] = useState("");
  return (
    <form
      className="panel adduser"
      onSubmit={async (e) => {
        e.preventDefault();
        setPw("");
        const form = e.currentTarget;
        const f = new FormData(form);
        const r = await patch({ email: String(f.get("email")), name: String(f.get("name")), role: String(f.get("role")) });
        if (r) {
          setPw(r.password);
          form.reset();
        }
      }}
    >
      <h3>사용자 추가</h3>
      <div className="row3">
        <label className="fld"><span>이메일</span><input name="email" type="email" required maxLength={120} /></label>
        <label className="fld"><span>이름</span><input name="name" required maxLength={50} /></label>
        <label className="fld">
          <span>역할</span>
          <select name="role" defaultValue="agent">
            <option value="agent">상담원</option>
            <option value="admin">관리자</option>
          </select>
        </label>
        <button type="submit" className="primary" disabled={busy}>추가</button>
      </div>
      {error && <span className="error" role="alert">{error}</span>}
      {pw && <TempPassword value={pw} />}
    </form>
  );
}

// 행 끝 메뉴: 비활성화(확인)·활성화·비밀번호 초기화(확인). 임시 비밀번호는 메뉴 밖에 남긴다.
export function UserActions({ id, name, disabled }: { id: number; name: string; disabled: boolean }) {
  const { patch, error, busy } = usePatch(`/api/users/${id}`);
  const [pw, setPw] = useState("");
  const close = (e: React.MouseEvent) => e.currentTarget.closest("details")?.removeAttribute("open");
  return (
    <div className="uact">
      <details className="rowmenu">
        <summary aria-label={`${name} 메뉴`}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
        </summary>
        <div className="menu">
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              close(e);
              if (disabled || confirm(`${name} 계정을 비활성화할까요? 로그인이 바로 끊깁니다.`)) patch({ action: disabled ? "enable" : "disable" });
            }}
          >
            {disabled ? "활성화" : "비활성화"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async (e) => {
              close(e);
              if (!confirm(`${name}의 비밀번호를 초기화할까요?`)) return;
              const r = await patch({ action: "reset_password" });
              if (r) setPw(r.password);
            }}
          >
            비밀번호 초기화
          </button>
        </div>
      </details>
      {error && <span className="error" role="alert">{error}</span>}
      {pw && <TempPassword value={pw} />}
    </div>
  );
}

// 멈춘 방 「다시 시도」: 봇이 다음 폴링에 그 방을 다시 연다(열면 카카오에서 읽음 처리).
export function RetryRoom({ id }: { id: string }) {
  const { patch, error, busy } = usePatch(`/api/rooms/${encodeURIComponent(id)}`);
  return (
    <div className="uact">
      <button type="button" className="btn" disabled={busy} onClick={() => patch({ action: "retry" })}>다시 시도</button>
      {error && <span className="error" role="alert">{error}</span>}
    </div>
  );
}
