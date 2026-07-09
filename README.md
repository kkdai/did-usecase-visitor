# did-usecase-visitor

數位皮夾（MODA wallet.gov.tw）HR 檢驗方應用 **05 — 內部門禁 / 活動報名 + 訪客背書發證**。

這是 [`did-usecase-HR`](../did-usecase-HR) 的延伸專案，示範同時扮演 **檢驗方（Verifier / OIDVP）** 與 **發行方（Issuer / VCI）** 的完整 DID 生態鏈：

1. **員工門禁 / 報名**：員工用數位皮夾出示員工卡 → 驗證「持有有效員工卡」→ 開門 / 報名成功。
2. **訪客背書發證**：由在職員工出示員工卡背書 → 驗證通過後 → **核發一張帶到期時間的臨時訪客通行證**到訪客皮夾。

同樣的員工卡，只揭露「是不是有效員工」，姓名 / 生日 / 子女數等欄位一律留在皮夾內（選擇性揭露）。

## 架構

```
app.js              Express 進入點（靜態前端 + JSON API）
lib/wallet.js       數位皮夾沙盒 API helper（verifier 出示 / 取結果、issuer 發卡）
routes/index.js     API：/api/access/qrcode、/api/access/status、/api/stats
public/             前端（index.html + stylesheets + js），記憶體狀態、Cloud Run 友善
```

與原專案差異：改為「靜態前端 + JSON API」（原專案為 jade），驗卡邏輯抽成 `lib/wallet.js`，狀態改為記憶體儲存（避免原專案單檔 `record.js` 在 Cloud Run 上的寫入問題）。

## 環境變數

複製 `.env.example` 為 `.env` 並填入（可沿用 did-usecase-HR 的同帳號權杖）：

| 變數 | 說明 |
|------|------|
| `ISSUER_ACCESS_TOKEN` | 發行方存取權杖 |
| `VC_SERNUM` / `VC_UID` | 員工卡樣板（訪客樣板的 fallback） |
| `VISITOR_VC_SERNUM` / `VISITOR_VC_UID` | 訪客通行證樣板（未設定時回退為員工卡樣板） |
| `VERIFIER_ACCESS_TOKEN` | 驗證方存取權杖 |
| `VERIFIER_ACCESS_REF` | 驗證「持有員工卡」的 ref（未設定時回退為 `VERIFIER_SPORT_REF`） |
| `VISITOR_TTL_HOURS` | 訪客證有效時數（預設 4） |

> **落地待辦**：於發行後台建立「訪客通行證」VC 樣板取得專屬 `vcId / vcCid`，並於驗證後台建立門禁 / 背書專用的 verifier ref。在此之前，程式以既有樣板 / ref fallback 讓流程可跑。

## 本地執行

```bash
npm install
npm start          # http://localhost:8080
```

## 部署到 Cloud Run

```bash
gcloud run deploy did-usecase-visitor \
  --source=. --region=asia-east1 --platform=managed --allow-unauthenticated \
  --set-env-vars="VC_SERNUM=...,VC_UID=...,ISSUER_ACCESS_TOKEN=...,VERIFIER_SPORT_REF=...,VERIFIER_ACCESS_TOKEN=...,VISITOR_TTL_HOURS=4"
```
