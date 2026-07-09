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

## 發卡運作方式（Option 1 vs Option 2）

訪客背書驗證通過後，會呼叫發行方 `POST /api/vc-item-data` 核發訪客卡；成功回應會帶
`qrCode`（領卡 QR）與 `deepLink`（皮夾領卡連結），前端即以此讓訪客掃碼加入皮夾。

程式依 `VISITOR_VC_SERNUM` / `VISITOR_VC_UID` 是否設定，自動切換兩種模式（見
`routes/index.js` 的 `HAS_VISITOR_TEMPLATE`）：

| 模式 | 條件 | 行為 | 卡面 |
|------|------|------|------|
| **Option 1（fallback）** | 未設 `VISITOR_VC_*` | 借用員工卡樣板，把訪客資訊塞進其必填欄位（姓名=「臨時訪客」等）發卡 | 顯示為員工卡卡面（例：連線小學堂），內容為訪客 |
| **Option 2（正規）** | 已設 `VISITOR_VC_*` | 送訪客欄位 `visitor_type / endorsed_by / valid_until` 至專屬樣板 | 正規「訪客通行證」卡面 |

> ⚠️ 若用員工樣板送訪客欄位會被發行方以「必填欄位不符」拒絕（HTTP 500 / 400），
> 所以 Option 1 才改送員工樣板的必填欄位。要正規卡面就走 Option 2。

## Option 2：建立正規「訪客通行證」樣板

一次性後台設定，完成後不需改任何程式碼，只要設環境變數重新部署即可。

### 1. 在發行後台建立 VC 樣板

1. 登入發行後台 <https://issuer-sandbox.wallet.gov.tw/>
2. 建立新卡片樣板，命名「訪客通行證」，上傳卡面圖
3. **定義欄位（`ename` 必須與程式一致）**：

   | `ename` | `cname`（顯示名） | `type` | 範例值 |
   |---------|------------------|--------|--------|
   | `visitor_type` | 訪客類別 | CUSTOM | 一般訪客 |
   | `endorsed_by` | 背書員工 | CUSTOM | EMP-1A2B |
   | `valid_until` | 有效至 | CUSTOM | 2026-07-09T18:40:00Z |

   > 這三個 `ename` 對應 `routes/index.js` 中 `HAS_VISITOR_TEMPLATE` 分支送出的欄位；
   > 若要增減欄位，兩邊要一起改。

4. 進卡片詳細資料，取得**卡片序號 `vcId`** 與**樣板代號 `vcCid`**

### 2. 設定環境變數並重新部署

```bash
gcloud run deploy did-usecase-visitor \
  --source=. --region=asia-east1 --platform=managed --allow-unauthenticated \
  --set-env-vars="VC_SERNUM=607861,VC_UID=0028680530_line_school,\
ISSUER_ACCESS_TOKEN=...,VERIFIER_SPORT_REF=...,VERIFIER_ACCESS_TOKEN=...,\
VISITOR_VC_SERNUM=<新樣板 vcId>,VISITOR_VC_UID=<新樣板 vcCid>,VISITOR_TTL_HOURS=4"
```

部署後 `HAS_VISITOR_TEMPLATE` 會變 true，訪客背書即改用正規訪客樣板發卡。

### 3. 關於「限時自動失效」

透過 `/api/vc-item-data` 發卡，卡片實際有效期**跟隨樣板設定**，無法逐張指定
「4 小時後過期」。因此：

- 卡面上的「有效至 HH:MM」是**應用層顯示值**（由 `VISITOR_TTL_HOURS` 計算），
  非皮夾強制到期。
- 要真正短效訪客證：建立樣板時把**有效期設短**，或改用平台的**排程撤銷（revoke）**
  機制——發卡回應含 `clearScheduleId`、`scheduleRevokeMessage` 欄位，暗示支援排程撤銷，
  但需另外串接對應 API。

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
