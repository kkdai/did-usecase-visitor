const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const wallet = require('../lib/wallet');

// ---- 設定 ----
// 驗證「持有有效員工卡」用的 verifier 參考碼。
// TODO: 於驗證後台建立專用的門禁 / 背書用 ref（例如 0028680530_vp_access），
//       目前預設沿用既有的 ref 以便 demo 立即可跑。
const VERIFIER_ACCESS_REF = process.env.VERIFIER_ACCESS_REF || process.env.VERIFIER_SPORT_REF;

// 訪客通行證的 issuer 樣板。
// TODO: 於發行後台建立「訪客通行證」樣板取得專屬 vcId / vcCid；
//       未設定時回退為員工卡樣板，讓核發流程於 demo 仍可觸發。
const VISITOR_VC_SERNUM = process.env.VISITOR_VC_SERNUM || process.env.VC_SERNUM;
const VISITOR_VC_UID = process.env.VISITOR_VC_UID || process.env.VC_UID;
// 是否已設定專屬「訪客通行證」樣板；否則回退為員工樣板並改用其必填欄位承載訪客資訊
const HAS_VISITOR_TEMPLATE = !!(process.env.VISITOR_VC_SERNUM && process.env.VISITOR_VC_UID);

const VISITOR_TTL_HOURS = Number(process.env.VISITOR_TTL_HOURS || 4);
const PENDING_TTL_MS = 30 * 60 * 1000; // 30 分鐘

// ---- 記憶體狀態（Cloud Run 友善，重啟歸零）----
const store = {
  door_count: 0,
  visitor_count: 0,
  pending: {}, // transactionId -> { mode, ts }
  visitors: [], // 最近核發的訪客證（匿名）
};

function prunePending() {
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [tid, p] of Object.entries(store.pending)) {
    if (p.ts < cutoff) delete store.pending[tid];
  }
}

function shortToken() {
  return Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

// 健康檢查 / 狀態
router.get('/api/stats', (req, res) => {
  res.json({
    door_count: store.door_count,
    visitor_count: store.visitor_count,
    recent_visitors: store.visitors.slice(0, 6),
  });
});

/**
 * 產生一次性出示 QR（員工出示員工卡）。
 * body: { mode: 'door' | 'visitor' }
 */
router.post('/api/access/qrcode', async (req, res) => {
  const mode = req.body.mode;
  if (mode !== 'door' && mode !== 'visitor') {
    return res.status(400).json({ error: 'invalid_mode' });
  }
  if (!VERIFIER_ACCESS_REF) {
    return res.status(500).json({ error: 'missing_verifier_ref' });
  }
  const transactionId = uuidv4();
  try {
    const data = await wallet.requestPresentationQRCode(VERIFIER_ACCESS_REF, transactionId);
    prunePending();
    store.pending[transactionId] = { mode, ts: Date.now() };
    res.json({
      transaction_id: transactionId,
      qrcode: data.qrcode_image,
      auth_uri: data.auth_uri,
    });
  } catch (err) {
    console.error('[access/qrcode]', err.message);
    res.status(502).json({ error: 'verifier_qr_failed', message: err.message });
  }
});

/**
 * 輪詢驗證結果；門禁 → 記錄；訪客 → 驗證後核發訪客通行證。
 * body: { transaction_id }
 */
router.post('/api/access/status', async (req, res) => {
  const transactionId = req.body.transaction_id;
  const pending = transactionId && store.pending[transactionId];
  if (!pending) {
    return res.status(404).json({ error: 'unknown_transaction' });
  }

  let result;
  try {
    result = await wallet.getPresentationResult(VERIFIER_ACCESS_REF, transactionId);
  } catch (err) {
    console.error('[access/status] verifier error:', err.message);
    return res.json({ verified: false, status: 'pending' });
  }

  // 診斷：非「尚未出示(4002)」的回應都印出來，方便查驗證方實際回傳
  if (!result.notFound) {
    console.log(`[access/status] tid=${transactionId} mode=${pending.mode} http=${result.httpStatus} verified=${result.verified} raw=${result.debug}`);
  }

  if (!result.verified) {
    return res.json({ verified: false, status: 'pending' });
  }

  // 驗證通過
  delete store.pending[transactionId];

  if (pending.mode === 'door') {
    store.door_count += 1;
    return res.json({ verified: true, mode: 'door' });
  }

  // 訪客背書 → 核發訪客通行證
  const endorsedBy = shortToken();
  const now = new Date();
  const validUntil = new Date(now.getTime() + VISITOR_TTL_HOURS * 3600 * 1000);
  const validUntilDate = validUntil.toISOString().slice(0, 10); // YYYY-MM-DD

  // 依是否有專屬訪客樣板，決定送出的欄位
  const fields = HAS_VISITOR_TEMPLATE
    ? [
        { type: 'CUSTOM', cname: '訪客類別', ename: 'visitor_type', content: '一般訪客' },
        { type: 'CUSTOM', cname: '背書員工', ename: 'endorsed_by', content: `EMP-${endorsedBy}` },
        { type: 'CUSTOM', cname: '有效至', ename: 'valid_until', content: validUntil.toISOString() },
      ]
    : // 回退：用員工樣板必填欄位承載訪客資訊，讓真實卡片仍可發出
      [
        { type: 'NORMAL', cname: '姓名', ename: 'name', content: '臨時訪客' },
        { type: 'CUSTOM', cname: '英文名字', ename: 'english_name', content: 'VISITOR' },
        { type: 'NORMAL', cname: '民國出生年月日', ename: 'roc_birthday', content: '0000000' },
        { type: 'CUSTOM', cname: '入職時間', ename: 'join_company', content: validUntilDate },
        { type: 'CUSTOM', cname: '幾個小孩', ename: 'num_children', content: '0000000' },
      ];

  let issue = { ok: false, qrCode: null, deepLink: null };
  try {
    issue = await wallet.issueCredential(VISITOR_VC_SERNUM, VISITOR_VC_UID, fields);
    console.log(`[access/status] issue tid=${transactionId} template=${HAS_VISITOR_TEMPLATE ? 'visitor' : 'employee-fallback'} http=${issue.status} ok=${issue.ok} hasQR=${!!issue.qrCode}`);
  } catch (err) {
    console.error('[access/status] issue error:', err.message);
  }

  store.visitor_count += 1;
  const entry = {
    endorsedBy: `EMP-${endorsedBy}`,
    validUntil: validUntil.toISOString(),
    issued: issue.ok,
    ts: now.toISOString(),
  };
  store.visitors.unshift(entry);
  store.visitors = store.visitors.slice(0, 20);

  res.json({
    verified: true,
    mode: 'visitor',
    pass: {
      endorsedBy: entry.endorsedBy,
      validUntil: entry.validUntil,
      validUntilLabel: `${String(validUntil.getHours()).padStart(2, '0')}:${String(validUntil.getMinutes()).padStart(2, '0')}`,
      qrcode: issue.qrCode,
      deepLink: issue.deepLink,
      issued: issue.ok,
    },
  });
});

module.exports = router;
