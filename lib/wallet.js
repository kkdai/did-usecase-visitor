/**
 * 數位皮夾 (MODA wallet.gov.tw) 沙盒 API helper。
 *
 * 把原 did-usecase-HR 專案 routes/index.js 中重複的 issuer / verifier
 * https 呼叫抽成可重用函式，並統一逾時與錯誤處理。
 *
 *   Verifier (OIDVP)：issuer 出示請求 → 取結果
 *   Issuer   (VCI)  ：發行一張新的 VC
 */

const ISSUER_HOST = 'https://issuer-sandbox.wallet.gov.tw';
const VERIFIER_HOST = 'https://verifier-sandbox.wallet.gov.tw';

const VERIFIER_ACCESS_TOKEN = process.env.VERIFIER_ACCESS_TOKEN;
const ISSUER_ACCESS_TOKEN = process.env.ISSUER_ACCESS_TOKEN;

const DEFAULT_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 向驗證方要一個 OIDVP 出示 QR。
 * @param {string} ref  verifier 參考碼
 * @param {string} transactionId  自帶交易 id
 * @returns {Promise<{auth_uri:string, qrcode_image:string, transaction_id:string}>}
 */
async function requestPresentationQRCode(ref, transactionId) {
  const url = `${VERIFIER_HOST}/api/oidvp/qr-code?ref=${encodeURIComponent(ref)}&transaction_id=${encodeURIComponent(transactionId)}`;
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      accept: '*/*',
      'access-token': VERIFIER_ACCESS_TOKEN,
      'cache-control': 'no-cache',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`verifier qr-code ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = JSON.parse(text);
  if (!data.auth_uri || !data.qrcode_image) {
    throw new Error('verifier qr-code response missing auth_uri/qrcode_image');
  }
  return data;
}

/**
 * 輪詢一次 OIDVP 驗證結果。
 * @returns {Promise<{verified:boolean, claims:Array, raw:object}>}
 */
async function getPresentationResult(ref, transactionId) {
  const res = await fetchWithTimeout(`${VERIFIER_HOST}/api/oidvp/result`, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'access-token': VERIFIER_ACCESS_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ transactionId, ref }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`verifier result parse error: ${text.slice(0, 300)}`);
  }
  const verified = data.code === 0 && data.verify_result === true;
  const claims = verified && Array.isArray(data.data) && data.data[0] ? (data.data[0].claims || []) : [];
  // 未出示前驗證方會回 HTTP 400 + code 4002「verify result not found」，屬正常等待狀態
  const notFound = res.status === 400 && /4002|not found/i.test(text);
  return {
    verified,
    claims,
    httpStatus: res.status,
    notFound,
    debug: text.slice(0, 400),
    raw: data,
  };
}

/**
 * 發行一張 VC（此專案用於核發訪客通行證）。
 * @param {string} vcId    卡片序號
 * @param {string} vcCid   樣板代號
 * @param {Array}  fields  [{type, cname, ename, content}]
 * @returns {Promise<{ok:boolean, status:number, qrCode:?string, deepLink:?string, raw:object}>}
 */
async function issueCredential(vcId, vcCid, fields) {
  const res = await fetchWithTimeout(`${ISSUER_HOST}/api/vc-item-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: '*/*',
      'Access-Token': ISSUER_ACCESS_TOKEN,
    },
    body: JSON.stringify({ vcId, vcCid, fields }),
  });
  const text = await res.text();
  let raw = {};
  try {
    raw = text ? JSON.parse(text) : {};
  } catch (e) {
    raw = { _unparsed: text.slice(0, 300) };
  }
  // 沙盒回應欄位命名未定，盡量從常見鍵位取 QR / deeplink
  const qrCode = raw.qrCode || raw.qrcode_image || raw.qrcode || (raw.data && raw.data.qrCode) || null;
  const deepLink = raw.deepLink || raw.auth_uri || raw.deeplink || (raw.data && raw.data.deepLink) || null;
  return { ok: res.status === 201 || res.status === 200, status: res.status, qrCode, deepLink, raw };
}

module.exports = {
  requestPresentationQRCode,
  getPresentationResult,
  issueCredential,
};
