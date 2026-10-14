# 보안 회수 런 마감 리뷰 발견 처리표 (작업 6)

`docs/review/security-recovery-review.md`의 F1~F11. 원장 R번호는 `PROGRESS.md` `## 리스크 원장`(발견 열 `보안회수 F<n>`).
커밋 열의 「작업 6」은 이 처리표와 같은 커밋이다.

| ID | 처리 | 무엇을 | 커밋·R번호 |
|---|---|---|---|
| F1 | 수정 | `src/handle.ts` 전송 실패 catch가 사람 큐 기록 뒤 Discord 알림 1회(「자동응답 전송 실패 — 사람 큐 — 오류 첫 줄」+ 방 URL) 후 throw. `test/handle.test.ts` 케이스 ⑥-2(알림 1회·다음 폴링 알림·전송 없음) | 작업 6 |
| F2 | 수정 | `web/lib/auth.ts` 되돌리기가 이메일 항목만 지운다(출처 축은 성공도 센다 — backend-quality 「성공은 per-identifier만 환급」). `web/test/auth-unit.test.ts` 케이스 추가(한 출처 성공 100회 뒤 429·compare 수 == 허용 수·다른 출처는 통과) | 작업 6 |
| F3 | 원장 | 익명화가 last_key를 비워 us 없는 방에서 옛 고객 메시지가 새 문의에 합쳐진다 — 해시 키 이행은 사람 결정. CLAUDE.md retention 줄에 부작용 명시 | R16 |
| F4 | 수정 | `web/app/api/change-password/route.ts`가 `sessions_valid_from = now()`도 올린다(응답의 새 쿠키는 등호 경계로 유효). `web/test/auth.test.ts` 케이스 추가(다른 옛 쿠키 401·307, 새 쿠키 200) | 작업 6 |
| F5 | 수정 | `web/test/auth.test.ts` 케이스 추가: 로그인 뒤 DB로 `must_change_password`를 켜면 다음 요청 /queue 307 → /change-password·API 403 `must_change_password`, 끄면 200(씨앗 S8 재현으로 붉음 확인) | 작업 6 |
| F6 | 원장 | 시드 판정의 봇 `decide` 불일치(자리표시자·followup·무음 K) — 데모 데이터. 낡은 `canAuto` 주석(`scripts/seed.ts`)과 CLAUDE.md seed 줄은 정정 | R19 |
| F7 | 원장 | 전역 버킷 제거로 크리덴셜 스터핑 총량 상한 소실, `cf-connecting-ip` 신뢰는 cloudflared 경유 전제 | R17 |
| F8 | 원장 | 로그아웃이 그 사용자의 모든 기기 쿠키를 끊는다(의도된 동작) | R18 |
| F9 | 원장 | `PLACEHOLDER`가 대괄호 안 글자를 모두 잡아 기본 auto 4종이 첫날 자동응답 0건·다른 필드 저장 400(의도된 L) | R20 |
| F10 | 수정 | `web/lib/kst.ts` `ROOM_URL` 주석 「src/handle.ts와 같은 값」, `web/test/auth-unit.test.ts` 「전역 상한」 제목을 「출처 상한」으로 | 작업 6 |
| F11 | 원장 | 「요청당 SELECT ≤ 3」에 기계 게이트 없음(코드 판독으로만 참) | R21 |
