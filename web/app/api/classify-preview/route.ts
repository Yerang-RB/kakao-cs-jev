import { TypeSafeClient } from "@typesafe-ai/sdk";
import { z } from "zod";
import { adminFrom, err, notAllowed, PREVIEW_LIMIT, withJson } from "@/lib/http";
import { classifyWith } from "../../../../src/classify-core.js";
import { readEnv } from "../../../../src/env.js";
import { mask } from "../../../../src/mask.js";

const Body = z
  .object({
    inquiry: z.string().min(1).max(2000),
    context: z.string().max(2000).optional(),
    categories: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
            label: z.string().min(1).max(50),
            instructions: z.string().max(500),
            examples: z.array(z.string().max(200)).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();

// 첫 요청에 1회 만든다(빌드가 라우트 모듈을 읽어도 키 파일을 찾지 않게). TYPESAFE_BASE_URL은 SDK가 환경에서 읽는다.
let client: TypeSafeClient | undefined;
const jev = () => (client ??= new TypeSafeClient({ apiKey: readEnv("typesafe.env").JEV_API_KEY }));

// 저장 전 폼 값으로 분류해 본다. Jev로 나가는 텍스트는 mask, 입력 문장은 DB·감사·로그 어디에도 남기지 않는다.
export const POST = withJson(Body, async (b, req) => {
  const s = await adminFrom(req);
  if (s instanceof Response) return s;
  try {
    const c = await classifyWith(jev(), b.categories, mask(b.inquiry), mask(b.context ?? ""));
    return Response.json({ category: c.category, probabilities: c.probabilities, confidence: c.confidence, urgent: c.urgent, followup: c.followup });
  } catch {
    return err("upstream", 502, "분류 서버 호출에 실패했습니다");
  }
}, PREVIEW_LIMIT);

export { notAllowed as GET, notAllowed as PATCH, notAllowed as PUT, notAllowed as DELETE };
