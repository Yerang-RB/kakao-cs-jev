-- 자동응답 템플릿에 [빈칸]이 남은 카테고리는 자동응답을 끈다(리뷰 B14-b·O15). 봇은 어차피 보내지 않고(decide의 자리표시자 조건) 화면은 「자동응답」이라 표시돼 어긋났고,
-- 켠 채로는 라벨만 고쳐도 저장이 400이었다. 빈칸을 채운 뒤 관리자가 다시 켠다. 판정식은 src/template.ts PLACEHOLDER(/\[[^\]]+\]/)와 같다.
UPDATE categories SET auto = false WHERE auto AND reply ~ '\[[^]]+\]';
