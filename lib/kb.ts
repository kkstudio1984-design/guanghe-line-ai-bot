import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { notion, queryAll, readProp, P, pageToText } from "./notion";

export type KbEntry = {
  id: string;
  question: string;
  aliases: string;
  answer: string;
  category: string;
  needsHuman: boolean;
  askedCount: number;
};

const CACHE_MS = 5 * 60 * 1000; // 知識庫改了，最慢 5 分鐘後生效
let cache: { at: number; entries: KbEntry[]; voice: string } | null = null;

function fixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(config.fixtureDir(), name), "utf8"));
}

/** 讀知識庫（只讀「已確認」）＋語氣指南 */
export async function getKnowledge(): Promise<{ entries: KbEntry[]; voice: string }> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;

  if (config.fixtureDir()) {
    const entries = fixture<KbEntry[]>("kb.json");
    const voice = fs.readFileSync(path.join(config.fixtureDir(), "voice.md"), "utf8");
    cache = { at: Date.now(), entries, voice };
    return cache;
  }

  const [pages, voice] = await Promise.all([
    queryAll(config.kbDataSourceId(), {
      property: "狀態",
      select: { equals: "已確認" },
    }),
    pageToText(config.voiceGuidePageId()).catch((e) => {
      console.error("讀語氣指南失敗，先用空白", e);
      return "";
    }),
  ]);

  const entries: KbEntry[] = pages.map((p) => ({
    id: p.id,
    question: readProp(p, "標準問題") ?? "",
    aliases: readProp(p, "其他問法") ?? "",
    answer: readProp(p, "標準回答") ?? "",
    category: readProp(p, "分類") ?? "",
    needsHuman: !!readProp(p, "需要轉真人"),
    askedCount: readProp(p, "被問次數") ?? 0,
  }));

  cache = { at: Date.now(), entries, voice };
  return cache;
}

/** 被問到的題目「被問次數」+1 */
export async function bumpAskedCount(entry: KbEntry) {
  entry.askedCount += 1; // 先改快取，避免短時間內重複讀舊值
  if (config.fixtureDir()) {
    console.log(`[FIXTURE] 被問次數 +1：${entry.question} → ${entry.askedCount}`);
    return;
  }
  await notion(`/pages/${entry.id}`, { properties: { 被問次數: P.number(entry.askedCount) } }, "PATCH");
}

/** 答不出來的問題，新增一筆草稿到知識庫 */
export async function createDraft(customerText: string, suggestedQuestion: string) {
  if (config.fixtureDir()) {
    console.log(`[FIXTURE] 新增知識庫草稿：${suggestedQuestion}｜客人原話：${customerText}`);
    return;
  }
  await notion("/pages", {
    parent: { type: "data_source_id", data_source_id: config.kbDataSourceId() },
    properties: {
      標準問題: P.title(suggestedQuestion || customerText.slice(0, 80)),
      客戶原問題: P.text(customerText),
      狀態: P.select("草稿"),
      依據: P.text("LINE AI 客服答不出來，自動新增。請補上標準回答後改為已確認。"),
      被問次數: P.number(1),
    },
  });
}
