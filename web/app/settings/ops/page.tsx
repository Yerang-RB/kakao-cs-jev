import { db } from "@/lib/db";
import { kst, ROOM_URL } from "@/lib/kst";
import { requireAdmin } from "../../me";
import { OpsForm, RetryRoom } from "../forms";

type Stuck = { room_id: string; errors: number; updated_at: Date };

export default async function OpsPage() {
  await requireAdmin();
  const { rows } = await db().query<{ key: string; value: string }>("SELECT key, value FROM settings");
  // cs_web은 rooms의 이 네 열만 읽을 수 있다(마이그레이션 010) — 고객 닉네임은 화면에 안 나온다.
  const stuck = (await db().query<Stuck>("SELECT room_id, errors, updated_at FROM rooms WHERE status = 'error' ORDER BY updated_at DESC")).rows;
  return (
    <div className="spage">
      <section className="stuck" aria-label="멈춘 방">
        <div className="shead"><h2>멈춘 방</h2><span className="cnt">{`${stuck.length}개`}</span></div>
        <p className="muted">봇이 3번 연달아 읽지 못해 건너뛰는 방입니다.<br />카카오에서 방을 확인한 뒤 「다시 시도」를 누르면 다음 확인 때 봇이 다시 엽니다.</p>
        {stuck.length > 0 && (
          <div className="table-wrap">
            <table className="log users">
              <thead><tr><th>방</th><th>실패</th><th>멈춘 시각</th><th><span className="sr">동작</span></th></tr></thead>
              <tbody>
                {stuck.map((r) => (
                  <tr key={r.room_id} data-id={r.room_id}>
                    <td><a href={ROOM_URL + r.room_id} target="_blank" rel="noopener noreferrer">{`방 …${r.room_id.slice(-4)}`}</a></td>
                    <td>{`${r.errors}회`}</td>
                    <td>{kst(r.updated_at)}</td>
                    <td className="act"><RetryRoom id={r.room_id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="shead"><h2>운영 설정</h2></div>
      <OpsForm values={Object.fromEntries(rows.map((r) => [r.key, r.value]))} />
    </div>
  );
}
