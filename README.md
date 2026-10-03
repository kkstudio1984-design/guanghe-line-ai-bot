# 光合 LINE AI 客服（第二階段 webhook）

客人在 LINE 問問題 → 這支程式查 Notion 知識庫（只用「已確認」的條目）→ 用光合語氣回覆。
答不出來就在知識庫新增草稿；需要談條件的就轉給真人，AI 對這位客人暫停。

## 運作方式

| 客人做了什麼 | 程式怎麼處理 |
|---|---|
| 加好友 | 在 Notion「LINE 客人」建一筆（歡迎訊息仍由 LINE 後台發） |
| 按圖文選單（送出「一樓場地」等字） | LINE 後台的關鍵字回應負責回，AI 不重複回，只記錄 |
| 問知識庫有的題目 | AI 用標準回答＋語氣指南回覆，該題「被問次數」+1 |
| 問到「需要轉真人」的題目、要找真人、抱怨 | AI 先收集資料，狀態改「待真人回覆」，AI 暫停 24 小時 |
| 問知識庫沒有的題目 | 回「我先確認一下再回你」，知識庫新增一筆草稿，狀態改「待真人回覆」 |
| 傳圖片、檔案（例如轉帳截圖） | 不回，狀態改「待真人回覆」 |
| AI 出錯 | 回「我請同事馬上回你」，狀態改「待真人回覆」 |

### 真人怎麼接手、怎麼交回 AI
到 Notion「💬 LINE 客人」找到這位客人：
- **接手**：狀態改成「真人接手中」（或在「暫停 AI 到」填一個時間）。之後在 LINE 官方帳號的聊天室直接回客人。
- **交回 AI**：狀態改回「AI 接待中」，並清掉「暫停 AI 到」。

> 注意：在 LINE 官方帳號後台聊天室打的字**不會**經過 webhook，所以無法用「#接手」這類指令暫停 AI，要到 Notion 改狀態。

## 部署步驟（約 30 分鐘）

### 1. LINE Developers
1. 到 https://developers.line.biz/ 登入，找到光合官方帳號對應的 **Messaging API channel**（沒有的話，在 LINE 官方帳號後台 → 設定 → Messaging API 啟用）。
2. 記下 **Channel secret**（Basic settings 頁）。
3. 在 Messaging API 頁產生 **Channel access token (long-lived)**，記下來。

### 2. Notion
1. 到 https://www.notion.so/profile/integrations 建立一個 Internal integration，命名「光合 LINE 客服」，記下 **token**。
2. 把這三個頁面都「連接」給這個 integration（頁面右上角 ⋯ → 連接）：
   - 💡 光合知識庫｜客人常見問題
   - 🗣️ 光合語氣指南｜LINE 客服怎麼說話
   - 💬 LINE 客人｜AI 客服對話紀錄
   （最簡單：直接連接上層的「📍 光合創學｜營運總部」，底下全部都會連到。）

### 3. Claude API
到 https://console.anthropic.com/ 建立 API key。預設用 Claude Haiku 4.5，一則問答成本很低。

### 4. 部署到 Vercel
二選一：
- **獨立部署（建議）**：把這個資料夾推到 GitHub 新 repo → Vercel 匯入 → 部署。
- **併入官網 sunlighthub-web**：把 `app/api/line/webhook/route.ts` 和 `lib/` 複製進官網專案（官網也要是 Next.js App Router，且 `@/` 指向專案根目錄）。

在 Vercel → Settings → Environment Variables 填入 `.env.example` 裡的變數（必填 4 個＋連結 4 個），然後 Redeploy。

### 5. 接上 LINE
1. 回 LINE Developers → Messaging API → **Webhook URL** 填：`https://你的網域/api/line/webhook`，按 Verify（應該顯示 Success），打開 **Use webhook**。
2. LINE 官方帳號後台 → 設定 → 回應設定：
   - 聊天：**開**（真人才能在聊天室回）
   - Webhook：**開**
   - 自動回應訊息：**開**（圖文選單的關鍵字回應要靠它）
   - 加入好友的歡迎訊息：**開**

### 6. 測試
用自己的手機傳：
- 「附近有什麼好吃的」→ 應該由 AI 回
- 「可以帶小朋友來嗎」→ AI 說會確認，知識庫多一筆草稿
- 「長期租可以便宜嗎」→ AI 收資料，Notion 狀態變「待真人回覆」
到 Notion「LINE 客人」看對話有沒有寫進去。

## 本機測試（不用任何金鑰）
```bash
npm install
npm run build
LINE_CHANNEL_SECRET=test DRY_RUN=1 MOCK_AI=1 FIXTURE_DIR=scripts/fixtures npx next start -p 3000
# 另開一個終端機
LINE_CHANNEL_SECRET=test npm run simulate
```

## 重要提醒
- **AI 只用「已確認」的條目**。現在知識庫大多還是草稿，上線前請先審核；否則 AI 多數問題都會說「我先確認一下」。
- 知識庫改了之後，最慢 **5 分鐘**生效（有快取）。
- `STAFF_NOTIFY_USER_IDS` 有填才會推播通知同仁，推播會算官方帳號的訊息則數。沒填就只看 Notion 的「待真人回覆」。
- 若之後在圖文選單新增按鈕，記得把那個字加進 `MENU_KEYWORDS`，避免 AI 和關鍵字回應重複回。
