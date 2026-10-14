// 분류 인터페이스. 구현(Jev · 임베딩 kNN · Haiku)은 이 시그니처 뒤에서 갈아 끼운다.
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { classifyWith, type Classification } from "./classify-core.js";
import { loadCategories } from "./config.js";
import { readEnv } from "./env.js";

export type { Classification };

export interface Classifier {
  classify(inquiry: string, context?: string): Promise<Classification>;
}

export class JevClassifier implements Classifier {
  private client = new TypeSafeClient({ apiKey: readEnv("typesafe.env").JEV_API_KEY });

  async classify(inquiry: string, context = ""): Promise<Classification> {
    return classifyWith(this.client, await loadCategories(), inquiry, context);
  }
}
