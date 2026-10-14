// 차트 색. 값은 globals.css :root 토큰(라이트·다크 각각)에 있고 여기서는 이름만 건넨다.
// 카테고리 막대는 단색(2026-09-29 사용자 결정 — 카테고리별 고정 색 폐기): 상위 3개 var(--accent), 나머지 BAR_REST.
export const BAR_REST = "var(--bar-rest)";

// 히트맵 sequential blue 5단(0건은 --surface).
export const HEAT = [1, 2, 3, 4, 5].map((i) => `var(--heat-${i})`);
