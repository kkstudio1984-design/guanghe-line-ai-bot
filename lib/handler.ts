import { config } from "./config";
import * as line from "./line";
import { getKnowledge, bumpAskedCount, createDraft } from "./kb";
import { findOrCreateCustomer, isAiPaused, appendHistory, saveCustomer, type Customer } from "./customers";
import { decideReply, isOfficeHours } from "./ai";

async function notifyStaff(c: Customer, reason: string, customerText: string) {
  const ids = config.staffNotifyUserIds();
  if (ids.length === 0) return; // 沒設定就只看 Notion 狀態
  const msg = `【光合 LINE｜需要真人】\n${c.name}：${reason}\n客人說：「${customerText.slice(0, 100)}」\n完整對話在 Notion「LINE 客人」`;
  await Promise.all(ids.map((id) => line.push(id, msg)));
}

export async function handleEvent(event: any): Promise<void> {
  const userId: string | undefined = event.source?.userId;
  if (!userId || event.source?.type !== "user") return; // 群組、聊天室先不處理

  const customer = await findOrCreateCustomer(userId, () => line.getDisplayName(userId));

  // 加好友：只建客人資料（歡迎訊息由 LINE 後台發）
  if (event.type === "follow") return;
  if (event.type !== "message") return;

  const msg = event.message;

  // 非文字（圖片、檔案、貼圖…）：記下來交給真人，可能是轉帳截圖
  if (msg.type !== "text") {
    const label = { image: "圖片", file: "檔案", sticker: "貼圖", video: "影片", audio: "語音", location: "位置" }[msg.type as string] ?? msg.type;
    appendHistory(customer, "客", `［${label}］`);
    // 貼圖不用處理；有串接官網時，圖片／檔案交給官網那支（例如收據記帳）
    if (msg.type === "sticker" || config.legacyHandlesMedia()) {
      await saveCustomer(customer, {});
      return;
    }
    await saveCustomer(customer, { status: "待真人回覆" });
    await notifyStaff(customer, `傳了${label}`, `［${label}］`);
    return;
  }

  const text: string = msg.text.trim();
  appendHistory(customer, "客", text);

  // 圖文選單的字：LINE 後台的關鍵字回應已經回了，AI 不重複回
  if (config.menuKeywords().includes(text)) {
    if (text === "找真人") {
      await saveCustomer(customer, { status: "待真人回覆", pauseHours: config.handoffPauseHours() });
      await notifyStaff(customer, "按了「找真人」", text);
    } else {
      await saveCustomer(customer, {});
    }
    return;
  }

  // 真人接手中：AI 不說話，只記錄
  if (isAiPaused(customer)) {
    await saveCustomer(customer, {});
    return;
  }

  await line.showLoading(userId).catch(() => {});

  try {
    const { entries, voice } = await getKnowledge();
    const d = await decideReply({
      entries,
      voice,
      customerName: customer.name,
      history: customer.history,
      previousSummary: customer.summary,
      text,
    });

    const sent = await line.reply(event.replyToken, d.messages);
    if (sent) {
      d.messages.forEach((m) => appendHistory(customer, "光合", m));
    } else {
      // reply token 已被用掉（多半是官網 webhook 先回了），AI 這則就不送
      appendHistory(customer, "光合", `（AI 未送出，可能已由官網系統回覆：${d.messages.join(" / ")}）`);
    }

    const used = entries.filter((e) => d.used_entry_ids.includes(e.id));
    await Promise.all(used.map((e) => bumpAskedCount(e).catch((err) => console.error(err))));

    if (d.action === "handoff") {
      await saveCustomer(customer, {
        status: "待真人回覆",
        pauseHours: config.handoffPauseHours(),
        summary: d.need_summary || undefined,
      });
      await notifyStaff(customer, d.handoff_reason || "需要真人回覆", text);
    } else if (d.action === "unknown") {
      await createDraft(text, d.draft_question).catch((err) => console.error(err));
      await saveCustomer(customer, { status: "待真人回覆", summary: d.need_summary || undefined });
      await notifyStaff(customer, `知識庫答不出來：${d.draft_question || text}`, text);
    } else {
      await saveCustomer(customer, { summary: d.need_summary || undefined });
    }
  } catch (err) {
    console.error("AI 回覆失敗", err);
    const fallback = isOfficeHours()
      ? "收到！我請同事馬上回你 🙏"
      : "收到！同事上班後（週一至週五 09:30 起）會盡快回你 🙏";
    await line.reply(event.replyToken, [fallback]).catch(() => {});
    appendHistory(customer, "光合", fallback);
    await saveCustomer(customer, { status: "待真人回覆" }).catch(() => {});
    await notifyStaff(customer, "AI 出錯，請直接回覆", text).catch(() => {});
  }
}
