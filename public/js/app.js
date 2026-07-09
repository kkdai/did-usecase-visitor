(function () {
  var stages = {};
  document.querySelectorAll('.stage').forEach(function (el) { stages[el.dataset.stage] = el; });

  var btn = document.getElementById('act');
  var walletLink = document.getElementById('walletLink');
  var qrImg = document.getElementById('qrImg');
  var qrTitle = document.getElementById('qrTitle');
  var qrSub = document.getElementById('qrSub');
  var spinner = document.getElementById('spinner');
  var verifyingTitle = document.getElementById('verifyingTitle');
  var endorsedByEl = document.getElementById('endorsedBy');
  var expiryEl = document.getElementById('expiry');
  var passQrWrap = document.getElementById('passQrWrap');
  var passNote = document.getElementById('passNote');
  var errTitle = document.getElementById('errTitle');
  var errSub = document.getElementById('errSub');
  var doorCountEl = document.getElementById('doorCount');
  var visCountEl = document.getElementById('visCount');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));

  var mode = 'door';
  var busy = false;
  var pollTimer = null;
  var doorCount = 0;
  var visCount = 0;

  var POLL_INTERVAL = 3000;
  var POLL_MAX = 40; // ~2 分鐘

  function show(name) {
    Object.keys(stages).forEach(function (k) { stages[k].classList.toggle('on', k === name); });
  }
  function stopPoll() { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } }

  function resetIdle() {
    stopPoll(); busy = false;
    btn.classList.toggle('gold', mode === 'visitor');
    btn.disabled = false;
    walletLink.style.display = 'none';
    if (mode === 'door') { show('idle-door'); btn.textContent = '🚪　員工刷卡進場'; }
    else { show('idle-visitor'); btn.textContent = '🤝　背書一位訪客'; }
  }

  function showError(title, sub) {
    stopPoll(); busy = false;
    walletLink.style.display = 'none';
    errTitle.textContent = title || '連線失敗';
    errSub.textContent = sub || '請稍後再試';
    show('error');
    btn.disabled = false;
    btn.textContent = '↺　重新開始';
  }

  async function start() {
    busy = true;
    btn.textContent = '✕　取消';
    btn.disabled = false;
    walletLink.style.display = 'none';
    qrTitle.textContent = mode === 'visitor' ? '請背書人出示員工卡' : '請出示員工卡';
    qrSub.textContent = '產生出示 QR 中…';
    show('qr');

    var resp;
    try {
      resp = await fetch('/api/access/qrcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: mode }),
      });
    } catch (e) {
      return showError('無法連線', '請檢查網路後重試');
    }
    if (!resp.ok) {
      var err = await resp.json().catch(function () { return {}; });
      return showError('產生 QR 失敗', err.message || err.error || ('HTTP ' + resp.status));
    }
    var data = await resp.json();
    if (data.qrcode) { qrImg.src = data.qrcode; }
    if (data.auth_uri) {
      walletLink.href = data.auth_uri;
      walletLink.style.display = 'block';
    }
    qrSub.textContent = '等待數位皮夾出示…';
    poll(data.transaction_id, 0);
  }

  function poll(tid, tries) {
    if (!busy) return;
    if (tries >= POLL_MAX) { return showError('出示逾時', '請重新產生 QR'); }
    pollTimer = setTimeout(async function () {
      var resp;
      try {
        resp = await fetch('/api/access/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transaction_id: tid }),
        });
      } catch (e) {
        return poll(tid, tries + 1);
      }
      if (resp.status === 404) { return showError('交易已失效', '請重新產生 QR'); }
      var data = await resp.json().catch(function () { return {}; });

      if (!data.verified) { return poll(tid, tries + 1); }

      // 驗證通過
      if (data.mode === 'door') {
        busy = false; stopPoll();
        walletLink.style.display = 'none';
        doorCount += 1; doorCountEl.textContent = doorCount;
        show('granted');
        btn.disabled = false; btn.textContent = '↺　再刷一次';
        return;
      }
      if (data.mode === 'visitor') {
        busy = false; stopPoll();
        walletLink.style.display = 'none';
        // 短暫顯示核發動畫
        spinner.classList.add('gold');
        verifyingTitle.textContent = '核發訪客通行證中…';
        show('verifying');
        btn.textContent = '核發中…'; btn.disabled = true;
        setTimeout(function () { renderPass(data.pass); }, 700);
        return;
      }
    }, POLL_INTERVAL);
  }

  function renderPass(pass) {
    pass = pass || {};
    endorsedByEl.textContent = '由' + (pass.endorsedBy || '員工') + '背書';
    expiryEl.textContent = pass.validUntilLabel || '--:--';
    if (pass.qrcode) {
      passQrWrap.innerHTML = '<img alt="訪客證 QR" src="' + pass.qrcode + '">';
    } else {
      passQrWrap.innerHTML = '<span class="ph">🎟️</span>';
    }
    passNote.textContent = pass.issued
      ? '訪客卡已核發至皮夾 · ' + (window.__ttl || 4) + ' 小時後自動失效'
      : '訪客卡待發（issuer 樣板未設定）· 驗證流程已完成';
    visCount += 1; visCountEl.textContent = visCount;
    show('pass');
    if (pass.deepLink) {
      walletLink.href = pass.deepLink;
      walletLink.textContent = '📲　訪客加入皮夾';
      walletLink.style.display = 'block';
    }
    btn.disabled = false; btn.textContent = '↺　再背書一位';
  }

  btn.addEventListener('click', function () {
    if (busy) { resetIdle(); return; }
    start();
  });

  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      tabs.forEach(function (x) { x.setAttribute('aria-selected', String(x === t)); });
      mode = t.dataset.mode;
      resetIdle();
    });
  });

  resetIdle();
})();
