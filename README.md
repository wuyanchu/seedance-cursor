# 香港法律 AI 問答網站（繁體中文）

這是一個可直接部署的香港法律 AI 問答網站。使用者可用繁體中文提問香港法律問題，系統會透過 AI 回覆法律重點、分析與下一步建議；同時提供律師名冊分頁，支援搜尋、法律範疇分類與評論功能。

> 注意：本系統僅供資訊參考，並非正式法律意見。

## 功能

- 繁體中文聊天介面
- 香港法律情境化 AI 提示詞（僱傭、租務、公司、民刑事等）
- 支援多輪對話（保留最近對話脈絡）
- 未設定 API 金鑰時，會提示管理員如何設定
- 律師名冊分頁（`/lawyers.html`）：
  - 以律師姓名（中/英）或律師行名稱即時搜尋
  - 按法律範疇分類瀏覽（離婚、刑事、物業買賣等）
  - 用戶可註冊 / 登入後撰寫評論

## 需求

- Node.js 18+（建議 LTS）
- 任一 AI 金鑰：
  - DeepSeek（`DEEPSEEK_API_KEY`，建議）
  - 或 OpenAI 相容（`OPENAI_API_KEY`）

## 安裝與啟動

```bash
npm install
cp .env.example .env
# 編輯 .env，填入 DEEPSEEK_API_KEY（或 OPENAI_API_KEY）
npm start
```

啟動後開啟：

`http://localhost:3000`

律師名冊頁面：

`http://localhost:3000/lawyers.html`

## 環境變數

### DeepSeek（建議）

- `DEEPSEEK_API_KEY`：必填（若使用 DeepSeek）
- `DEEPSEEK_MODEL`：選填，預設 `deepseek-chat`
- `DEEPSEEK_BASE_URL`：選填，預設 `https://api.deepseek.com/v1`

### OpenAI（可選）

- `OPENAI_API_KEY`：必填（若使用 OpenAI）
- `OPENAI_MODEL`：選填，預設 `gpt-4.1-mini`
- `OPENAI_BASE_URL`：選填，自訂相容 API 基底網址

### 其他

- `PORT`：選填，預設 `3000`

## API

### `POST /api/ask`

請求：

```json
{
  "question": "僱主可以無通知金即時解僱嗎？",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

回應：

```json
{
  "answer": "AI 回答內容..."
}
```

### `GET /api/law-categories`

取得所有可用法律範疇分類。

### `GET /api/lawyers?query=&category=&page=&pageSize=`

搜尋或篩選律師名冊。

- `query`：律師姓名（中/英）或律師行關鍵字
- `category`：法律範疇（例如 `離婚及家庭`）
- `page`：頁碼，預設 `1`
- `pageSize`：每頁筆數，預設 `12`

### `GET /api/lawyers/:lawyerId`

取得單一律師詳細資料與平均評分。

### `GET /api/lawyers/:lawyerId/reviews`

取得指定律師的評論列表。

### `POST /api/lawyers/:lawyerId/reviews`

提交或更新評論（需登入，Bearer Token）。

請求：

```json
{
  "rating": 5,
  "comment": "律師回覆迅速，文件準備完整，流程解釋清晰。"
}
```

### `POST /api/auth/register`

用戶註冊並取得登入 token。

### `POST /api/auth/login`

用戶登入並取得登入 token。

### `GET /api/auth/me`

取得目前登入用戶資訊（需 Bearer Token）。

## 名冊資料說明

- 律師名冊資料檔：`data/lawyers.json`
- 用戶資料檔：`data/users.json`
- 評論資料檔：`data/reviews.json`

你可將 `data/lawyers.json` 按香港律師會公開名冊來源持續更新，以提供更完整的搜尋與分類結果。
