import Tabs from "./Tabs";

// 설정 세 페이지 공통 틀: 왼쪽 설정 메뉴 + 내용. admin 검사는 각 페이지(requireAdmin)와 프록시가 한다.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="setv">
      <Tabs />
      <div className="scont">{children}</div>
    </div>
  );
}
