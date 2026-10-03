import { config } from "./config";

// 使用 Notion 2025-09-03 版 API（資料庫改用 data source）
const API = "https://api.notion.com/v1";
const VERSION = "2025-09-03";

export async function notion(path: string, body?: unknown, method = body ? "POST" : "GET") {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.notionToken()}`,
      "Notion-Version": VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Notion ${method} ${path} 失敗 ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

/** 查詢 data source（自動翻頁） */
export async function queryAll(dataSourceId: string, filter?: unknown): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion(`/data_sources/${dataSourceId}/query`, {
      ...(filter ? { filter } : {}),
      ...(cursor ? { start_cursor: cursor } : {}),
      page_size: 100,
    });
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

// ---- 讀屬性 ----
const joinText = (arr: any[] | undefined) => (arr ?? []).map((t) => t.plain_text).join("");

export function readProp(page: any, name: string): any {
  const p = page.properties?.[name];
  if (!p) return undefined;
  switch (p.type) {
    case "title": return joinText(p.title);
    case "rich_text": return joinText(p.rich_text);
    case "select": return p.select?.name ?? "";
    case "checkbox": return p.checkbox;
    case "number": return p.number;
    case "date": return p.date?.start ?? null;
    default: return undefined;
  }
}

// ---- 寫屬性 ----
const chunk = (s: string) => {
  // Notion 一段 rich_text 上限 2000 字
  const parts: { text: { content: string } }[] = [];
  for (let i = 0; i < s.length; i += 2000) parts.push({ text: { content: s.slice(i, i + 2000) } });
  return parts.length ? parts : [{ text: { content: "" } }];
};
export const P = {
  title: (s: string) => ({ title: chunk(s) }),
  text: (s: string) => ({ rich_text: chunk(s) }),
  select: (s: string) => ({ select: { name: s } }),
  checkbox: (b: boolean) => ({ checkbox: b }),
  number: (n: number) => ({ number: n }),
  date: (iso: string | null) => ({ date: iso ? { start: iso } : null }),
};

/** 把頁面內容攤平成純文字（給 AI 讀語氣指南用） */
export async function pageToText(pageId: string): Promise<string> {
  const lines: string[] = [];
  async function walk(blockId: string, depth: number) {
    let cursor: string | undefined;
    do {
      const res = await notion(
        `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`,
      );
      for (const b of res.results) {
        const v = b[b.type];
        let text = "";
        if (v?.rich_text) text = joinText(v.rich_text);
        if (b.type === "table_row") text = v.cells.map((c: any[]) => joinText(c)).join(" | ");
        if (b.type.startsWith("heading")) text = `## ${text}`;
        if (b.type === "bulleted_list_item" || b.type === "to_do") text = `- ${text}`;
        if (b.type === "quote") text = `> ${text}`;
        if (text) lines.push("  ".repeat(depth) + text);
        if (b.has_children && depth < 3) await walk(b.id, depth + 1);
      }
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);
  }
  await walk(pageId, 0);
  return lines.join("\n");
}
