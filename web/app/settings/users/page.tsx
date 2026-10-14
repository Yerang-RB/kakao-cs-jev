import { USER_COLS } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireAdmin } from "../../me";
import { CreateUser, UserActions } from "../forms";

type User = { id: number; email: string; name: string; role: "admin" | "agent"; must_change_password: boolean; disabled: boolean };

export default async function UsersPage() {
  await requireAdmin();
  const { rows } = await db().query<User>(`SELECT ${USER_COLS} FROM users ORDER BY id`);
  return (
    <div className="spage">
      <div className="shead"><h2>사용자</h2><span className="cnt">{`${rows.length}명`}</span></div>
      <div className="table-wrap">
        <table className="log users">
          <thead>
            <tr><th>이름</th><th>이메일</th><th>역할</th><th>상태</th><th><span className="sr">메뉴</span></th></tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} data-id={u.id}>
                <td><b>{u.name}</b></td>
                <td>{u.email}</td>
                <td><span className={u.role === "admin" ? "mode auto" : "mode human"}>{u.role === "admin" ? "관리자" : "상담원"}</span></td>
                <td className={u.disabled ? "muted" : undefined}>
                  {u.disabled ? "비활성" : u.must_change_password ? "비밀번호 변경 대기" : "활성"}
                </td>
                <td className="act"><UserActions id={u.id} name={u.name} disabled={u.disabled} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CreateUser />
    </div>
  );
}
