// Jev 분류 수동 점검: npx tsx scripts/classify-test.ts "문의 문장"
import { JevClassifier } from "../src/classify.js";
const c = new JevClassifier();
for (const q of process.argv.slice(2)) console.log(q, "→", await c.classify(q));
