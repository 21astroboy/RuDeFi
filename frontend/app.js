// Surface any runtime error that would otherwise silently halt the rest
  // of the script — without this, a single ReferenceError early on bricks
  // gas refresh, wallet restore, yield refresh, etc.
  window.addEventListener('error', (ev) => {
    console.error('[RuDeFi] script error:', ev.error || ev.message);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    console.error('[RuDeFi] unhandled rejection:', ev.reason);
  });

  const API_BASE = location.origin === 'null' || !location.origin
    ? 'http://127.0.0.1:8787'
    : location.origin;

  const $ = (id) => document.getElementById(id);

  function fmtMoney(v, currency) {
    if (v == null || isNaN(v)) return '—';
    const opts = currency === 'USD'
      ? { style: 'currency', currency: 'USD', maximumFractionDigits: v < 1 ? 4 : 2 }
      : currency === 'RUB'
        ? { style: 'currency', currency: 'RUB', maximumFractionDigits: v < 1 ? 4 : 2 }
        : { maximumFractionDigits: 6 };
    try { return new Intl.NumberFormat('ru-RU', opts).format(v); }
    catch (e) { return String(v); }
  }
  function fmtNumber(v, max=6) {
    if (v == null) return '—';
    const n = typeof v === 'string' ? Number(v) : v;
    if (isNaN(n)) return v;
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: max }).format(n);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[c]));
  }

  // Warnings often arrive as concatenated JSON-RPC error dumps. Pull out a
  // short human summary, keep the full payload available behind a <details>.
  function formatWarning(raw) {
    const s = String(raw);
    // Try to peel the leading "[chain] context: " prefix.
    const m = s.match(/^(\[[^\]]+\][^:]*:)\s*(.*)$/s);
    const prefix = m ? m[1] : '';
    let rest = m ? m[2] : s;

    // If the rest is (or contains) a JSON RPC error object, extract `.message`.
    let summary = rest;
    const jsonStart = rest.indexOf('{');
    if (jsonStart >= 0) {
      try {
        const parsed = JSON.parse(rest.slice(jsonStart));
        if (parsed && typeof parsed === 'object' && parsed.message) {
          summary = String(parsed.message);
        }
      } catch (_) { /* not JSON, keep original */ }
    }
    // Collapse escape sequences and excessive whitespace.
    summary = summary.replace(/\\n/g, ' ').replace(/\\t/g, ' ').replace(/\s+/g, ' ').trim();
    if (summary.length > 160) summary = summary.slice(0, 160) + '…';

    return `${escapeHtml(prefix)} ${escapeHtml(summary)}` +
      ` <details><summary></summary><pre class="full-warn">${escapeHtml(s)}</pre></details>`;
  }
  function setStatus(text, addr) {
    const t = $('statusText');
    t.textContent = addr ? `${addr.slice(0,6)}…${addr.slice(-4)}` : text;
    $('status').classList.toggle('idle', !addr);
    $('status').title = addr || '';
  }

  // ---- Per-chain palette + inline SVG logos ----
  const CHAIN_META = {
    ethereum: {
      label: 'Ethereum', color: '#627eea', tw: 'ethereum',
      svg: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#627eea"/><path d="M16 4v8.87l7.5 3.35L16 4z" fill="#fff" fill-opacity=".6"/><path d="M16 4 8.5 16.22 16 12.87V4z" fill="#fff"/><path d="M16 21.97v6.02L23.5 17.6 16 21.97z" fill="#fff" fill-opacity=".6"/><path d="M16 27.99v-6.02L8.5 17.6 16 27.99z" fill="#fff"/><path d="m16 20.57 7.5-4.35L16 12.88v7.69z" fill="#fff" fill-opacity=".2"/><path d="m8.5 16.22 7.5 4.35v-7.69l-7.5 3.34z" fill="#fff" fill-opacity=".6"/></svg>`,
    },
    arbitrum: {
      label: 'Arbitrum', color: '#28a0f0', tw: 'arbitrum',
      svg: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#2d374b"/><path d="M14.4 9.4 8.5 19.6l1.5 1 5.6-9.7-1.2-1.5z" fill="#9dcced"/><path d="M16.2 9.4 9.7 21l1.7-.05L17.6 10.7 16.2 9.4z" fill="#28a0f0"/><circle cx="22.5" cy="22.5" r="2" fill="#28a0f0"/></svg>`,
    },
    optimism: {
      label: 'Optimism', color: '#ff0420', tw: 'optimism',
      svg: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#ff0420"/><path d="M11.6 19.4c-1 0-1.8-.2-2.4-.7-.6-.5-.9-1.2-.9-2.1 0-.2 0-.4.1-.7.2-1.2.5-2.1.9-2.8.7-1 1.7-1.5 3-1.5 1 0 1.8.2 2.4.7.6.5.9 1.2.9 2.1 0 .2 0 .4-.1.7-.3 1.5-.6 2.4-.9 2.8-.7 1-1.7 1.5-3 1.5zm.2-1.6c.5 0 .9-.2 1.3-.5.4-.3.6-.7.7-1.3.2-.7.2-1.4.2-1.7 0-.5-.1-.8-.3-1-.2-.2-.5-.3-1-.3-.5 0-.9.2-1.3.5-.4.3-.6.7-.7 1.3-.1.4-.2 1-.2 1.7 0 .5.1.8.3 1 .3.2.6.3 1 .3zm5.2 4.1c-.1 0-.1-.1-.1-.1l1.7-7.9v-.1h2.8c.8 0 1.4.2 1.8.5.4.3.7.8.7 1.4 0 .2 0 .4-.1.6-.2.8-.6 1.4-1.2 1.7-.6.4-1.4.6-2.4.6h-1.4l-.6 2.7-.1.1h-1.1zm2.5-4.1c.7 0 1.1-.1 1.4-.4.3-.3.5-.6.5-1 0-.2 0-.4-.1-.5-.1-.1-.2-.2-.4-.3-.2-.1-.4-.1-.7-.1h-1.3l-.6 2.4h1.2z" fill="#fff"/></svg>`,
    },
    base: {
      label: 'Base', color: '#0052ff', tw: 'base',
      svg: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#0052ff"/><path d="M15.9 24c4.4 0 8-3.6 8-8s-3.6-8-8-8C11.7 8 8.3 11.2 8 15.4h10.6v1.3H8c.4 4 3.7 7.3 7.9 7.3z" fill="#fff"/></svg>`,
    },
    polygon: {
      label: 'Polygon', color: '#8247e5', tw: 'polygon',
      svg: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#8247e5"/><path d="M21 13.7c-.4-.2-.8-.2-1.2 0l-2.7 1.6-1.9 1-2.6 1.6c-.4.2-.8.2-1.2 0l-2.1-1.2c-.4-.2-.6-.6-.6-1V14c0-.4.2-.8.6-1l2-1.2c.4-.2.8-.2 1.2 0l2 1.2c.4.2.6.6.6 1v1.6l1.9-1.1V13c0-.4-.2-.8-.6-1l-3.8-2.3c-.4-.2-.8-.2-1.2 0l-3.9 2.3c-.4.2-.6.6-.6 1v4.5c0 .4.2.8.6 1l3.9 2.3c.4.2.8.2 1.2 0l2.6-1.5 1.9-1.1 2.6-1.5c.4-.2.8-.2 1.2 0l2 1.2c.4.2.6.6.6 1v2.3c0 .4-.2.8-.6 1l-2 1.2c-.4.2-.8.2-1.2 0l-2-1.2c-.4-.2-.6-.6-.6-1v-1.6l-1.9 1.1v1.6c0 .4.2.8.6 1l3.9 2.3c.4.2.8.2 1.2 0l3.9-2.3c.4-.2.6-.6.6-1v-4.6c0-.4-.2-.8-.6-1L21 13.7z" fill="#fff"/></svg>`,
    },
    bnb: {
      label: 'BNB', color: '#f3ba2f', tw: 'smartchain',
      svg: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#f3ba2f"/><path d="M12 14.6 16 10.5l4 4.1 2.4-2.4L16 5.7l-6.4 6.5L12 14.6zm-6.4 1.4 2.4-2.4 2.4 2.4-2.4 2.4-2.4-2.4zm6.4 1.4L16 21.5l4-4.1 2.4 2.4-6.4 6.5L9.6 19.8l2.4-2.4zm9.6-1.4 2.4-2.4 2.4 2.4-2.4 2.4-2.4-2.4zM18.4 16 16 13.6 14.2 15.4l-.2.2.2.2L16 17.6 18.4 16z" fill="#fff"/></svg>`,
    },
    avalanche: {
      label: 'Avalanche', color: '#e84142', tw: 'avalanchec',
      svg: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#e84142"/><path d="M21.6 16.5c.5-.9 1.4-.9 2 0l3 4.9c.5.9.1 1.6-1 1.6h-6c-1 0-1.5-.7-1-1.6l3-4.9zm-5.7-9.9c.5-.9 1.4-.9 1.9 0l.6 1.2 1.6 2.7c.4.7.4 1.5 0 2.2l-5.3 9.3c-.5.8-1.4 1.3-2.3 1.3h-4.4c-1.1 0-1.5-.7-1-1.6l8.9-15.1z" fill="#fff"/></svg>`,
    },
    gnosis: {
      label: 'Gnosis', color: '#04795b', tw: 'xdai',
      svg: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#04795b"/><circle cx="16" cy="16" r="9" fill="none" stroke="#fff" stroke-width="2"/><circle cx="16" cy="16" r="3.2" fill="#fff"/></svg>`,
    },
    linea: {
      label: 'Linea', color: '#121212', tw: 'linea',
      svg: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#121212"/><path d="M9 9.5h3.6v9.6h7v3.4H9V9.5zm9.5 0H22v2.6h-3.5V9.5zm0 4.2H22v8.8h-3.5v-8.8z" fill="#61dfff"/></svg>`,
    },
    scroll: {
      label: 'Scroll', color: '#ffeeda', tw: 'scroll',
      svg: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#ffeeda"/><path d="M9 11c0-1.7 1.3-3 3-3h11v15c0 .6-.4 1-1 1H12c-1.7 0-3-1.3-3-3V11zm3-1c-.6 0-1 .4-1 1v10c0 .6.4 1 1 1h9V10h-9z" fill="#1a0a01"/><circle cx="20.5" cy="14" r="1.2" fill="#1a0a01"/></svg>`,
    },
    blast: {
      label: 'Blast', color: '#fcfc03', tw: 'blast',
      svg: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#fcfc03"/><path d="M16 6 6 12.5l3.6 1.7L16 10.5l6.4 3.7 3.6-1.7L16 6zM6 14.5v6.3L16 27l10-6.2v-6.3L16 20.5 6 14.5zm5.4 1.6L16 18.7l4.6-2.6v3.2L16 22 11.4 19.3v-3.2z" fill="#000"/></svg>`,
    },
  };

  function chainBadge(key) {
    const m = CHAIN_META[key] || { label: key, color: '#888', svg: '' };
    return `<span class="chain-tag" style="border-color:${m.color}33;">
              <span class="chain-icon">${m.svg}</span>${escapeHtml(m.label)}
            </span>`;
  }

  // ---- Token icon: multi-CDN fallback chain, then letter-fallback ----
  // We render <span data-...><img data-srcs="url1|url2"/></span> and let JS
  // walk the source list on load errors. Inline onerror breaks on the inner
  // attribute quotes, so we attach handlers in JS after the table renders.
  function fallbackIconHtml(initial, c1, c2) {
    return `<span class="token-icon fallback" style="--c1:${c1};--c2:${c2};">${escapeHtml(initial)}</span>`;
  }
  function tokenIconHtml(h) {
    const sym = (h.symbol || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 4) || '?';
    const initial = sym[0].toUpperCase();
    const meta = CHAIN_META[h.chain_key] || {};
    const chainColor = meta.color || '#444';
    const hue = [...sym].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    const c2 = `hsl(${hue}, 60%, 35%)`;

    if (h.is_native && meta.svg) {
      return `<span class="token-icon">${meta.svg}</span>`;
    }
    const tw = meta.tw || h.chain_key;
    const addr = (h.token_address || '').toLowerCase();
    if (!addr || addr === '0x0000000000000000000000000000000000000000') {
      return fallbackIconHtml(initial, chainColor, c2);
    }
    // Try 1inch first (case-insensitive, broad multi-chain coverage),
    // then TrustWallet (case-sensitive, but covers different niche tokens).
    const srcs = [
      `https://tokens.1inch.io/${addr}.png`,
      `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${tw}/assets/${addr}/logo.png`,
    ].join('|');
    return `<span class="token-icon" data-sym="${escapeHtml(initial)}" data-c1="${chainColor}" data-c2="${c2}">
              <img data-srcs="${srcs}" loading="lazy" alt="${escapeHtml(h.symbol)}" />
            </span>`;
  }
  function attachIconFallbacks(root) {
    root.querySelectorAll('img[data-srcs]').forEach((img) => {
      const srcs = img.dataset.srcs.split('|').filter(Boolean);
      let i = 0;
      function tryNext() {
        if (i >= srcs.length) {
          const span = img.closest('.token-icon');
          if (!span) return;
          span.outerHTML =
            `<span class="token-icon fallback" style="--c1:${span.dataset.c1};--c2:${span.dataset.c2};">${span.dataset.sym}</span>`;
          return;
        }
        img.src = srcs[i++];
      }
      img.addEventListener('error', tryNext);
      tryNext();
    });
  }

  // ---- Address book: saved wallets with labels and colors ----
  // Хранилище: { "0xaddr...": { label: "Депозитный", color: "#ff6b6b", addedAt: 1234 } }
  const BOOK_KEY = 'cryptoapp.wallet_book';
  const BOOK_COLORS = [
    '#ff6b6b', // red       — для депозитного / горячего
    '#ffa94d', // orange    — трейдинг
    '#ffd93d', // yellow    — промежуточный
    '#6ddf8e', // green     — холодный / сбережения
    '#6ea8fe', // blue      — основной
    '#8d6cff', // purple    — DeFi
    '#51cf66', // mint      — зарплата
    '#f783ac', // pink      — личный
    '#4dabf7', // sky
    '#868e96', // gray      — архив
    '#20c997', // teal
    '#be4bdb', // violet
  ];

  function loadWalletBook() {
    try {
      const raw = localStorage.getItem(BOOK_KEY);
      if (!raw) return {};
      const data = JSON.parse(raw);
      return (data && typeof data === 'object') ? data : {};
    } catch (_) { return {}; }
  }
  function saveWalletBook(book) {
    try { localStorage.setItem(BOOK_KEY, JSON.stringify(book)); } catch (_) {}
  }
  function normAddr(a) { return (a || '').toLowerCase().trim(); }
  function shortAddr(a) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : ''; }

  function getWalletMeta(addr) {
    if (!addr) return null;
    const book = loadWalletBook();
    return book[normAddr(addr)] || null;
  }

  function renderWalletBook() {
    const slot = document.getElementById('walletBook');
    if (!slot) return;
    const book = loadWalletBook();
    const entries = Object.entries(book).sort((a, b) => (a[1].addedAt || 0) - (b[1].addedAt || 0));
    const curAddr = normAddr(document.getElementById('addrInput').value);

    let html = '';
    if (entries.length) {
      html += '<span class="book-label">мои кошельки:</span>';
    }
    for (const [addr, meta] of entries) {
      const isActive = addr === curAddr;
      const safeLabel = escapeHtml(meta.label || 'Без имени');
      const safeColor = /^#[0-9a-fA-F]{6}$/.test(meta.color || '') ? meta.color : BOOK_COLORS[0];
      html += `
        <span class="wallet-chip ${isActive ? 'active' : ''}" data-addr="${addr}" title="${escapeHtml(addr)}">
          <span class="chip-dot" style="background:${safeColor}"></span>
          <span class="chip-label">${safeLabel}</span>
          <span class="chip-addr">${shortAddr(addr)}</span>
          <button class="chip-menu" data-edit="${addr}" title="Редактировать">✎</button>
        </span>`;
    }
    html += '<button class="wallet-chip-add" id="walletBookAdd">+ сохранить текущий</button>';
    slot.innerHTML = html;

    // Click chip body = switch wallet
    slot.querySelectorAll('.wallet-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        if (e.target.closest('[data-edit]')) return; // handled below
        const a = chip.dataset.addr;
        if (!a) return;
        document.getElementById('addrInput').value = a;
        saveConnection(a);
        updateWalletStatus();
        renderWalletBook(); // re-highlight
        doScan();
      });
    });
    // Edit (✎) button on chip
    slot.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openLabelModal(btn.dataset.edit);
      });
    });
    // Add current wallet
    const addBtn = document.getElementById('walletBookAdd');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const addr = normAddr(document.getElementById('addrInput').value);
        if (!/^0x[0-9a-f]{40}$/.test(addr)) {
          alert('Сначала вставь валидный 0x-адрес в поле выше.');
          return;
        }
        openLabelModal(addr);
      });
    }
  }

  function openLabelModal(addr) {
    const a = normAddr(addr);
    if (!/^0x[0-9a-f]{40}$/.test(a)) return;
    const book = loadWalletBook();
    const existing = book[a] || null;
    const curLabel = existing ? existing.label : '';
    const curColor = existing ? existing.color : BOOK_COLORS[0];
    const isNew = !existing;

    // Build modal
    const backdrop = document.createElement('div');
    backdrop.className = 'label-modal-backdrop';
    backdrop.innerHTML = `
      <div class="label-modal" role="dialog">
        <h3>${isNew ? 'Сохранить кошелёк' : 'Редактировать метку'}</h3>
        <div class="addr-preview">${escapeHtml(a)}</div>
        <input type="text" id="lmLabel" placeholder="Напр. «Депозитный», «Торговый»" maxlength="40" value="${escapeHtml(curLabel)}" />
        <div class="color-grid" id="lmColors"></div>
        <div class="modal-actions">
          ${isNew ? '' : '<button type="button" class="danger" id="lmDelete">Удалить</button>'}
          <button type="button" id="lmCancel">Отмена</button>
          <button type="button" class="primary" id="lmSave">${isNew ? 'Сохранить' : 'Применить'}</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    let selectedColor = curColor;
    const colorGrid = backdrop.querySelector('#lmColors');
    for (const c of BOOK_COLORS) {
      const sw = document.createElement('div');
      sw.className = 'color-swatch' + (c === selectedColor ? ' selected' : '');
      sw.style.background = c;
      sw.addEventListener('click', () => {
        selectedColor = c;
        colorGrid.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        sw.classList.add('selected');
      });
      colorGrid.appendChild(sw);
    }
    const labelInput = backdrop.querySelector('#lmLabel');
    setTimeout(() => labelInput.focus(), 50);

    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#lmCancel').addEventListener('click', close);

    const save = () => {
      const label = labelInput.value.trim() || `Кошелёк ${Object.keys(book).length + 1}`;
      const b = loadWalletBook();
      b[a] = {
        label,
        color: selectedColor,
        addedAt: (b[a] && b[a].addedAt) || Date.now(),
      };
      saveWalletBook(b);
      close();
      renderWalletBook();
    };
    backdrop.querySelector('#lmSave').addEventListener('click', save);
    labelInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });

    const delBtn = backdrop.querySelector('#lmDelete');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        if (!confirm(`Удалить метку «${existing.label}» из адресной книги?`)) return;
        const b = loadWalletBook();
        delete b[a];
        saveWalletBook(b);
        close();
        renderWalletBook();
      });
    }
  }

  // ---- MetaMask connection persistence and provider lifecycle ----
  const STORAGE_KEY = 'cryptoapp.connection';
  const CONNECTION_TTL_MS = 30 * 60 * 1000;
  let walletListenerProvider = null;
  let walletHandlers = null;
  let walletConnectPending = false;
  let walletConnectedAddress = null;

  function saveConnection(addr) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({addr, connectedAt: Date.now()}));
    } catch (_) {}
  }
  function loadConnection() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!data || !/^0x[0-9a-f]{40}$/i.test(data.addr || '') ||
          Date.now() - (data.connectedAt || 0) > CONNECTION_TTL_MS) {
        clearConnection();
        return null;
      }
      return data;
    } catch (_) { return null; }
  }
  function clearConnection() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }
  function updateWalletStatus() {
    const watching = $('addrInput').value.trim();
    const connected = walletConnectedAddress;
    if (connected) {
      setStatus(null, connected);
      $('status').title = 'MetaMask: ' + connected +
        (watching.toLowerCase() !== connected.toLowerCase() ? ' · Просматривается другой адрес' : '');
      $('connectBtn').textContent = 'MetaMask подключён';
    } else {
      setStatus(watching ? 'просмотр адреса' : 'не подключён');
      $('connectBtn').textContent = 'Подключить MetaMask';
    }
  }
  function applyWalletAccounts(provider, accounts, followAccount = true) {
    if (window.__activeProvider !== provider) return;
    const address = Array.isArray(accounts) && /^0x[0-9a-f]{40}$/i.test(accounts[0] || '')
      ? accounts[0] : null;
    if (walletConnectedAddress?.toLowerCase() !== address?.toLowerCase()) bridgeRoutesByIdx = [];
    walletConnectedAddress = address;
    if (address) {
      if (followAccount) $('addrInput').value = address;
      saveConnection($('addrInput').value.trim() || address);
    } else {
      clearConnection();
    }
    updateWalletStatus();
    renderWalletBook();
  }
  function attachMetaMaskListeners(provider) {
    if (walletListenerProvider === provider) return;
    if (walletListenerProvider && walletHandlers && typeof walletListenerProvider.removeListener === 'function') {
      for (const [name, handler] of Object.entries(walletHandlers)) {
        walletListenerProvider.removeListener(name, handler);
      }
    }
    walletListenerProvider = provider;
    walletHandlers = null;
    if (typeof provider?.on !== 'function') return;
    walletHandlers = {
      accountsChanged: (accounts) => {
        if (window.__activeProvider !== provider) return;
        applyWalletAccounts(provider, accounts);
        if (walletConnectedAddress) doScan();
      },
      disconnect: () => {
        if (window.__activeProvider !== provider) return;
        applyWalletAccounts(provider, []);
      },
      chainChanged: () => {
        if (window.__activeProvider !== provider) return;
        // Portfolio scanning is multi-chain; invalidate quotes tied to the old wallet state.
        bridgeRoutesByIdx = [];
        updateWalletStatus();
      },
    };
    for (const [name, handler] of Object.entries(walletHandlers)) provider.on(name, handler);
  }

  // EIP-6963 takes priority over legacy flags (other wallets may also set isMetaMask).
  const EIP6963_PROVIDERS = [];
  window.addEventListener('eip6963:announceProvider', (event) => {
    const detail = event.detail;
    if (typeof detail?.info?.uuid !== 'string' || !detail.info.uuid ||
        typeof detail.info.rdns !== 'string' || typeof detail.provider?.request !== 'function') return;
    if (!EIP6963_PROVIDERS.some(p => p.provider === detail.provider || p.info.uuid === detail.info.uuid)) {
      EIP6963_PROVIDERS.push(detail);
    }
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  function pickMetaMaskProvider() {
    const announced = EIP6963_PROVIDERS.find(p => p.info.rdns === 'io.metamask');
    if (announced) return announced.provider;
    const isMetaMask = p => typeof p?.request === 'function' && p.isMetaMask &&
      !p.isPhantom && !p.isRabby && !p.isBraveWallet && !p.isCoinbaseWallet && !p.isOkxWallet;
    const providers = window.ethereum?.providers;
    if (Array.isArray(providers)) return providers.find(isMetaMask) || null;
    return isMetaMask(window.ethereum) ? window.ethereum : null;
  }
  function getWallet() {
    return window.__activeProvider || pickMetaMaskProvider();
  }
  async function waitForMetaMask(timeout = 1500) {
    const existing = pickMetaMaskProvider();
    if (existing) return existing;
    return new Promise(resolve => {
      let timer;
      const finish = () => {
        clearTimeout(timer);
        window.removeEventListener('ethereum#initialized', check);
        window.removeEventListener('eip6963:announceProvider', check);
        resolve(pickMetaMaskProvider());
      };
      const check = () => { if (pickMetaMaskProvider()) finish(); };
      window.addEventListener('ethereum#initialized', check);
      window.addEventListener('eip6963:announceProvider', check);
      timer = setTimeout(finish, timeout);
      window.dispatchEvent(new Event('eip6963:requestProvider'));
    });
  }
  function metaMaskDappLink(href) {
    const url = new URL(href);
    if (url.protocol !== 'https:') return null;
    return 'https://link.metamask.io/dapp/' + url.host + url.pathname + url.search + url.hash;
  }
  function showMetaMaskHelp() {
    const panel = $('walletHelp');
    const link = metaMaskDappLink(location.href);
    $('openMetaMask').hidden = !link;
    if (link) $('openMetaMask').href = link;
    panel.hidden = false;
    setStatus('MetaMask не найден');
  }
  async function connectMetaMask() {
    if (walletConnectPending) return null;
    walletConnectPending = true;
    const button = $('connectBtn');
    button.disabled = true;
    button.textContent = 'Подключение…';
    try {
      const provider = await waitForMetaMask();
      if (!provider) {
        showMetaMaskHelp();
        return null;
      }
      const accounts = await provider.request({method: 'eth_requestAccounts'});
      if (!Array.isArray(accounts) || !/^0x[0-9a-f]{40}$/i.test(accounts[0] || '')) {
        throw new Error('MetaMask не предоставил адрес аккаунта');
      }
      window.__activeProvider = provider;
      attachMetaMaskListeners(provider);
      applyWalletAccounts(provider, accounts);
      $('walletHelp').hidden = true;
      return accounts[0];
    } catch (error) {
      const code = error?.code ?? error?.data?.originalError?.code;
      alert(code === 4001 ? 'Ты отменил подключение MetaMask.'
        : code === -32002 ? 'Запрос уже открыт в MetaMask. Открой кошелёк и подтверди подключение.'
        : 'MetaMask: не удалось подключить — ' + (error?.message || error));
      return null;
    } finally {
      walletConnectPending = false;
      button.disabled = false;
      updateWalletStatus();
    }
  }
  async function syncMetaMaskAccounts() {
    const provider = window.__activeProvider;
    if (!provider) return;
    try {
      const accounts = await provider.request({method: 'eth_accounts'});
      // Keep a manually entered watch address when returning from the wallet app.
      const follow = !$('addrInput').value ||
        $('addrInput').value.toLowerCase() === walletConnectedAddress?.toLowerCase();
      applyWalletAccounts(provider, accounts, follow);
    } catch (_) {
      if (window.__activeProvider === provider) {
        walletConnectedAddress = null;
        updateWalletStatus();
      }
    }
  }
  async function tryRestoreConnection() {
    const saved = loadConnection();
    if (saved) $('addrInput').value = saved.addr;
    const provider = await waitForMetaMask();
    if (provider) {
      window.__activeProvider = provider;
      attachMetaMaskListeners(provider);
      await syncMetaMaskAccounts();
    }
    updateWalletStatus();
    if (/^0x[0-9a-f]{40}$/i.test($('addrInput').value)) doScan();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncMetaMaskAccounts();
  });
  window.addEventListener('pageshow', () => syncMetaMaskAccounts());

  // ---- Scan & render ----
  async function fetchScan(wallet, includeZero) {
    const url = new URL('/api/scan', API_BASE);
    url.searchParams.set('wallet', wallet);
    if (includeZero) url.searchParams.set('include_zero', '1');
    const resp = await fetch(url.toString());
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }
    return await resp.json();
  }
  function renderTotals(data) {
    $('totals').style.display = 'grid';
    $('totalUsd').textContent = fmtMoney(data.total_usd, 'USD');
    $('totalRub').textContent = fmtMoney(data.total_rub, 'RUB');
    $('usdRub').textContent = data.usd_rub_rate
      ? `1 $ = ${fmtNumber(data.usd_rub_rate, 2)} ₽`
      : '—';
  }
  // ---- Idle money calculator (best-yield match per holding) -----------
  let idleYieldCache = null;
  let idleYieldFetchedAt = 0;
  async function ensureIdleYieldCache() {
    if (idleYieldCache && Date.now() - idleYieldFetchedAt < 10 * 60 * 1000) return idleYieldCache;
    try {
      // Fetch a generous slice of low-risk pools for matching.
      const u = new URL('/api/yield/scan', API_BASE);
      u.searchParams.set('min_tvl',  '5000000');
      u.searchParams.set('min_apy',  '1');
      u.searchParams.set('no_il',    '1');
      u.searchParams.set('limit',    '500');
      const r = await fetch(u);
      if (!r.ok) return null;
      const d = await r.json();
      idleYieldCache = d.pools || [];
      idleYieldFetchedAt = Date.now();
      return idleYieldCache;
    } catch (_) { return null; }
  }

  // For one holding, find best APY pool that matches (chain, symbol).
  function bestPoolFor(h, pools) {
    if (!pools) return null;
    const sym = (h.symbol || '').toUpperCase();
    const cands = pools.filter(p => {
      if (p.chain_key !== h.chain_key) return false;
      const parts = (p.symbol || '').split(/[-+/ ]/).map(s => s.toUpperCase());
      return parts.includes(sym);
    });
    if (!cands.length) return null;
    cands.sort((a, b) => b.apy - a.apy);
    return cands[0];
  }

  function renderIdleBanner(data) {
    const slot = $('idleBanner');
    if (!slot) return;
    if (!data.holdings || !idleYieldCache) { slot.innerHTML = ''; return; }
    const rubRate = Number(data.usd_rub_rate || 0);

    // Filter holdings: exclude tiny dust + native tokens that the user can't
    // really redeploy (gas reserve). Native tokens > $10 still count — Lido
    // / Aave (via WETH gateway) etc. could be a fit.
    const candidates = data.holdings.filter(h => Number(h.value_usd) > 10);
    if (!candidates.length) { slot.innerHTML = ''; return; }

    let totalIdleUsd = 0, missedMonthlyUsd = 0;
    const opps = [];
    for (const h of candidates) {
      const pool = bestPoolFor(h, idleYieldCache);
      if (!pool || pool.apy <= 0) continue;
      const monthly = Number(h.value_usd) * (pool.apy / 100) / 12;
      if (monthly < 0.05) continue;   // skip negligible (sub-5¢/mo)
      totalIdleUsd += Number(h.value_usd);
      missedMonthlyUsd += monthly;
      opps.push({ h, pool, monthly });
    }
    if (!opps.length) { slot.innerHTML = ''; return; }

    const yearly = missedMonthlyUsd * 12;
    const monthlyRub = missedMonthlyUsd * rubRate;
    slot.innerHTML = `
      <div class="idle-banner">
        <span class="emoji">💸</span>
        <div class="text">
          У тебя <strong>${fmtMoney(totalIdleUsd, 'USD')}</strong> валяются без работы — могли бы зарабатывать
          <strong>+${fmtMoney(missedMonthlyUsd, 'USD')}/мес</strong>
          ${rubRate ? ` (${fmtMoney(monthlyRub, 'RUB')})` : ''}
          ·  ${fmtMoney(yearly, 'USD')}/год
        </div>
        <button type="button" id="idleShowOpps">Показать варианты</button>
      </div>`;
    $('idleShowOpps').addEventListener('click', () => {
      // Switch to Yield tab; user already sees pre-filtered "только мои токены".
      setActiveTab('yield');
      const tab = document.querySelector('.tab[data-tab="yield"]');
      if (tab && !$('yieldResult').dataset.loaded) tab.click();
    });
  }

  function renderHoldings(data) {
    const root = $('result');
    $('cntHoldings').textContent = (data.holdings || []).length;
    // Lazy-load yield cache, then render the idle banner non-blocking.
    ensureIdleYieldCache().then(() => renderIdleBanner(data));
    if (!data.holdings || !data.holdings.length) {
      root.innerHTML = '<div class="empty">Балансы не найдены. Попробуй включить «показать нулевые» или проверь адрес.</div>';
      return;
    }
    const total = Math.max(0.000001, data.total_usd || 0);
    let html = '';
    if (data.warnings && data.warnings.length) {
      html += '<ul class="warn-list">';
      for (const w of data.warnings) html += `<li>${formatWarning(w)}</li>`;
      html += '</ul>';
    }
    html += `
      <div class="holdings-tools">
        <button type="button" id="csvExportBtn" title="Экспортировать текущий портфель в CSV (для бухгалтерии / Excel)">⬇ CSV</button>
      </div>
      <table>
        <thead><tr>
          <th style="padding-left:14px;">Сеть</th>
          <th>Актив</th>
          <th class="num">Количество</th>
          <th class="num">Цена</th>
          <th class="num">Стоимость, $</th>
          <th class="num">Стоимость, ₽</th>
        </tr></thead>
        <tbody>`;
    for (const h of data.holdings) {
      const pct = h.value_usd ? (h.value_usd / total) * 100 : 0;
      const allocBar = h.value_usd
        ? `<div class="alloc-bar-wrap">
             ${fmtMoney(h.value_usd, 'USD')}
             <div class="alloc-bar"><span style="width:${Math.max(2, Math.min(100, pct)).toFixed(2)}%;"></span></div>
           </div>`
        : '<span class="muted">—</span>';
      html += `
        <tr class="holding-row">
          <td>${chainBadge(h.chain_key)}</td>
          <td>
            <div class="token">
              ${tokenIconHtml(h)}
              <div>
                <div class="token-name">${escapeHtml(h.symbol)}${h.is_native ? ' <span class="muted" style="font-weight:400;font-size:11px;">native</span>' : ''}</div>
                <div class="token-sub">${escapeHtml((CHAIN_META[h.chain_key] || {}).label || h.chain_key)}</div>
              </div>
            </div>
          </td>
          <td class="num mono">${fmtNumber(h.amount, 8)}</td>
          <td class="num">${h.price_usd ? fmtMoney(h.price_usd, 'USD') : '<span class="muted">—</span>'}</td>
          <td class="num">${allocBar}</td>
          <td class="num">${h.value_rub ? fmtMoney(h.value_rub, 'RUB') : '<span class="muted">—</span>'}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    root.innerHTML = html;
    attachIconFallbacks(root);
    const csvBtn = document.getElementById('csvExportBtn');
    if (csvBtn) csvBtn.addEventListener('click', () => exportHoldingsCsv(data));
  }

  // ---- CSV export ----
  // Выгружает текущий портфель как CSV в кодировке UTF-8 с BOM (чтобы Excel
  // понимал кириллицу без танцев). Разделитель — точка с запятой: в русской
  // локали Excel split по «;», а это самое частое использование у P2P-мэнов.
  function csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    if (/[";\n\r]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }
  function exportHoldingsCsv(data) {
    const addr = (document.getElementById('addrInput').value || '').trim();
    const meta = getWalletMeta(addr);
    const label = meta ? meta.label : '';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const sep = ';';
    const header = ['Сеть', 'Актив', 'Native', 'Адрес токена', 'Количество', 'Цена USD', 'Стоимость USD', 'Стоимость RUB', 'Кошелёк', 'Метка', 'Время'];
    const rows = [header.map(csvEscape).join(sep)];
    const rubRate = Number(data.usd_rub_rate || 0);
    for (const h of (data.holdings || [])) {
      const chainName = (CHAIN_META[h.chain_key] || {}).label || h.chain_key;
      rows.push([
        chainName,
        h.symbol || '',
        h.is_native ? '1' : '',
        h.token_address || h.address || '',
        // Числа — с точкой; при импорте в русский Excel может потребоваться
        // Data → Text to Columns, но это норма для CSV с separator=;.
        (Number(h.amount) || 0).toFixed(8).replace(/\.?0+$/, ''),
        h.price_usd ? Number(h.price_usd).toFixed(6).replace(/\.?0+$/, '') : '',
        h.value_usd ? Number(h.value_usd).toFixed(2) : '',
        h.value_rub ? Number(h.value_rub).toFixed(2) : '',
        addr,
        label,
        ts,
      ].map(csvEscape).join(sep));
    }
    // Итоговая строка
    rows.push('');
    rows.push([
      '', 'ИТОГО', '', '', '', '',
      Number(data.total_usd || 0).toFixed(2),
      Number(data.total_rub || 0).toFixed(2),
      '', '', '',
    ].map(csvEscape).join(sep));
    if (rubRate) {
      rows.push(['', `курс ЦБ РФ 1$=${rubRate.toFixed(2)}₽`].map(csvEscape).join(sep));
    }

    const csv = '\ufeff' + rows.join('\r\n');  // UTF-8 BOM для Excel
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeLabel = (label || 'portfolio').replace(/[^\wа-яА-Я-]+/g, '_').slice(0, 32);
    a.href = url;
    a.download = `rudefi_${safeLabel}_${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  function renderDefi(data) {
    const body = $('defiBody');
    const sub  = $('defiSubtitle');
    const positions = data.defi_positions || [];
    $('cntDefi').textContent = positions.length;

    if (!positions.length) {
      sub.textContent = '';
      body.innerHTML = '<div class="empty">На этом адресе позиций в Aave V3 / Uniswap V3 не найдено.</div>';
      return;
    }

    // Summary line: net Aave value, total LP value.
    let netAave = 0, lpUsd = 0;
    for (const p of positions) {
      if (p.protocol === 'Aave V3' && p.kind === 'supply') netAave += (p.value_usd || 0);
      if (p.protocol === 'Aave V3' && p.kind === 'borrow') netAave -= (p.value_usd || 0);
      if (p.kind === 'lp') lpUsd += (p.value_usd || 0);
    }
    const parts = [`${positions.length} позиций`];
    if (netAave) parts.push(`Aave net ${fmtMoney(netAave, 'USD')}`);
    if (lpUsd)   parts.push(`LP ${fmtMoney(lpUsd, 'USD')}`);
    sub.textContent = parts.join(' · ');

    // Per-row Withdraw button caches. Reset on every render.
    window.__aaveSupplies = [];
    window.__compoundSupplies = [];

    let html = '';
    for (const p of positions) {
      const kindCls = `kind-tag kind-${escapeHtml(p.kind || 'summary')}`;
      const kindLbl = ({ supply: 'supply', borrow: 'borrow', lp: 'LP', summary: 'info' })[p.kind] || p.kind || '—';

      let valueHtml = '<span class="muted">—</span>';
      if (p.kind === 'supply' && p.value_usd) {
        valueHtml = fmtMoney(p.value_usd, 'USD')
          + (p.value_rub ? `<span class="sub">${fmtMoney(p.value_rub, 'RUB')}</span>` : '');
      } else if (p.kind === 'borrow' && p.value_usd) {
        valueHtml = '−' + fmtMoney(p.value_usd, 'USD')
          + (p.value_rub ? `<span class="sub">−${fmtMoney(p.value_rub, 'RUB')}</span>` : '');
      } else if (p.kind === 'lp') {
        if (p.value_usd) {
          valueHtml = fmtMoney(p.value_usd, 'USD')
            + (p.value_rub ? `<span class="sub">${fmtMoney(p.value_rub, 'RUB')}</span>` : '');
        } else {
          valueHtml = `<span class="muted">${p.in_range ? 'в диапазоне' : 'вне диапазона'}</span>`;
        }
      } else if (p.kind === 'summary' && p.health_factor) {
        const hf = p.health_factor.toFixed(2);
        const cls = p.health_factor >= 2 ? 'kind-supply' : (p.health_factor >= 1.2 ? 'kind-summary' : 'kind-borrow');
        valueHtml = `<span class="kind-tag ${cls}">HF ${hf}</span>`;
      }

      // For LP positions, append concrete amounts under the label.
      let labelExtra = '';
      if (p.kind === 'lp' && (p.amount0 || p.amount1)) {
        const parts = [];
        if (p.amount0) parts.push(`${fmtNumber(p.amount0, 6)} ${escapeHtml(p.token0_symbol)}`);
        if (p.amount1) parts.push(`${fmtNumber(p.amount1, 6)} ${escapeHtml(p.token1_symbol)}`);
        if (parts.length) labelExtra = `<div class="muted" style="font-size:11px;margin-top:2px;">${parts.join(' + ')}</div>`;
      }

      const linkHtml = p.link
        ? `<a class="tiny-link" href="${escapeHtml(p.link)}" target="_blank" rel="noopener">↗</a>`
        : '';

      // Withdraw button for supply rows with a recognized token. Routes to
      // the matching protocol-specific handler.
      let actionHtml = '';
      const hasToken = p.token0_symbol && p.token0_address &&
                       p.token0_address !== '0x0000000000000000000000000000000000000000';
      if (p.kind === 'supply' && hasToken) {
        if (p.protocol === 'Aave V3' || p.protocol === 'Spark') {
          const i = window.__aaveSupplies.length;
          window.__aaveSupplies.push(p);
          actionHtml = ` <button class="swap-btn" onclick="executeAaveWithdraw(${i})" style="margin-top:6px;">Withdraw</button>`;
        } else if (p.protocol === 'Compound V3') {
          const i = window.__compoundSupplies.length;
          window.__compoundSupplies.push(p);
          actionHtml = ` <button class="swap-btn" onclick="executeCompoundWithdraw(${i})" style="margin-top:6px;">Withdraw</button>`;
        }
      }

      html += `
        <div class="defi-row">
          <span>${chainBadge(p.chain_key)}</span>
          <span><span class="protocol-tag">${escapeHtml(p.protocol)}</span> <span class="${kindCls}">${escapeHtml(kindLbl)}</span></span>
          <span class="label">${escapeHtml(p.label)} ${linkHtml}${labelExtra}${actionHtml}</span>
          <span class="value">${valueHtml}</span>
        </div>`;
    }
    body.innerHTML = html;
  }

  // ---- Tabs ----
  function setActiveTab(name) {
    if (name === 'swap' || name === 'bridge') openExchangeSection(name);
    document.querySelectorAll('.tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === name);
      b.setAttribute('aria-pressed', String(b.dataset.tab === name));
    });
    document.querySelectorAll('.tab-pane').forEach(p => {
      p.hidden = p.dataset.pane !== name;
    });
  }
  document.querySelectorAll('.tab').forEach(b => {
    b.addEventListener('click', () => setActiveTab(b.dataset.tab));
  });

  function renderSkeleton() {
    let rows = '';
    for (let i = 0; i < 6; i++) {
      rows += `<tr class="skeleton-row">
        <td><span class="sk" style="width:90px"></span></td>
        <td><span class="sk" style="width:140px"></span></td>
        <td class="num"><span class="sk" style="width:60px"></span></td>
        <td class="num"><span class="sk" style="width:50px"></span></td>
        <td class="num"><span class="sk" style="width:70px"></span></td>
        <td class="num"><span class="sk" style="width:70px"></span></td>
      </tr>`;
    }
    $('result').innerHTML = `<table><tbody>${rows}</tbody></table>`;
  }

  // ---- Auto-refresh (always-on, 10s, pauses when tab hidden) ----
  let scanInFlight = false;
  let lastSuccessAt = 0;
  let lastScanData = null;       // most recent successful scan; used by bridges tab
  const REFRESH_INTERVAL_MS = 10000;

  function updateLastUpdatedLabel() {
    const el = $('lastUpdated');
    if (!lastSuccessAt) { el.style.display = 'none'; return; }
    const sec = Math.floor((Date.now() - lastSuccessAt) / 1000);
    el.style.display = '';
    if (sec < 5)         el.textContent = 'обновлено только что';
    else if (sec < 60)   el.textContent = `обновлено ${sec} сек назад`;
    else                 el.textContent = `обновлено ${Math.floor(sec / 60)} мин назад`;
  }
  setInterval(updateLastUpdatedLabel, 1000);

  // Single global ticker. Skips when:
  //   * no valid address in the input,
  //   * the tab is hidden (saves RPC quota — most public RPCs throttle hard),
  //   * a scan is already in flight.
  setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    if (scanInFlight) return;
    const v = $('addrInput').value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return;
    doScan();
  }, REFRESH_INTERVAL_MS);

  // When the user returns to the tab after being away, refresh immediately
  // instead of waiting up to 10s for the next tick.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const v = $('addrInput').value.trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(v) && !scanInFlight) doScan();
  });

  async function runScan() {
    const addr = $('addrInput').value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      alert('Введи валидный 0x-адрес из 40 hex-символов.');
      return false;
    }
    const includeZero = $('includeZero').checked;
    if (!lastSuccessAt) { renderSkeleton(); $('totals').style.display = 'none'; }
    try {
      const data = await fetchScan(addr, includeZero);
      lastScanData = data;
      renderTotals(data);
      renderHoldings(data);
      renderDefi(data);
      // Health Factor monitoring runs on every successful scan — picks up
      // dropping HF without the user having to be on the DeFi tab.
      try { checkHealthFactors(data); } catch (_) {}
      // Re-render the optimizer if it's already loaded (data may have changed).
      if (idleYieldCache) renderYieldOptimizer();
      // If the bridges form is already populated, refresh the balance hint.
      if (typeof updateBridgeBalance === 'function') updateBridgeBalance();
      return true;
    } catch (e) {
      $('result').innerHTML = `<div class="error">Ошибка: ${escapeHtml(e.message || String(e))}</div>`;
      return false;
    }
  }
  async function doScan() {
    if (scanInFlight) return;
    scanInFlight = true;
    try {
      const ok = await runScan();
      if (ok) {
        lastSuccessAt = Date.now();
        updateLastUpdatedLabel();
        // Rolling 30-min TTL: any successful scan with a saved connection
        // pushes its expiry forward.
        if (loadConnection()) saveConnection($('addrInput').value.trim());
      }
    } finally {
      scanInFlight = false;
    }
  }

  // ---- Wire up ----
  $('connectBtn').addEventListener('click', async () => {
    const a = await connectMetaMask();
    if (a) doScan();
  });
  $('scanBtn').addEventListener('click', doScan);
  $('addrInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doScan(); });
  $('includeZero').addEventListener('change', () => {
    if ($('addrInput').value) doScan();
  });

  // ---- Bridges ----
  let registryData = null;

  async function loadRegistry() {
    if (registryData) return registryData;
    try {
      const resp = await fetch(API_BASE + '/api/registry');
      if (!resp.ok) return null;
      registryData = await resp.json();
      return registryData;
    } catch (e) {
      console.error('registry load failed', e);
      return null;
    }
  }

  function populateBridgeChain(selectId, defaultKey) {
    const sel = $(selectId);
    if (!registryData) return;
    sel.innerHTML = registryData.chains.map(c =>
      `<option value="${c.key}" data-chain-id="${c.chain_id}">${escapeHtml(c.name)}</option>`).join('');
    if (defaultKey) sel.value = defaultKey;
  }
  function populateBridgeTokens(chainSelectId, tokenSelectId, defaultSymbol) {
    const chainKey = $(chainSelectId).value;
    const chain = registryData?.chains.find(c => c.key === chainKey);
    if (!chain) return;
    $(tokenSelectId).innerHTML = chain.tokens.map(t =>
      `<option value="${t.address}" data-decimals="${t.decimals}" data-symbol="${escapeHtml(t.symbol)}" data-native="${t.is_native}">
        ${escapeHtml(t.symbol)}${t.is_native ? ' · native' : ''}
      </option>`).join('');
    if (defaultSymbol) {
      const opt = Array.from($(tokenSelectId).options).find(o => o.dataset.symbol === defaultSymbol);
      if (opt) $(tokenSelectId).value = opt.value;
    }
  }

  // Look up the user's holding for a given (chain, token).
  function findHoldingForBridge(chainKey, tokenAddrLower, isNative) {
    if (!lastScanData?.holdings) return null;
    return lastScanData.holdings.find(h => {
      if (h.chain_key !== chainKey) return false;
      if (isNative) return h.is_native === true;
      if (h.is_native) return false;
      return (h.token_address || '').toLowerCase() === tokenAddrLower;
    }) || null;
  }

  // Render the "Доступно: X" hint under the amount input. Idempotent — safe
  // to call after every form change or after a fresh scan.
  function updateBridgeBalance() {
    const sel = $('bridgeFromToken');
    const el  = $('bridgeBalance');
    if (!sel || !el) return;
    const opt = sel.options[sel.selectedIndex];
    if (!opt) { el.innerHTML = ''; return; }

    const chainKey = $('bridgeFromChain').value;
    const isNative = opt.dataset.native === 'true';
    const tokenAddr = (opt.value || '').toLowerCase();
    const symbol = opt.dataset.symbol || '';

    const h = findHoldingForBridge(chainKey, tokenAddr, isNative);

    if (h && Number(h.amount) > 0) {
      el.classList.add('has-balance');
      el.innerHTML =
        `Доступно: <span class="mono">${fmtNumber(h.amount, 8)} ${escapeHtml(symbol)}</span>` +
        ` <button type="button" class="max-btn" id="bridgeMaxBtn">MAX</button>` +
        (h.value_usd
          ? ` <span class="muted">· ≈ ${fmtMoney(h.value_usd, 'USD')}</span>`
          : '');
      $('bridgeMaxBtn').addEventListener('click', () => {
        $('bridgeAmount').value = h.amount;
      });
    } else if (lastScanData) {
      el.classList.remove('has-balance');
      el.innerHTML = `<span class="muted">Нет ${escapeHtml(symbol)} на этом адресе в выбранной сети</span>`;
    } else {
      el.classList.remove('has-balance');
      el.innerHTML = `<span class="muted">Подключи кошелёк или вставь адрес — увидишь свой баланс</span>`;
    }
  }

  // Convert a human-readable amount string (e.g. "12.345") to raw integer
  // string in smallest units (e.g. "12345000" for decimals=6). No floats.
  function scaleAmount(human, decimals) {
    const s = String(human).trim();
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) return null;
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    let [intPart, fracPart = ''] = s.split('.');
    if (fracPart.length > decimals && /[1-9]/.test(fracPart.slice(decimals))) return null;
    fracPart = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
    const result = (intPart + fracPart).replace(/^0+/, '') || '0';
    return BigInt(result) < (1n << 256n) ? result : null;
  }

  function secsToHuman(s) {
    if (!s || s < 60) return `${s || 0} сек`;
    if (s < 3600)    return `~${Math.round(s / 60)} мин`;
    return `~${(s / 3600).toFixed(1)} ч`;
  }

  async function bridgeQuote() {
    if (!registryData) await loadRegistry();
    if (!registryData) {
      $('bridgeResult').innerHTML = '<div class="error">Не удалось загрузить список сетей. Бэкенд запущен?</div>';
      return;
    }
    const fromChainKey = $('bridgeFromChain').value;
    const toChainKey   = $('bridgeToChain').value;
    const fromChain = registryData.chains.find(c => c.key === fromChainKey);
    const toChain   = registryData.chains.find(c => c.key === toChainKey);
    if (!fromChain || !toChain) return;
    if (!exchangeChainsValid(exchangeMode, fromChain.chain_id, toChain.chain_id)) {
      $('bridgeResult').innerHTML = '<div class="error">' +
        (exchangeMode === 'swap' ? 'Для свапа выбери одну сеть.' : 'Для моста выбери разные сети.') + '</div>';
      return;
    }
    const fromTokenSel = $('bridgeFromToken');
    const toTokenSel   = $('bridgeToToken');
    const fromTokenAddr = fromTokenSel.value;
    const toTokenAddr   = toTokenSel.value;
    // Same-chain + same-token = nothing to do.
    if (fromChain.chain_id === toChain.chain_id &&
        fromTokenAddr.toLowerCase() === toTokenAddr.toLowerCase()) {
      $('bridgeResult').innerHTML = '<div class="error">Выбери разные токены — обмен на тот же токен в той же сети не имеет смысла.</div>';
      return;
    }
    const fromDecimals = parseInt(fromTokenSel.options[fromTokenSel.selectedIndex]?.dataset.decimals || '18', 10);

    const amountHuman = $('bridgeAmount').value.trim();
    const rawAmount = scaleAmount(amountHuman, fromDecimals);
    if (!rawAmount || rawAmount === '0') {
      $('bridgeResult').innerHTML = '<div class="error">Введи положительную сумму с допустимым числом знаков после запятой.</div>';
      return;
    }

    const wallet = $('addrInput').value.trim();
    if (!/^0x[0-9a-f]{40}$/i.test(wallet) || /^0x0{40}$/i.test(wallet)) {
      $('bridgeResult').innerHTML = '<div class="error">Подключи MetaMask или введи адрес кошелька для расчёта маршрута.</div>';
      return;
    }

    const url = new URL('/api/bridge/quote', API_BASE);
    url.searchParams.set('from_chain', fromChain.chain_id);
    url.searchParams.set('to_chain',   toChain.chain_id);
    url.searchParams.set('from_token', fromTokenAddr);
    url.searchParams.set('to_token',   toTokenAddr);
    url.searchParams.set('amount',     rawAmount);
    url.searchParams.set('from_address', wallet);

    const quoteRevision = ++bridgeQuoteRevision;
    $('bridgeResult').innerHTML = '<div class="loading">Ищем маршруты…</div>';
    const btn = $('bridgeQuoteBtn');
    btn.disabled = true;
    try {
      const resp = await fetch(url.toString());
      const data = await resp.json();
      if (quoteRevision !== bridgeQuoteRevision) return;
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      if (data.error) throw new Error(data.error);
      const context = Object.freeze({ fromChain, toChain, fromTokenAddr, rawAmount, wallet });
      for (const route of data.routes || []) route.quoteContext = context;
      renderBridgeResults(data);
    } catch (e) {
      if (quoteRevision !== bridgeQuoteRevision) return;
      $('bridgeResult').innerHTML = `<div class="error">Ошибка: ${escapeHtml(e.message || e)}</div>`;
    } finally {
      if (quoteRevision === bridgeQuoteRevision) btn.disabled = false;
    }
  }

  function renderBridgeResults(data) {
    const root = $('bridgeResult');
    bridgeRoutesByIdx = data.routes || [];

    if (!data.routes || !data.routes.length) {
      const fromKey = $('bridgeFromChain').value;
      const toKey   = $('bridgeToChain').value;
      const sameChain = fromKey === toKey;
      const msg = sameChain
        ? 'DEX-агрегатор не нашёл ликвидности для этой пары в выбранной сети.'
        : 'Между выбранными сетями нет маршрута для этой пары токенов.';
      root.innerHTML = `<div class="empty">${msg}</div>`;
      return;
    }
    const rubRate = Number(data.usd_rub_rate || 0);

    let html = '';
    for (let idx = 0; idx < data.routes.length; idx++) {
      const r = data.routes[idx];
      const tagsHtml = (r.tags || []).map(t => `<span class="bridge-tag t-${escapeHtml(t)}">${escapeHtml(t)}</span>`).join('');
      const protocols = (r.steps || []).map(s => escapeHtml(s.protocol || '?')).join(' → ');

      // Receive side — what user gets in the destination chain.
      const toAmt   = Number(r.to_amount_human || 0);
      const toUsd   = Number(r.to_amount_usd || 0);
      const toRub   = toUsd * rubRate;
      const fromUsd = Number(r.from_amount_usd || 0);

      // Net loss (slippage + bridge fees + gas already deducted from to-side).
      // Note: LiFi's `to_amount_usd` is what arrives, AFTER bridge fees but
      // typically does NOT include source-chain gas. We add gas_usd to the
      // "loss" so the user sees the all-in difference.
      const lossUsd = Math.max(0, (fromUsd - toUsd) + (r.total_gas_usd || 0));
      const lossPct = fromUsd > 0 ? (lossUsd / fromUsd) * 100 : 0;
      const lossClass = lossPct > 1.0 ? 'loss big' : 'loss';

      // Gas breakdown: one line per token.
      const gasLines = (r.gas_breakdown || []).map(g => {
        return `<div class="gas-amt">${fmtNumber(g.amount_human, 6)} ${escapeHtml(g.token_symbol)}</div>`;
      }).join('');
      const totalGasUsd = r.total_gas_usd ? fmtMoney(r.total_gas_usd, 'USD') : '—';
      const totalGasRub = r.total_gas_rub ? fmtMoney(r.total_gas_rub, 'RUB') : '—';

      html += `
        <div class="bridge-route">
          <div>
            <div class="bridge-route-head">
              <span class="protocol-tag">${escapeHtml(protocols || 'свап')}</span>
              ${tagsHtml}
            </div>
            <div class="bridge-route-amounts">
              <span class="from-side">${fmtNumber(r.from_amount_human, 6)} ${escapeHtml(r.from_token_symbol)} · ${fmtMoney(fromUsd, 'USD')}</span>
              <span class="arrow">→</span>
              <span class="to-side">
                ${fmtNumber(toAmt, 6)} ${escapeHtml(r.to_token_symbol)}
                <span class="to-fiat">· ${fmtMoney(toUsd, 'USD')}${rubRate ? ' · ' + fmtMoney(toRub, 'RUB') : ''}</span>
              </span>
            </div>
            <div class="bridge-route-meta">
              <span>${secsToHuman(r.execution_duration_seconds)}</span>
              ${lossUsd > 0
                ? `<span class="${lossClass}">потеря ${fmtMoney(lossUsd, 'USD')} (${lossPct.toFixed(2)}%)</span>`
                : `<span class="loss">без потерь</span>`}
              ${r.steps?.length > 1 ? `<span>${r.steps.length} шагов</span>` : ''}
            </div>
          </div>
          <div class="bridge-route-cost">
            <div class="gas-label">газ источника</div>
            ${gasLines || '<span class="muted">—</span>'}
            <div class="sub">${totalGasUsd} · ${totalGasRub}</div>
            <button class="swap-btn"
                    ${(r.steps?.length || 1) > 1 ? 'disabled title="Многошаговый маршрут — пока in-app не поддерживается"' : ''}
                    onclick="executeSwap(${idx})">${exchangeMode === 'swap' ? 'Обменять' : 'Перевести'}</button>
          </div>
        </div>`;
    }
    root.innerHTML = html;
  }

  // ============== Swap execution =====================================
  // Holds the routes from the most recent /api/bridge/quote call so the
  // "Свопнуть" buttons in the rendered cards can find their data.
  let bridgeRoutesByIdx = [];

  // Sentinel used by LiFi for "send native gas token instead of an ERC-20".
  const NATIVE_TOKEN_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

  function isNativeAddr(a) {
    return (a || '').toLowerCase() === NATIVE_TOKEN_SENTINEL;
  }
  function toHexQty(decStr) {
    // BigInt-based decimal → 0x hex (without leading zeros).
    return '0x' + BigInt(decStr).toString(16);
  }
  function chainIdHex(numeric) {
    return '0x' + Number(numeric).toString(16);
  }

  // Encode ERC-20 approve(spender, amount) into calldata (no keccak needed).
  function encodeApprove(spender, amountDec) {
    const sel = '095ea7b3';                                 // approve(address,uint256)
    const sp  = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const am  = BigInt(amountDec).toString(16).padStart(64, '0');
    return '0x' + sel + sp + am;
  }
  // Encode ERC-20 allowance(owner, spender) for read-only lookup.
  function encodeAllowance(owner, spender) {
    const sel = 'dd62ed3e';
    const ow  = owner.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const sp  = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    return '0x' + sel + ow + sp;
  }

  // ---- Modal helpers -------------------------------------------------
  function showSwapModal(steps) {
    closeSwapModal();
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.id = 'swapModal';
    back.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>Исполнение операции</h3>
        <div id="swapSteps">
          ${steps.map((s, i) => `
            <div class="step" data-i="${i}">
              <div class="dot">${i + 1}</div>
              <div class="body">
                <div class="title">${escapeHtml(s)}</div>
                <div class="detail"></div>
              </div>
            </div>`).join('')}
        </div>
        <div class="modal-actions">
          <button id="swapClose" type="button">Закрыть</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    $('swapClose').addEventListener('click', closeSwapModal);
  }
  function setSwapStep(i, state, detail) {
    const el = document.querySelector(`#swapSteps .step[data-i="${i}"]`);
    if (!el) return;
    el.classList.remove('active', 'done', 'error');
    if (state) el.classList.add(state);
    if (detail !== undefined) el.querySelector('.detail').innerHTML = detail;
    if (state === 'done') el.querySelector('.dot').textContent = '✓';
    if (state === 'error') el.querySelector('.dot').textContent = '!';
  }
  function closeSwapModal() {
    const m = $('swapModal');
    if (m) m.remove();
  }

  // ---- Main flow -----------------------------------------------------
  async function executeSwap(routeIdx) {
    const route = bridgeRoutesByIdx[routeIdx];
    if (!route) { alert('Маршрут не найден; перезапусти поиск'); return; }
    if (!getWallet()) { alert('MetaMask не установлен.'); return; }

    // Execute only the inputs captured when this quote was requested.
    const context = route.quoteContext;
    if (!context) { alert('Обнови котировку перед исполнением'); return; }
    if ((route.steps || []).length !== 1) {
      alert('Этот маршрут требует нескольких транзакций. Выбери маршрут с одним шагом.');
      return;
    }
    const { fromChain, toChain, fromTokenAddr } = context;
    const fromIsNative = isNativeAddr(fromTokenAddr);
    const isCrossChain = toChain && toChain.chain_id !== fromChain.chain_id;

    const stepsLabels = [];
    stepsLabels.push(`Переключиться на сеть «${fromChain.name}»`);
    if (!fromIsNative) stepsLabels.push('Approve токена для контракта');
    stepsLabels.push(isCrossChain ? 'Подписать транзакцию моста' : 'Подписать транзакцию свапа');
    stepsLabels.push('Дождаться подтверждения в сети');
    if (isCrossChain) stepsLabels.push('Дождаться доставки в целевую сеть');
    showSwapModal(stepsLabels);

    let stepIdx = 0;
    const next = (state, detail) => { setSwapStep(stepIdx, state, detail); };

    try {
      // ---- 1. Switch chain -----------------------------------------
      next('active');
      const accs = await getWallet().request({ method: 'eth_requestAccounts' });
      if (!accs || !accs.length) throw new Error('Аккаунт не подключён');
      const wallet = accs[0];
      if (wallet.toLowerCase() !== context.wallet.toLowerCase()) {
        throw new Error('Котировка рассчитана для другого адреса. Подключи нужный кошелёк и обнови котировку.');
      }
      const cur = await getWallet().request({ method: 'eth_chainId' });
      if (parseInt(cur, 16) !== fromChain.chain_id) {
        try {
          await getWallet().request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: chainIdHex(fromChain.chain_id) }],
          });
        } catch (e) {
          throw new Error('Не удалось переключиться на ' + fromChain.name + ': ' + (e?.message || e), { cause: e });
        }
      }
      next('done', `аккаунт <span class="mono">${wallet.slice(0,6)}…${wallet.slice(-4)}</span>`);
      stepIdx++;

      // ---- 2. Build the bridge tx FIRST so we know approvalAddress ----
      // (We do it before approve so we can target the exact approval address
      // LiFi expects.)
      const txData = await fetchBuildTx(route.route_id || route.id, 0);
      const approvalAddr = (txData?.estimate?.approvalAddress || '').toLowerCase();
      const txReq = txData?.transactionRequest;
      if (!txReq || !txReq.to || !txReq.data) {
        throw new Error('LiFi не вернул transactionRequest — возможно, маршрут устарел. Сделай поиск заново.');
      }

      // ---- 3. Approve (only for ERC-20) ------------------------------
      if (!fromIsNative) {
        if (!approvalAddr) throw new Error('LiFi не вернул approvalAddress');
        const approveTx = {
          from: wallet,
          to: fromTokenAddr,
          data: encodeApprove(approvalAddr, context.rawAmount),
        };
        const apprGas = await estimateGasCost(fromChain.key, approveTx);
        next('active', apprGas.label || 'отправка approve(...)');
        const txHashApprove = await getWallet().request({
          method: 'eth_sendTransaction',
          params: [approveTx],
        });
        next('done', linkTx(fromChain, txHashApprove));
        stepIdx++;
        await waitForReceipt(txHashApprove);
      }

      // ---- 4. Bridge tx ---------------------------------------------
      const sendTx = {
        from: wallet,
        to: txReq.to,
        data: txReq.data,
        value: txReq.value || '0x0',
      };
      if (txReq.gasPrice) sendTx.gasPrice = txReq.gasPrice;
      if (txReq.gasLimit) sendTx.gas = txReq.gasLimit;
      const bridgeGas = await estimateGasCost(fromChain.key, sendTx);
      next('active', bridgeGas.label || 'подпиши в MetaMask');
      const txHashBridge = await getWallet().request({
        method: 'eth_sendTransaction',
        params: [sendTx],
      });
      next('done', linkTx(fromChain, txHashBridge));
      stepIdx++;

      // ---- 5. Wait for source confirmation --------------------------
      next('active');
      await waitForReceipt(txHashBridge);
      next('done');
      stepIdx++;

      // ---- 6. Poll cross-chain status (skipped for same-chain swaps) ----
      if (isCrossChain) {
        next('active', 'это занимает 30 сек – 5 мин');
        const bridgeTool = (route.steps?.[0]?.protocol || '').toLowerCase();
        const finalStatus = await pollLifiStatus(bridgeTool, fromChain.chain_id,
                                                 toChain?.chain_id || 0, txHashBridge);
        if (finalStatus === 'DONE') {
          next('done', 'средства зачислены');
        } else {
          next('error', 'статус: ' + escapeHtml(finalStatus));
        }
      }
      // For same-chain swaps step 4 already confirmed the receipt; nothing else to do.
    } catch (e) {
      console.error(e);
      next('error', escapeHtml(e?.message || String(e)));
    }
  }

  async function fetchBuildTx(routeId, stepIndex) {
    const u = new URL('/api/bridge/build-tx', API_BASE);
    u.searchParams.set('route_id', routeId);
    u.searchParams.set('step', String(stepIndex));
    const resp = await fetch(u);
    const j = await resp.json();
    if (!resp.ok) throw new Error(j.error || ('HTTP ' + resp.status));
    return j;
  }

  function linkTx(chain, txHash) {
    if (!chain?.explorer || !txHash) return escapeHtml(txHash || '');
    return `<a class="mono" target="_blank" rel="noopener" href="${escapeHtml(chain.explorer)}/tx/${escapeHtml(txHash)}">${escapeHtml(txHash.slice(0,10))}…${escapeHtml(txHash.slice(-6))} ↗</a>`;
  }
  async function waitForReceipt(txHash) {
    // Poll eth_getTransactionReceipt until we have one.
    for (let i = 0; i < 180; i++) {       // up to ~6 min
      let receipt;
      try {
        receipt = await getWallet().request({
          method: 'eth_getTransactionReceipt',
          params: [txHash],
        });
      } catch (e) { /* transient RPC failure; retry */ }
      if (receipt) {
        if (receipt.status != null && BigInt(receipt.status) === 0n) {
          throw new Error('Транзакция отклонена сетью (reverted)');
        }
        return receipt;
      }
      await new Promise(rs => setTimeout(rs, 2000));
    }
    throw new Error('Транзакция не подтверждена за 6 мин');
  }
  async function pollLifiStatus(bridge, fromChain, toChain, txHash) {
    for (let i = 0; i < 90; i++) {        // up to ~15 min total
      try {
        const u = new URL('/api/bridge/status', API_BASE);
        u.searchParams.set('tx_hash', txHash);
        if (bridge)   u.searchParams.set('bridge', bridge);
        if (fromChain) u.searchParams.set('from_chain', fromChain);
        if (toChain)   u.searchParams.set('to_chain', toChain);
        const r = await fetch(u);
        const j = await r.json();
        const st = j.status || 'PENDING';
        if (st === 'DONE' || st === 'FAILED') return st;
      } catch (e) { /* keep polling */ }
      await new Promise(rs => setTimeout(rs, 10000));
    }
    return 'TIMEOUT';
  }
  // Expose to inline onclicks generated by renderBridgeResults.
  window.executeSwap = executeSwap;

  // MEV-protect informational modal — only relevant on Ethereum mainnet
  // because L2 sequencers don't allow public mempool sandwich attacks.
  function showMevModal() {
    closeSwapModal();
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.id = 'swapModal';
    back.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" style="max-width:560px;">
        <h3>🛡️ MEV-защита для Ethereum mainnet</h3>
        <p style="font-size:13px;line-height:1.5;color:var(--fg-soft);margin:0 0 10px;">
          В public mempool Ethereum твою заявку на свап видят все, включая
          MEV-боты. Они могут <b>зафронт-ранить</b> (купить токен прямо перед тобой,
          подняв цену) и <b>забэк-ранить</b> (продать сразу после), забрав себе
          разницу. На крупных свапах это $5–500 убытка.
        </p>
        <p style="font-size:13px;line-height:1.5;color:var(--fg-soft);margin:0 0 10px;">
          На <b>L2-сетях</b> (Arbitrum, Optimism, Base, Polygon) этой проблемы нет —
          у них приватные sequencer'ы. Защита нужна только в Ethereum mainnet.
        </p>
        <h4 style="margin:14px 0 6px;font-size:13px;">Как защититься</h4>
        <ol style="font-size:12px;line-height:1.6;color:var(--fg-soft);padding-left:20px;margin:0 0 12px;">
          <li>Открой MetaMask → <b>Settings → Networks → Ethereum Mainnet</b></li>
          <li>В поле «New RPC URL» (или нажми «Edit») вставь:
            <div style="margin:6px 0;padding:8px 10px;background:var(--panel-3);border-radius:6px;display:flex;justify-content:space-between;gap:6px;">
              <code class="mono" style="font-size:12px;">https://rpc.mevblocker.io</code>
              <button id="mevCopyBtn" type="button" style="background:var(--accent);color:#0a0d13;border:none;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:11px;">Скопировать</button>
            </div>
          </li>
          <li>Сохрани и используй как обычно. Все будущие свапы / переводы пойдут через
            приватный мемпул MEV-Blocker и не будут «видны» ботам.</li>
        </ol>
        <p style="font-size:11px;color:var(--muted);margin:8px 0 0;">
          Альтернативы того же класса: <a href="https://protect.flashbots.net" target="_blank" rel="noopener">Flashbots Protect</a>,
          <a href="https://blocknative.com/transaction-distribution-network" target="_blank" rel="noopener">Blocknative</a>.
          Все бесплатны.
        </p>
        <div class="modal-actions">
          <button id="mevClose" type="button" class="primary">Понятно</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    $('mevClose').addEventListener('click', closeSwapModal);
    $('mevCopyBtn').addEventListener('click', () => {
      navigator.clipboard.writeText('https://rpc.mevblocker.io').catch(() => {});
      $('mevCopyBtn').textContent = '✓ скопировано';
      setTimeout(() => { try { $('mevCopyBtn').textContent = 'Скопировать'; } catch(_){} }, 1500);
    });
  }

  // Show MEV banner whenever Ethereum is the source chain in the swap form.
  function updateMevBanner() {
    const slot = $('mevBanner');
    if (!slot) return;
    const fromChain = $('bridgeFromChain')?.value;
    if (fromChain === 'ethereum') {
      slot.innerHTML =
        `<button type="button" class="swap-btn" onclick="showMevModal()"
                 style="background:transparent;color:var(--warn);border:1px solid var(--warn);">
            🛡️ MEV-защита для Ethereum
         </button>`;
    } else {
      slot.innerHTML = '';
    }
  }
  window.showMevModal = showMevModal;
  $('bridgeFromChain')?.addEventListener('change', updateMevBanner);

  $('bridgeQuoteBtn').addEventListener('click', bridgeQuote);
  // Re-populate the token list AND refresh the balance hint on chain change.
  $('bridgeFromChain').addEventListener('change', () => {
    populateBridgeTokens('bridgeFromChain', 'bridgeFromToken');
    const previousDestination = $('bridgeToChain').value;
    syncExchangeNetworks();
    if (previousDestination !== $('bridgeToChain').value) {
      populateBridgeTokens('bridgeToChain', 'bridgeToToken', 'USDC');
      updateToTokenSecurity();
    }
    updateBridgeBalance();
  });
  $('bridgeToChain').addEventListener('change', () => {
    populateBridgeTokens('bridgeToChain', 'bridgeToToken');
  });
  $('bridgeFromToken').addEventListener('change', updateBridgeBalance);
  $('bridgeToToken').addEventListener('change', updateToTokenSecurity);
  $('bridgeToChain').addEventListener('change', () => setTimeout(updateToTokenSecurity, 50));

  // Security check for the destination token. We only spam GoPlus on actual
  // changes; results cache 1h on the backend.
  let __secReqId = 0;
  async function updateToTokenSecurity() {
    const slot = $('bridgeToSecurity');
    if (!slot) return;
    const opt = $('bridgeToToken').options[$('bridgeToToken').selectedIndex];
    if (!opt || opt.dataset.native === 'true') {
      slot.innerHTML = '<span class="sec-pill ok">native — без рисков</span>';
      return;
    }
    const chainKey = $('bridgeToChain').value;
    const addr = (opt.value || '').toLowerCase();
    if (!chainKey || !/^0x[0-9a-f]{40}$/.test(addr)) { slot.innerHTML = ''; return; }
    slot.innerHTML = '<span class="muted">проверяем…</span>';
    const reqId = ++__secReqId;
    try {
      const r = await fetch(`${API_BASE}/api/security/token?chain=${encodeURIComponent(chainKey)}&address=${addr}`);
      const j = await r.json();
      if (reqId !== __secReqId) return;  // newer request superseded
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      const cls = j.verdict === 'ok'   ? 'ok'
               : j.verdict === 'warn' ? 'warn'
               : j.verdict === 'bad'  ? 'bad' : 'warn';
      const icon = cls === 'ok' ? '✓' : cls === 'bad' ? '⛔' : '⚠';
      slot.innerHTML =
        `<span class="sec-pill ${cls}" title="${escapeHtml(j.verdict_reason || '')}">
           ${icon} ${escapeHtml(j.verdict_reason || j.verdict)}
         </span>`;
    } catch (e) {
      slot.innerHTML = `<span class="muted">проверка не прошла (${escapeHtml(e.message || e)})</span>`;
    }
  }
  // Live warning when the typed amount exceeds the on-chain balance.
  $('bridgeAmount').addEventListener('input', () => {
    const sel = $('bridgeFromToken');
    const opt = sel.options[sel.selectedIndex];
    if (!opt) return;
    const isNative = opt.dataset.native === 'true';
    const tokenAddr = (opt.value || '').toLowerCase();
    const chainKey = $('bridgeFromChain').value;
    const h = findHoldingForBridge(chainKey, tokenAddr, isNative);
    const v = parseFloat($('bridgeAmount').value);
    const inp = $('bridgeAmount');
    if (h && v > Number(h.amount) * 1.0001) {
      inp.style.borderColor = 'var(--red)';
      inp.title = 'Сумма больше доступного баланса';
    } else {
      inp.style.borderColor = '';
      inp.title = '';
    }
  });

  // Separate sections retain their own inputs while sharing the transaction executor.
  let exchangeMode = 'bridge';
  let exchangeReady = false;
  let exchangeOpenRevision = 0;
  let bridgeQuoteRevision = 0;
  const exchangeFormState = {};
  function exchangeChainsValid(mode, from, to) {
    return mode === 'swap' ? from === to : from !== to;
  }
  function syncExchangeNetworks() {
    const from = $('bridgeFromChain').value;
    const to = $('bridgeToChain');
    for (const option of to.options) option.disabled = exchangeMode === 'bridge' && option.value === from;
    if (exchangeMode === 'swap') to.value = from;
    else if (to.value === from || !to.value) {
      to.value = Array.from(to.options).find(o => !o.disabled)?.value || '';
    }
    to.disabled = exchangeMode === 'swap';
  }
  async function openExchangeSection(mode) {
    const revision = ++exchangeOpenRevision;
    if (exchangeReady) {
      exchangeFormState[exchangeMode] = Object.fromEntries(
        ['bridgeFromChain', 'bridgeToChain', 'bridgeFromToken', 'bridgeToToken', 'bridgeAmount']
          .map(id => [id, $(id).value]));
    }
    exchangeReady = false;
    exchangeMode = mode;
    ++bridgeQuoteRevision;
    bridgeRoutesByIdx = [];
    $(mode === 'swap' ? 'swapPane' : 'bridgePane').appendChild($('exchangeWorkspace'));
    $('exchangeTitle').textContent = mode === 'swap' ? 'Свапы' : 'Мосты между сетями';
    $('exchangeDescription').textContent = mode === 'swap'
      ? 'Обмен одного токена на другой в одной сети через LI.FI'
      : 'Перевод токенов из одной сети в другую через LI.FI';
    $('exchangeNetworkLabel').textContent = mode === 'swap' ? 'Сеть' : 'Из сети';
    $('exchangeDestinationNetwork').hidden = mode === 'swap';
    $('bridgeQuoteBtn').textContent = mode === 'swap' ? 'Найти свап' : 'Найти мост';
    $('bridgeQuoteBtn').disabled = true;
    $('bridgeResult').innerHTML = '<div class="empty">Загружаем список сетей…</div>';
    await loadRegistry();
    if (revision !== exchangeOpenRevision) return;
    if (!registryData) {
      $('bridgeResult').innerHTML = '<div class="error">Не удалось загрузить сети. Открой раздел ещё раз.</div>';
      return;
    }
    const saved = exchangeFormState[mode];
    populateBridgeChain('bridgeFromChain', saved?.bridgeFromChain || 'ethereum');
    populateBridgeChain('bridgeToChain', saved?.bridgeToChain || (mode === 'swap' ? 'ethereum' : 'arbitrum'));
    syncExchangeNetworks();
    populateBridgeTokens('bridgeFromChain', 'bridgeFromToken', mode === 'swap' ? 'ETH' : 'USDC');
    populateBridgeTokens('bridgeToChain', 'bridgeToToken', 'USDC');
    if (saved) {
      for (const id of ['bridgeFromToken', 'bridgeToToken']) {
        if (Array.from($(id).options).some(o => o.value === saved[id])) $(id).value = saved[id];
      }
    }
    $('bridgeAmount').value = saved?.bridgeAmount || '';
    $('bridgeAmount').style.borderColor = '';
    $('bridgeAmount').title = '';
    exchangeReady = true;
    $('bridgeQuoteBtn').disabled = false;
    $('bridgeResult').innerHTML = '<div class="empty">Выбери токены и сумму, затем нажми «' +
      (mode === 'swap' ? 'Найти свап' : 'Найти мост') + '».</div>';
    updateBridgeBalance();
    updateMevBanner();
    updateToTokenSecurity();
  }

  // ============== Protocol deep-links ================================
  // DeFiLlama is analytics-only; the user can't deposit from there. For each
  // common project we map to the protocol's actual web app where deposits
  // happen. Stable subdomains; rare to change. If a project isn't here, we
  // fall back to DeFiLlama and the user has to navigate from there.
  const PROTOCOL_LINKS = {
    'aave-v3':                       { name: 'Aave',         url: 'https://app.aave.com' },
    'aave-v2':                       { name: 'Aave (v2)',    url: 'https://app.aave.com' },
    'compound-v3':                   { name: 'Compound',     url: 'https://app.compound.finance' },
    'spark':                         { name: 'Spark',        url: 'https://app.spark.fi' },
    'morpho-blue':                   { name: 'Morpho',       url: 'https://app.morpho.org' },
    'lido':                          { name: 'Lido',         url: 'https://stake.lido.fi' },
    'rocket-pool':                   { name: 'Rocket Pool',  url: 'https://stake.rocketpool.net' },
    'eigenlayer':                    { name: 'EigenLayer',   url: 'https://app.eigenlayer.xyz' },
    'ether.fi-stake':                { name: 'ether.fi',     url: 'https://app.ether.fi' },
    'ether.fi-liquid':               { name: 'ether.fi',     url: 'https://app.ether.fi' },
    'kelp-dao':                      { name: 'Kelp',         url: 'https://www.kelpdao.xyz' },
    'renzo':                         { name: 'Renzo',        url: 'https://www.renzoprotocol.com' },
    'frax-ether':                    { name: 'Frax Ether',   url: 'https://frax.finance' },
    'pendle':                        { name: 'Pendle',       url: 'https://app.pendle.finance' },
    'curve-dex':                     { name: 'Curve',        url: 'https://curve.fi' },
    'convex-finance':                { name: 'Convex',       url: 'https://www.convexfinance.com' },
    'yearn-finance':                 { name: 'Yearn',        url: 'https://yearn.fi' },
    'balancer-v2':                   { name: 'Balancer',     url: 'https://app.balancer.fi' },
    'aura':                          { name: 'Aura',         url: 'https://app.aura.finance' },
    'beefy':                         { name: 'Beefy',        url: 'https://app.beefy.com' },
    'gearbox':                       { name: 'Gearbox',      url: 'https://app.gearbox.fi' },
    'fluid-lending':                 { name: 'Fluid',        url: 'https://fluid.instadapp.io' },
    'instadapp-lite':                { name: 'Instadapp',    url: 'https://lite.instadapp.io' },
    'silo-v1':                       { name: 'Silo',         url: 'https://app.silo.finance' },
    'silo-v2':                       { name: 'Silo',         url: 'https://v2.silo.finance' },
    'notional-v3':                   { name: 'Notional',     url: 'https://notional.finance' },
    'clearpool-lending':             { name: 'Clearpool',    url: 'https://clearpool.finance' },
    'maple':                         { name: 'Maple',        url: 'https://app.maple.finance' },
    'goldfinch':                     { name: 'Goldfinch',    url: 'https://app.goldfinch.finance' },
    'vesper':                        { name: 'Vesper',       url: 'https://app.vesper.finance/pools' },
    'uniswap-v3':                    { name: 'Uniswap',      url: 'https://app.uniswap.org/pools' },
    'sushiswap':                     { name: 'Sushi',        url: 'https://www.sushi.com/swap' },
    'velodrome-v2':                  { name: 'Velodrome',    url: 'https://velodrome.finance' },
    'aerodrome-v1':                  { name: 'Aerodrome',    url: 'https://aerodrome.finance' },
    'gmx-v2':                        { name: 'GMX',          url: 'https://app.gmx.io' },
    'gmx-v1':                        { name: 'GMX',          url: 'https://app.gmx.io' },
    'trader-joe-v2.1':               { name: 'Trader Joe',   url: 'https://traderjoexyz.com/avalanche/pool' },
    'pancakeswap-amm-v3':            { name: 'PancakeSwap',  url: 'https://pancakeswap.finance/liquidity' },
    'quickswap-v3':                  { name: 'QuickSwap',    url: 'https://quickswap.exchange/#/pools' },
    'stargate-v2':                   { name: 'Stargate',     url: 'https://stargate.finance/pool' },
    'radiant-v2':                    { name: 'Radiant',      url: 'https://app.radiant.capital' },
    'lista-lending':                 { name: 'Lista',        url: 'https://lista.org' },
    'ondo-finance':                  { name: 'Ondo',         url: 'https://ondo.finance' },
    'extra-finance-leverage-farming':{ name: 'Extra',        url: 'https://app.extrafi.io' },
    'ankr-staking':                  { name: 'Ankr',         url: 'https://www.ankr.com/staking' },
    'jito-liquid-staking':           { name: 'Jito',         url: 'https://www.jito.network' },
    'cellar':                        { name: 'Sommelier',    url: 'https://app.somm.finance' },
  };

  function protocolLink(project) {
    return PROTOCOL_LINKS[project] || null;
  }

  // ============== Gas estimation =====================================
  // Returns { gwei, gas_units, native_gwei, eth, usd, rub, label } for a given
  // {to, data, value, from} on the named chain. Best-effort — partial fields
  // returned if some lookups fail.
  async function estimateGasCost(chainKey, tx) {
    try {
      const gasUnits = await getWallet().request({
        method: 'eth_estimateGas',
        params: [tx],
      });
      const units = parseInt(gasUnits, 16);
      // Pull current gas price from our /api/gas snapshot (already cached).
      let gwei = 0;
      try {
        const r = await fetch(API_BASE + '/api/gas');
        const d = await r.json();
        const e = (d.chains || []).find(c => c.chain_key === chainKey);
        if (e) gwei = Number(e.gwei) || 0;
      } catch (_) {}
      const eth = units * gwei * 1e-9;             // gas units × gwei × 1e-9 = native
      // Native USD: fish from the user's last scan (most chains share ETH).
      let usdPrice = 0;
      if (lastScanData?.holdings) {
        const native = lastScanData.holdings.find(h => h.chain_key === chainKey && h.is_native);
        if (native && native.price_usd > 0) usdPrice = Number(native.price_usd);
      }
      const usd = eth * usdPrice;
      const rub = usd * Number(lastScanData?.usd_rub_rate || 0);
      const symbol = (lastScanData?.holdings || []).find(h => h.chain_key === chainKey && h.is_native)?.symbol
                   || 'native';
      return { gwei, gas_units: units, eth, usd, rub, symbol,
               label: gasLabel(eth, symbol, usd, rub) };
    } catch (e) {
      return { error: e?.message || String(e), label: 'не удалось оценить газ' };
    }
  }
  function gasLabel(eth, symbol, usd, rub) {
    if (!(eth > 0)) return '';
    const ethStr = eth.toFixed(eth >= 0.001 ? 6 : 8);
    const parts = [`${ethStr} ${escapeHtml(symbol)}`];
    if (usd > 0) parts.push('≈ ' + fmtMoney(usd, 'USD'));
    if (rub > 0) parts.push(fmtMoney(rub, 'RUB'));
    return 'Газ: ' + parts.join(' · ');
  }

  // ============== Aave V3 / Spark deposit ============================
  // ABI: Pool.supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)
  //   selector keccak("supply(address,uint256,address,uint16)")[:4] = 0x617ba037
  function encodeAaveSupply(asset, amountDec, onBehalfOf) {
    const sel = '617ba037';
    const a   = asset.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const am  = BigInt(amountDec).toString(16).padStart(64, '0');
    const obo = onBehalfOf.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const ref = '0'.repeat(64);  // referralCode = 0
    return '0x' + sel + a + am + obo + ref;
  }

  // A small modal that asks for the deposit amount before kicking off the
  // approve + supply flow. Returns the user-entered amount (as a string in
  // human units), or null if cancelled.
  function showDepositInputModal(pool, holding, projectedMonthlyUsd) {
    return new Promise(resolve => {
      closeSwapModal();
      const back = document.createElement('div');
      back.className = 'modal-backdrop';
      back.id = 'swapModal';
      const monthlyHint = projectedMonthlyUsd > 0
        ? `<p class="muted" style="font-size:11px;margin:4px 0 12px;">
             Доход на этой сумме ≈ <span style="color:var(--green)">${fmtMoney(projectedMonthlyUsd, 'USD')}/мес</span>
             ${lastScanData?.usd_rub_rate ? `· ${fmtMoney(projectedMonthlyUsd * lastScanData.usd_rub_rate, 'RUB')}/мес` : ''}
           </p>`
        : '';
      back.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <h3>Депозит в Aave V3</h3>
          <p class="muted" style="font-size:13px;margin:0 0 4px;">
            ${escapeHtml(holding.symbol)} · ${escapeHtml(pool.chain_key)} ·
            APY ${pool.apy.toFixed(2)}%
          </p>
          <p class="muted" style="font-size:13px;margin:0 0 12px;">
            Доступно: <span class="mono">${fmtNumber(holding.amount, 8)} ${escapeHtml(holding.symbol)}</span>
            ${holding.value_usd ? `· ${fmtMoney(holding.value_usd, 'USD')}` : ''}
          </p>
          ${monthlyHint}
          <input id="depAmt" type="number" step="0.000001" value="${escapeHtml(holding.amount)}"
                 style="width:100%;background:var(--panel-3);color:var(--fg);
                        border:1px solid var(--border);border-radius:8px;
                        padding:9px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
                        font-size:14px;" />
          <div class="modal-actions">
            <button id="depCancel" type="button">Отмена</button>
            <button id="depMax" type="button">MAX</button>
            <button id="depGo" class="primary" type="button">Депозитить</button>
          </div>
          <p class="muted" style="font-size:11px;margin:12px 0 0;">
            Будет 2 транзакции: approve + supply. Газ оплачиваешь ты, в нативном токене сети.
          </p>
        </div>`;
      document.body.appendChild(back);

      const finish = (val) => { closeSwapModal(); resolve(val); };
      $('depMax').addEventListener('click', () => { $('depAmt').value = holding.amount; });
      $('depCancel').addEventListener('click', () => finish(null));
      $('depGo').addEventListener('click', () => {
        const v = ($('depAmt').value || '').trim();
        if (!v || !(parseFloat(v) > 0)) return alert('Введи положительную сумму');
        finish(v);
      });
      $('depAmt').focus();
      $('depAmt').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('depGo').click();
        if (e.key === 'Escape') $('depCancel').click();
      });
    });
  }

  async function executeAaveDeposit(idx) {
    return executeLendingDeposit(idx, 'aave_v3_pool', 'Aave V3');
  }
  async function executeSparkDeposit(idx) {
    return executeLendingDeposit(idx, 'spark_pool', 'Spark');
  }
  async function executeLendingDeposit(idx, poolField, protocolName) {
    const pool = (window.__yieldPools || [])[idx];
    if (!pool) return alert('Пул не найден');
    if (!getWallet()) return alert('MetaMask не установлен');
    if (!registryData) await loadRegistry();

    const chain = registryData?.chains.find(c => c.key === pool.chain_key);
    if (!chain) return alert('Сеть не поддерживается приложением');
    if (!chain[poolField]) return alert(`Адрес ${protocolName} Pool для этой сети не настроен`);
    const poolAddr = chain[poolField];

    // Find the underlying token in our registry (DeFiLlama pool symbol matches it).
    const tok = chain.tokens.find(t =>
      (t.symbol || '').toUpperCase() === (pool.symbol || '').toUpperCase());
    if (!tok) {
      return alert(`Токен ${pool.symbol} не в реестре приложения. Добавь его в config/tokens.json и пересобери.`);
    }
    if (tok.is_native) {
      return alert(`${protocolName} не принимает нативный токен напрямую. Используй WETH/WMATIC и т.д.`);
    }

    // Find user's matching holding (must exist — button is gated on it).
    const holding = lastScanData?.holdings.find(h =>
      h.chain_key === chain.key &&
      (h.symbol || '').toUpperCase() === (tok.symbol || '').toUpperCase() &&
      !h.is_native);
    if (!holding) return alert(`Нет ${tok.symbol} на твоём адресе в сети ${chain.name}`);

    // Ask for amount.
    const projectedMonthly = (Number(holding.value_usd) || 0) * (pool.apy / 100) / 12;
    const humanAmt = await showDepositInputModal(pool, holding, projectedMonthly);
    if (!humanAmt) return;
    const rawAmount = scaleAmount(humanAmt, tok.decimals);
    if (!rawAmount || rawAmount === '0') return alert('Неверная сумма');

    // Sanity check: not more than balance.
    const balanceRaw = scaleAmount(String(holding.amount), tok.decimals);
    if (balanceRaw && BigInt(rawAmount) > BigInt(balanceRaw)) {
      if (!confirm('Сумма больше баланса. Продолжить — Aave всё равно реверснёт. ОК?')) return;
    }

    // Progress modal: switch chain → approve → supply → wait.
    const steps = [
      `Переключиться на сеть «${chain.name}»`,
      `Approve ${tok.symbol} для ${protocolName}`,
      `Supply в ${protocolName}`,
      `Дождаться подтверждения`,
    ];
    showSwapModal(steps);
    let stepIdx = 0;
    const next = (state, detail) => setSwapStep(stepIdx, state, detail);

    try {
      // 1. Switch chain
      next('active');
      const accs = await getWallet().request({ method: 'eth_requestAccounts' });
      if (!accs || !accs.length) throw new Error('Аккаунт не подключён');
      const wallet = accs[0];
      const cur = await getWallet().request({ method: 'eth_chainId' });
      if (parseInt(cur, 16) !== chain.chain_id) {
        await getWallet().request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex(chain.chain_id) }],
        });
      }
      next('done', `аккаунт <span class="mono">${wallet.slice(0,6)}…${wallet.slice(-4)}</span>`);
      stepIdx++;

      // 2. Approve
      const approveTx = {
        from: wallet,
        to: tok.address,
        data: encodeApprove(poolAddr, rawAmount),
      };
      const apprGas = await estimateGasCost(chain.key, approveTx);
      next('active', apprGas.label || 'оцениваем газ…');
      const txApprove = await getWallet().request({
        method: 'eth_sendTransaction',
        params: [approveTx],
      });
      next('done', linkTx(chain, txApprove));
      stepIdx++;
      await waitForReceipt(txApprove);

      // 3. Supply
      const supplyData = encodeAaveSupply(tok.address, rawAmount, wallet);
      const supplyTx = { from: wallet, to: poolAddr, data: supplyData };
      const supGas = await estimateGasCost(chain.key, supplyTx);
      next('active', supGas.label || 'оцениваем газ…');
      const txSupply = await getWallet().request({
        method: 'eth_sendTransaction',
        params: [supplyTx],
      });
      next('done', linkTx(chain, txSupply));
      stepIdx++;

      // 4. Receipt
      next('active');
      await waitForReceipt(txSupply);
      next('done', 'депозит зачислен');
    } catch (e) {
      console.error(e);
      next('error', escapeHtml(e?.message || String(e)));
    }
  }
  window.executeAaveDeposit = executeAaveDeposit;
  window.executeSparkDeposit = executeSparkDeposit;

  // ---- Aave V3 withdraw -----------------------------------------------
  // ABI: Pool.withdraw(address asset, uint256 amount, address to)
  //   selector keccak("withdraw(address,uint256,address)")[:4] = 0x69328dec
  // Pass amount = 2^256-1 to withdraw the full balance (Aave magic value).
  function encodeAaveWithdraw(asset, amountDec, to) {
    const sel = '69328dec';
    const a   = asset.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const am  = BigInt(amountDec).toString(16).padStart(64, '0');
    const t   = to.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    return '0x' + sel + a + am + t;
  }

  async function executeAaveWithdraw(idx) {
    const pos = (window.__aaveSupplies || [])[idx];
    if (!pos) return alert('Позиция не найдена');
    if (!getWallet()) return alert('MetaMask не установлен');
    if (!registryData) await loadRegistry();
    const chain = registryData?.chains.find(c => c.key === pos.chain_key);
    if (!chain) return alert('Сеть не поддерживается');
    // Spark uses the same withdraw ABI, just a different pool address.
    const isSpark = pos.protocol === 'Spark';
    const poolAddr = isSpark ? chain.spark_pool : chain.aave_v3_pool;
    if (!poolAddr) return alert(`Адрес ${pos.protocol} Pool не настроен для этой сети`);

    // Suggest the full balance by default; user can edit.
    const suggested = pos.amount0 || '';
    const human = prompt(
      `Снять с Aave V3:\n\n${pos.token0_symbol} (${chain.name})\nДоступно: ${suggested}\n\nСумма для снятия (или MAX = всё):`,
      suggested);
    if (!human) return;

    let rawAmount;
    if (human.toUpperCase() === 'MAX') {
      // Aave's "withdraw all" sentinel.
      rawAmount = ((1n << 256n) - 1n).toString();
    } else {
      rawAmount = scaleAmount(human.trim(), pos.decimals0 || 18);
      if (!rawAmount || rawAmount === '0') return alert('Неверная сумма');
    }

    showSwapModal([
      `Переключиться на сеть «${chain.name}»`,
      `Withdraw ${pos.token0_symbol} из ${pos.protocol}`,
      `Дождаться подтверждения`,
    ]);
    let stepIdx = 0;
    const next = (state, detail) => setSwapStep(stepIdx, state, detail);

    try {
      next('active');
      const accs = await getWallet().request({ method: 'eth_requestAccounts' });
      const wallet = accs[0];
      const cur = await getWallet().request({ method: 'eth_chainId' });
      if (parseInt(cur, 16) !== chain.chain_id) {
        await getWallet().request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex(chain.chain_id) }],
        });
      }
      next('done', `аккаунт <span class="mono">${wallet.slice(0,6)}…${wallet.slice(-4)}</span>`);
      stepIdx++;

      const tx = {
        from: wallet,
        to: poolAddr,
        data: encodeAaveWithdraw(pos.token0_address, rawAmount, wallet),
      };
      const gas = await estimateGasCost(chain.key, tx);
      next('active', gas.label || 'оцениваем газ…');
      const txHash = await getWallet().request({
        method: 'eth_sendTransaction',
        params: [tx],
      });
      next('done', linkTx(chain, txHash));
      stepIdx++;

      next('active');
      await waitForReceipt(txHash);
      next('done', 'средства возвращены на твой кошелёк');
    } catch (e) {
      console.error(e);
      next('error', escapeHtml(e?.message || String(e)));
    }
  }
  window.executeAaveWithdraw = executeAaveWithdraw;

  // ============== Compound V3 deposit / withdraw =====================
  // Comet ABI:
  //   supply(address, uint256)    -> 0xf2b9fdb8
  //   withdraw(address, uint256)  -> 0xf3fef3a3
  function encodeCometSupply(asset, amountDec) {
    const a  = asset.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const am = BigInt(amountDec).toString(16).padStart(64, '0');
    return '0x' + 'f2b9fdb8' + a + am;
  }
  function encodeCometWithdraw(asset, amountDec) {
    const a  = asset.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const am = BigInt(amountDec).toString(16).padStart(64, '0');
    return '0x' + 'f3fef3a3' + a + am;
  }

  async function executeCompoundDeposit(idx) {
    const pool = (window.__yieldPools || [])[idx];
    if (!pool) return alert('Пул не найден');
    if (!getWallet()) return alert('MetaMask не установлен');
    if (!registryData) await loadRegistry();
    const chain = registryData?.chains.find(c => c.key === pool.chain_key);
    if (!chain) return alert('Сеть не поддерживается');

    // Find which Comet market matches the pool's symbol.
    const market = (chain.compound_v3_markets || []).find(
      m => (m.base_symbol || '').toUpperCase() === (pool.symbol || '').toUpperCase());
    if (!market) {
      return alert(`Compound V3 market для ${pool.symbol} не настроен в этой сети`);
    }

    const holding = lastScanData?.holdings.find(h =>
      h.chain_key === chain.key &&
      (h.symbol || '').toUpperCase() === (market.base_symbol || '').toUpperCase() &&
      !h.is_native);
    if (!holding) return alert(`Нет ${market.base_symbol} на твоём адресе в сети ${chain.name}`);

    const projectedMonthly = (Number(holding.value_usd) || 0) * (pool.apy / 100) / 12;
    const humanAmt = await showDepositInputModal(
      { ...pool, project: 'compound-v3', chain_key: chain.key },
      holding, projectedMonthly);
    if (!humanAmt) return;
    const rawAmount = scaleAmount(humanAmt, market.base_decimals);
    if (!rawAmount || rawAmount === '0') return alert('Неверная сумма');

    showSwapModal([
      `Переключиться на сеть «${chain.name}»`,
      `Approve ${market.base_symbol} для Compound V3`,
      `Supply в Compound V3 (${market.base_symbol} market)`,
      `Дождаться подтверждения`,
    ]);
    let stepIdx = 0;
    const next = (s, d) => setSwapStep(stepIdx, s, d);

    try {
      next('active');
      const accs = await getWallet().request({ method: 'eth_requestAccounts' });
      const wallet = accs[0];
      const cur = await getWallet().request({ method: 'eth_chainId' });
      if (parseInt(cur, 16) !== chain.chain_id) {
        await getWallet().request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex(chain.chain_id) }],
        });
      }
      next('done', `аккаунт <span class="mono">${wallet.slice(0,6)}…${wallet.slice(-4)}</span>`);
      stepIdx++;

      const apprTx = { from: wallet, to: market.base_address,
                       data: encodeApprove(market.comet, rawAmount) };
      const apprGas = await estimateGasCost(chain.key, apprTx);
      next('active', apprGas.label || '');
      const txA = await getWallet().request({ method: 'eth_sendTransaction', params: [apprTx] });
      next('done', linkTx(chain, txA));
      stepIdx++;
      await waitForReceipt(txA);

      const supTx = { from: wallet, to: market.comet,
                      data: encodeCometSupply(market.base_address, rawAmount) };
      const supGas = await estimateGasCost(chain.key, supTx);
      next('active', supGas.label || '');
      const txS = await getWallet().request({ method: 'eth_sendTransaction', params: [supTx] });
      next('done', linkTx(chain, txS));
      stepIdx++;

      next('active');
      await waitForReceipt(txS);
      next('done', 'депозит зачислен');
    } catch (e) {
      console.error(e);
      next('error', escapeHtml(e?.message || String(e)));
    }
  }
  window.executeCompoundDeposit = executeCompoundDeposit;

  // Withdraw is invoked from the DeFi positions tab on a Compound V3 supply row.
  window.__compoundSupplies = [];
  async function executeCompoundWithdraw(idx) {
    const pos = (window.__compoundSupplies || [])[idx];
    if (!pos) return alert('Позиция не найдена');
    if (!getWallet()) return alert('MetaMask не установлен');
    if (!registryData) await loadRegistry();
    const chain = registryData?.chains.find(c => c.key === pos.chain_key);
    if (!chain) return alert('Сеть не поддерживается');
    const market = (chain.compound_v3_markets || []).find(
      m => m.base_address.toLowerCase() === (pos.token0_address || '').toLowerCase());
    if (!market) return alert('Не нашли Compound market для этой позиции');

    const human = prompt(
      `Снять с Compound V3:\n\n${pos.token0_symbol} (${chain.name})\nДоступно: ${pos.amount0}\n\n` +
      `Сумма (или MAX = всё):`, pos.amount0 || '');
    if (!human) return;
    let rawAmount;
    if (human.toUpperCase() === 'MAX') {
      rawAmount = ((1n << 256n) - 1n).toString();
    } else {
      rawAmount = scaleAmount(human.trim(), market.base_decimals);
      if (!rawAmount || rawAmount === '0') return alert('Неверная сумма');
    }

    showSwapModal([
      `Переключиться на сеть «${chain.name}»`,
      `Withdraw ${market.base_symbol} из Compound V3`,
      `Дождаться подтверждения`,
    ]);
    let stepIdx = 0;
    const next = (s, d) => setSwapStep(stepIdx, s, d);

    try {
      next('active');
      const accs = await getWallet().request({ method: 'eth_requestAccounts' });
      const wallet = accs[0];
      const cur = await getWallet().request({ method: 'eth_chainId' });
      if (parseInt(cur, 16) !== chain.chain_id) {
        await getWallet().request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex(chain.chain_id) }],
        });
      }
      next('done');
      stepIdx++;

      const tx = { from: wallet, to: market.comet,
                   data: encodeCometWithdraw(market.base_address, rawAmount) };
      const gas = await estimateGasCost(chain.key, tx);
      next('active', gas.label || '');
      const txH = await getWallet().request({ method: 'eth_sendTransaction', params: [tx] });
      next('done', linkTx(chain, txH));
      stepIdx++;

      next('active');
      await waitForReceipt(txH);
      next('done', 'средства возвращены');
    } catch (e) {
      console.error(e);
      next('error', escapeHtml(e?.message || String(e)));
    }
  }
  window.executeCompoundWithdraw = executeCompoundWithdraw;

  // ============== Lido stETH staking =================================
  // Lido contract on Ethereum mainnet only.
  const LIDO_ETH_CONTRACT = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84';
  // submit(address referrer) -> 0xa1903eab
  function encodeLidoSubmit(referrer) {
    const r = (referrer || '0x0000000000000000000000000000000000000000')
              .toLowerCase().replace(/^0x/, '').padStart(64, '0');
    return '0x' + 'a1903eab' + r;
  }
  async function executeLidoStake(idx) {
    const pool = (window.__yieldPools || [])[idx];
    if (!pool) return alert('Пул не найден');
    if (!getWallet()) return alert('MetaMask не установлен');
    if (pool.chain_key !== 'ethereum') {
      return alert('Lido работает только в Ethereum mainnet');
    }
    if (!registryData) await loadRegistry();
    const chain = registryData?.chains.find(c => c.key === 'ethereum');
    if (!chain) return alert('Конфиг Ethereum не найден');

    const ethHolding = lastScanData?.holdings.find(h => h.chain_key === 'ethereum' && h.is_native);
    const balanceStr = ethHolding ? String(ethHolding.amount) : '0';
    const human = prompt(
      `Стейк ETH через Lido (получишь stETH):\n\n` +
      `На балансе: ${balanceStr} ETH\n` +
      `APY ${pool.apy.toFixed(2)}%\n\n` +
      `Сколько ETH стейкать? (оставь немного на газ — 0.005-0.01 ETH)`,
      balanceStr ? Math.max(0, parseFloat(balanceStr) - 0.005).toFixed(6) : '');
    if (!human) return;
    const rawAmount = scaleAmount(human.trim(), 18);
    if (!rawAmount || rawAmount === '0') return alert('Неверная сумма');

    showSwapModal([
      `Переключиться на Ethereum`,
      `Стейк ETH через Lido (получишь stETH)`,
      `Дождаться подтверждения`,
    ]);
    let stepIdx = 0;
    const next = (s, d) => setSwapStep(stepIdx, s, d);

    try {
      next('active');
      const accs = await getWallet().request({ method: 'eth_requestAccounts' });
      const wallet = accs[0];
      const cur = await getWallet().request({ method: 'eth_chainId' });
      if (parseInt(cur, 16) !== 1) {
        await getWallet().request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x1' }],
        });
      }
      next('done');
      stepIdx++;

      const tx = {
        from: wallet,
        to: LIDO_ETH_CONTRACT,
        data: encodeLidoSubmit(null),
        value: '0x' + BigInt(rawAmount).toString(16),
      };
      const gas = await estimateGasCost('ethereum', tx);
      next('active', gas.label || '');
      const txH = await getWallet().request({ method: 'eth_sendTransaction', params: [tx] });
      next('done', linkTx(chain, txH));
      stepIdx++;

      next('active');
      await waitForReceipt(txH);
      next('done', 'stETH зачислен — токен сразу начнёт расти от стейкинг-наград');
    } catch (e) {
      console.error(e);
      next('error', escapeHtml(e?.message || String(e)));
    }
  }
  window.executeLidoStake = executeLidoStake;

  // ============== Yield scanner ======================================
  function buildYieldQuery() {
    const params = new URLSearchParams();

    // Pull symbols + chains the user actually holds.
    const mySymbols = new Set();
    const myChains  = new Set();
    if (lastScanData?.holdings) {
      for (const h of lastScanData.holdings) {
        if (h.symbol) mySymbols.add(h.symbol.toUpperCase());
        if (h.chain_key) myChains.add(h.chain_key);
      }
    }

    if ($('yldOnlyMyTokens').checked && mySymbols.size > 0) {
      params.set('symbols', Array.from(mySymbols).join(','));
    }
    if ($('yldOnlyMyChains').checked && myChains.size > 0) {
      params.set('chains', Array.from(myChains).join(','));
    }
    const minTvl = parseFloat($('yldMinTvl').value);
    if (!isNaN(minTvl) && minTvl > 0) params.set('min_tvl', String(minTvl));
    const minApy = parseFloat($('yldMinApy').value);
    if (!isNaN(minApy)) params.set('min_apy', String(minApy));
    if ($('yldStableOnly').checked) params.set('stable_only', '1');
    if ($('yldNoIL').checked)       params.set('no_il', '1');
    if ($('yldSingleOnly').checked) params.set('single_only', '1');
    params.set('limit', '60');
    return params;
  }

  async function refreshYields() {
    const root = $('yieldResult');
    root.innerHTML = '<div class="loading">Опрашиваем DeFiLlama (первый раз грузит ~5 МБ — пара секунд)…</div>';
    try {
      const params = buildYieldQuery();
      const url = `${API_BASE}/api/yield/scan?${params.toString()}`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'HTTP ' + resp.status);
      renderYields(data);
      // Also rebuild the optimizer view — fresh yield data may change the
      // "best alternative" picks.
      await ensureIdleYieldCache();
      renderYieldOptimizer();
    } catch (e) {
      root.innerHTML = `<div class="error">Ошибка: ${escapeHtml(e.message || e)}</div>`;
    }
  }

  function apyClass(apy) {
    if (apy >= 8) return 'high';
    if (apy >= 3) return 'med';
    return 'low';
  }

  // Find holdings that match a yield pool — same chain + symbol appears in the
  // pool's symbol token list. Returns total USD value the user already has
  // available to deposit into this pool.
  function holdingsForPool(pool) {
    if (!lastScanData?.holdings) return { total_usd: 0, items: [] };
    const parts = (pool.symbol || '').split(/[-+/ ]/).map(s => s.toUpperCase()).filter(Boolean);
    const items = lastScanData.holdings.filter(h =>
      h.chain_key === pool.chain_key &&
      parts.includes((h.symbol || '').toUpperCase())
    );
    const total_usd = items.reduce((a, h) => a + Number(h.value_usd || 0), 0);
    return { total_usd, items };
  }

  function renderYields(data) {
    const root = $('yieldResult');
    const pools = data.pools || [];
    if (!pools.length) {
      root.innerHTML = `<div class="empty">Подходящих пулов не найдено. Попробуй ослабить фильтры (снизить TVL или APY).</div>`;
      return;
    }
    const rubRate = Number(lastScanData?.usd_rub_rate || 0);
    let html = `<div class="muted" style="font-size:11px;margin-bottom:10px;">
      найдено ${pools.length} из ${data.cached || '?'} в кэше DeFiLlama · сортировка по APY
    </div>`;
    html += `
      <table>
        <thead><tr>
          <th>Сеть</th>
          <th>Протокол · пул</th>
          <th class="num">TVL</th>
          <th class="num">APY</th>
          <th class="num" title="На твой текущий баланс этого токена в этой сети">Доход / мес</th>
          <th>Метки</th>
          <th></th>
        </tr></thead>
        <tbody>`;
    pools.forEach((p, idx) => {
      const cls = apyClass(p.apy);
      const reward = p.apy_reward > 0
        ? `<span class="apy-sub">${(p.apy_base || 0).toFixed(2)}% база + ${p.apy_reward.toFixed(2)}% reward</span>`
        : '';
      const meanLine = p.apy_mean_30d > 0
        ? `<span class="apy-sub" title="Средний APY за 30 дней">~ ${p.apy_mean_30d.toFixed(2)}% (30д)</span>`
        : '';

      const tags = [];
      if (p.stablecoin) tags.push('<span class="risk-tag r-stable">stable</span>');
      if (p.exposure === 'single') tags.push('<span class="risk-tag r-no">single</span>');
      else if (p.exposure === 'multi') tags.push('<span class="risk-tag r-multi">multi</span>');
      if (p.il_risk === 'yes') tags.push('<span class="risk-tag r-yes">IL</span>');
      else if (p.il_risk === 'no') tags.push('<span class="risk-tag r-no">no IL</span>');

      // Monthly earnings projection on user's actual balance.
      const { total_usd: balanceUsd } = holdingsForPool(p);
      let monthlyCell;
      if (balanceUsd > 0 && p.apy > 0) {
        const monthlyUsd = balanceUsd * (p.apy / 100) / 12;
        const monthlyRub = monthlyUsd * rubRate;
        monthlyCell = `
          <div class="apy-cell high">+ ${fmtMoney(monthlyUsd, 'USD')}</div>
          ${rubRate ? `<span class="apy-sub">≈ ${fmtMoney(monthlyRub, 'RUB')}</span>` : ''}
          <span class="apy-sub">на ${fmtMoney(balanceUsd, 'USD')}</span>`;
      } else {
        monthlyCell = `<span class="muted">—</span>
          <span class="apy-sub">нет в кошельке</span>`;
      }

      // Action: in-app deposit for protocols we have ABI bindings for; deep
      // link to the protocol's web app for the rest. DeFiLlama only as 📊.
      const inAppFn =
        (p.project === 'aave-v3' && balanceUsd > 0) ? `executeAaveDeposit(${idx})` :
        (p.project === 'spark'   && balanceUsd > 0) ? `executeSparkDeposit(${idx})` :
        (p.project === 'compound-v3' && balanceUsd > 0) ? `executeCompoundDeposit(${idx})` :
        (p.project === 'lido' && p.chain_key === 'ethereum') ? `executeLidoStake(${idx})` :
        null;
      const link   = protocolLink(p.project);
      let actionCell;
      if (inAppFn) {
        const label = p.project === 'lido' ? 'Стейк' : 'Депозит';
        actionCell = `<button class="swap-btn" onclick="${inAppFn}" title="In-app через MetaMask">${label}</button>`;
      } else if (link) {
        actionCell = `<a class="swap-btn" href="${escapeHtml(link.url)}" target="_blank" rel="noopener"
                         title="Открыть приложение ${escapeHtml(link.name)} — там можно депозитить"
                         style="text-decoration:none;display:inline-block;">В ${escapeHtml(link.name)} ↗</a>`;
      } else {
        actionCell = `<a class="swap-btn" href="${escapeHtml(p.url)}" target="_blank" rel="noopener"
                         title="Не нашли прямой ссылки на протокол — открой DeFiLlama, там в правом верхнем углу пула есть кнопка 'Open Pool'"
                         style="text-decoration:none;display:inline-block;">Аналитика ↗</a>`;
      }
      // Always also show small DeFiLlama icon for analytics (charts/holders).
      actionCell += ` <a class="tiny-link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener"
                          title="DeFiLlama: история APY, держатели, ликвидность">📊</a>`;

      // Stash the pool data so the click handler can find it without DOM walks.
      window.__yieldPools = window.__yieldPools || [];
      window.__yieldPools[idx] = p;

      const rowCls = balanceUsd > 0 ? 'holding-row owned' : 'holding-row';
      html += `
        <tr class="${rowCls}">
          <td>${chainBadge(p.chain_key)}</td>
          <td>
            <div class="token-name">${escapeHtml(p.project)}</div>
            <div class="token-sub">${escapeHtml(p.symbol)}</div>
          </td>
          <td class="num">${fmtMoney(p.tvl_usd, 'USD')}</td>
          <td class="num">
            <span class="apy-cell ${cls}">${p.apy.toFixed(2)}%</span>
            ${reward}
            ${meanLine}
          </td>
          <td class="num">${monthlyCell}</td>
          <td>${tags.join(' ')}</td>
          <td class="num">${actionCell}</td>
        </tr>`;
    });
    html += '</tbody></table>';
    root.innerHTML = html;
  }

  // ============== Yield optimizer ====================================
  // The optimizer compares each holding (and existing DeFi position) against
  // the best safe pool we have data for, and suggests concrete moves.
  //
  // Approximations (deliberate, for honesty):
  //   * "current APY" of an idle holding = 0%
  //   * "current APY" of a known DeFi supply = pool APY for that protocol+token
  //     if we can match it; otherwise 0 (conservative)
  //   * Bridge cost is rough: $1 on L2s, $5 on Ethereum
  //   * No accounting for slippage on swap-and-deposit
  // The numbers are directional, not financial advice.
  function bestPoolByPredicate(pools, pred) {
    let best = null;
    for (const p of pools) {
      if (!pred(p)) continue;
      if (!best || p.apy > best.apy) best = p;
    }
    return best;
  }
  function existingApyForHolding(h, scan) {
    // If the user already supplied this token in any known protocol on this
    // chain, treat that protocol's APY as their current rate.
    const positions = scan?.defi_positions || [];
    const sym = (h.symbol || '').toUpperCase();
    for (const p of positions) {
      if (p.kind !== 'supply') continue;
      if (p.chain_key !== h.chain_key) continue;
      if ((p.token0_symbol || '').toUpperCase() !== sym) continue;
      // We don't store APY on positions — return 0 here; UI will show "?"
      // when the position exists but the optimizer can't be sure of APY.
      return null;
    }
    return 0;  // truly idle
  }
  function estBridgeCostUsd(fromChain, toChain) {
    if (fromChain === toChain) return 0;
    // Very rough — Ethereum is the expensive one, L2-to-L2 is pennies.
    if (fromChain === 'ethereum' || toChain === 'ethereum') return 5.0;
    return 1.0;
  }

  function renderYieldOptimizer() {
    const card = $('yieldOptimizer');
    const body = $('optimizerBody');
    if (!card || !body) return;
    if (!lastScanData?.holdings || !idleYieldCache) {
      card.style.display = 'none';
      return;
    }
    const rubRate = Number(lastScanData.usd_rub_rate || 0);

    // Walk holdings, compute (current apy, best in-chain alt, best cross-chain alt).
    const recs = [];
    let totalUsd = 0, weightedCurrentApy = 0, weightedBestApy = 0;
    for (const h of lastScanData.holdings) {
      const valUsd = Number(h.value_usd) || 0;
      if (valUsd < 10) continue;     // dust
      totalUsd += valUsd;

      const curApy = existingApyForHolding(h, lastScanData);  // 0 = idle, null = unknown DeFi
      const sym = (h.symbol || '').toUpperCase();

      // Best same-chain alternative — single-symbol pools only (no LP).
      const sameChain = bestPoolByPredicate(idleYieldCache, (p) =>
        p.chain_key === h.chain_key &&
        (p.symbol || '').toUpperCase() === sym &&
        (p.exposure === 'single' || (p.symbol || '').indexOf('-') < 0) &&
        p.il_risk !== 'yes' && p.tvl_usd >= 5_000_000);

      // Best cross-chain alternative.
      const crossChain = bestPoolByPredicate(idleYieldCache, (p) =>
        p.chain_key !== h.chain_key &&
        (p.symbol || '').toUpperCase() === sym &&
        (p.exposure === 'single' || (p.symbol || '').indexOf('-') < 0) &&
        p.il_risk !== 'yes' && p.tvl_usd >= 5_000_000);

      const knownCur = curApy === null ? 0 : curApy;
      weightedCurrentApy += valUsd * knownCur;

      // Pick the most attractive of the two alternatives, accounting for bridge cost.
      const candidates = [];
      if (sameChain) {
        candidates.push({
          pool: sameChain, apy: sameChain.apy,
          gainPctYr: Math.max(0, sameChain.apy - knownCur),
          bridgeCost: 0, sameChain: true,
        });
      }
      if (crossChain && (!sameChain || crossChain.apy > sameChain.apy + 0.5)) {
        const cost = estBridgeCostUsd(h.chain_key, crossChain.chain_key);
        const yearlyGainUsd = valUsd * (crossChain.apy - knownCur) / 100;
        const breakEvenDays = yearlyGainUsd > 0 ? (cost / yearlyGainUsd) * 365 : Infinity;
        candidates.push({
          pool: crossChain, apy: crossChain.apy,
          gainPctYr: Math.max(0, crossChain.apy - knownCur),
          bridgeCost: cost, breakEvenDays, sameChain: false,
        });
      }
      const best = candidates.length ? candidates[0] : null;
      const bestApy = best ? best.apy : knownCur;
      weightedBestApy += valUsd * bestApy;

      // Skip recommendation if gain is tiny (<0.5%) or break-even is too long.
      if (best && (best.apy - knownCur) >= 0.5 &&
          (best.sameChain || (best.breakEvenDays || Infinity) <= 60)) {
        recs.push({ h, curApy, best });
      }
    }

    if (totalUsd === 0) { card.style.display = 'none'; return; }
    const curAvg  = weightedCurrentApy / totalUsd;
    const bestAvg = weightedBestApy / totalUsd;
    const gainUsdYear = totalUsd * (bestAvg - curAvg) / 100;
    const gainUsdMonth = gainUsdYear / 12;

    // If current ≈ optimal, hide entirely — no work to do.
    if (gainUsdYear < 1 && recs.length === 0) { card.style.display = 'none'; return; }

    card.style.display = '';

    // Sort recommendations by absolute monthly gain (high to low).
    recs.sort((a, b) => {
      const av = Number(a.h.value_usd) * (a.best.apy - (a.curApy || 0)) / 12 / 100;
      const bv = Number(b.h.value_usd) * (b.best.apy - (b.curApy || 0)) / 12 / 100;
      return bv - av;
    });

    let html = `
      <div class="opt-summary">
        <div class="opt-stat">
          <div class="label">Текущий APY портфеля</div>
          <div class="val">${curAvg.toFixed(2)}%</div>
          <div class="delta">взвешенно по USD</div>
        </div>
        <div class="opt-stat highlight">
          <div class="label">Потенциальный APY</div>
          <div class="val">${bestAvg.toFixed(2)}%</div>
          <div class="delta pos">+${(bestAvg - curAvg).toFixed(2)}% при тех же рисках</div>
        </div>
        <div class="opt-stat">
          <div class="label">Дополнительный доход</div>
          <div class="val">+${fmtMoney(gainUsdYear, 'USD')}/год</div>
          <div class="delta pos">${fmtMoney(gainUsdMonth, 'USD')}/мес${rubRate ? ' · ' + fmtMoney(gainUsdMonth * rubRate, 'RUB') : ''}</div>
        </div>
      </div>`;

    if (!recs.length) {
      html += '<div class="empty">Все твои позиции уже близки к оптимуму. 👍</div>';
      body.innerHTML = html;
      return;
    }

    html += '<h3 style="margin: 14px 0 8px; font-size: 14px;">Что можно сделать сейчас</h3>';
    window.__optRecs = recs;
    recs.forEach((r, idx) => {
      const valUsd = Number(r.h.value_usd) || 0;
      const monthly = valUsd * (r.best.apy - (r.curApy || 0)) / 100 / 12;
      const monthlyRub = monthly * rubRate;
      const cur = (r.curApy || 0).toFixed(2);
      const target = r.best.apy.toFixed(2);

      const breakEvenLine = r.best.sameChain
        ? `на той же сети`
        : (r.best.breakEvenDays !== undefined && r.best.breakEvenDays !== Infinity
             ? `мост ≈ ${fmtMoney(r.best.bridgeCost, 'USD')}, окупится за ${r.best.breakEvenDays.toFixed(0)} дн.`
             : 'требуется мост');
      const breakEvenCls = r.best.sameChain ? 'fast'
        : (r.best.breakEvenDays || 999) <= 14 ? 'fast'
        : (r.best.breakEvenDays || 999) <= 30 ? '' : 'slow';

      // Action: matches existing handlers when project supported in-app, else
      // deep link.
      const link = protocolLink(r.best.pool.project);
      const projectKnown = ['aave-v3','spark','compound-v3','lido']
        .includes(r.best.pool.project);
      const actHtml = (r.best.sameChain && projectKnown)
        ? `<button class="swap-btn" onclick="executeOptimizerStep(${idx})">Сделать</button>`
        : `<a class="swap-btn" href="${escapeHtml(link?.url || r.best.pool.url)}"
              target="_blank" rel="noopener" style="text-decoration:none;">
             ${r.best.sameChain ? 'В' : 'Через мост в'} ${escapeHtml(link?.name || r.best.pool.project)} ↗
           </a>`;

      html += `
        <div class="opt-row">
          <span>${chainBadge(r.h.chain_key)}</span>
          <div>
            <div class="arrow-from-to">
              <span><strong>${fmtNumber(r.h.amount, 6)} ${escapeHtml(r.h.symbol)}</strong>
                <span class="muted">· ${fmtMoney(valUsd, 'USD')}</span></span>
              <span class="step">→</span>
              <span class="protocol-tag">${escapeHtml(r.best.pool.project)}</span>
              ${r.best.sameChain
                ? ''
                : '<span class="step">на ' + escapeHtml((CHAIN_META[r.best.pool.chain_key]||{}).label || r.best.pool.chain_key) + '</span>'}
            </div>
            <div class="breakeven ${breakEvenCls}">
              ${cur}% → ${target}% · ${escapeHtml(breakEvenLine)}
            </div>
          </div>
          <div class="opt-gain">
            <div class="big">+${fmtMoney(monthly, 'USD')}/мес</div>
            ${rubRate ? `<div class="sub">≈ ${fmtMoney(monthlyRub, 'RUB')}</div>` : ''}
            <div class="sub">+${(r.best.apy - (r.curApy || 0)).toFixed(2)}% APY</div>
          </div>
          ${actHtml}
        </div>`;
    });
    body.innerHTML = html;
  }

  // For "Сделать" buttons in optimizer rows. Only fires for same-chain moves
  // into protocols we have ABI for; cross-chain still goes via deep link.
  async function executeOptimizerStep(idx) {
    const r = (window.__optRecs || [])[idx];
    if (!r) return;
    const project = r.best.pool.project;
    // Map this rec's pool back into our yield-table click handlers by
    // pretending it's a Yield-tab pool click.
    window.__yieldPools = window.__yieldPools || [];
    const fakeIdx = window.__yieldPools.length;
    window.__yieldPools.push(r.best.pool);

    if (project === 'aave-v3')      return executeAaveDeposit(fakeIdx);
    if (project === 'spark')        return executeSparkDeposit(fakeIdx);
    if (project === 'compound-v3')  return executeCompoundDeposit(fakeIdx);
    if (project === 'lido')         return executeLidoStake(fakeIdx);

    // Fallback: open the protocol UI.
    const link = protocolLink(project);
    if (link) window.open(link.url, '_blank');
    else window.open(r.best.pool.url, '_blank');
  }
  window.executeOptimizerStep = executeOptimizerStep;

  $('yldRefresh').addEventListener('click', refreshYields);
  // Auto-refresh on filter change (with light debounce).
  let yldDebounce = null;
  ['yldOnlyMyTokens','yldOnlyMyChains','yldStableOnly','yldNoIL','yldSingleOnly','yldMinTvl','yldMinApy'].forEach(id => {
    $(id).addEventListener('input', () => {
      clearTimeout(yldDebounce);
      yldDebounce = setTimeout(refreshYields, 300);
    });
  });
  // Lazy load the first time user opens the tab.
  document.querySelector('.tab[data-tab="yield"]').addEventListener('click', () => {
    if (!$('yieldResult').dataset.loaded) {
      $('yieldResult').dataset.loaded = '1';
      refreshYields();
    }
  });

  // ============== Approvals manager ==================================
  let lastApprovals = [];

  async function refreshApprovals() {
    const addr = $('addrInput').value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      $('apprResult').innerHTML = '<div class="error">Сначала введи адрес или подключи MetaMask.</div>';
      return;
    }
    $('apprResult').innerHTML = '<div class="loading">Сканируем allowance(...) по 7 сетям…</div>';
    try {
      const r = await fetch(`${API_BASE}/api/approvals?wallet=${addr}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
      lastApprovals = data.approvals || [];
      renderApprovals();
    } catch (e) {
      $('apprResult').innerHTML = `<div class="error">Ошибка: ${escapeHtml(e.message || e)}</div>`;
    }
  }

  function renderApprovals() {
    const root = $('apprResult');
    if (!lastApprovals.length) {
      root.innerHTML = '<div class="empty">Чисто! Нет активных approvals для известных контрактов.</div>';
      return;
    }
    let html = `<div class="muted" style="font-size:11px;margin-bottom:10px;">
      найдено ${lastApprovals.length} активных approvals · клик «Revoke» отзовёт разрешение через MetaMask
    </div>`;
    html += `
      <table>
        <thead><tr>
          <th>Сеть</th><th>Токен</th><th>Кому</th>
          <th class="num">Разрешено</th><th></th>
        </tr></thead>
        <tbody>`;
    lastApprovals.forEach((a, i) => {
      const tag = a.unlimited
        ? '<span class="risk-tag r-yes">UNLIMITED</span>'
        : '<span class="muted">' + escapeHtml(a.allowance_human) + '</span>';
      html += `
        <tr class="holding-row">
          <td>${chainBadge(a.chain_key)}</td>
          <td>
            <div class="token-name">${escapeHtml(a.token_symbol)}</div>
            <div class="token-sub mono">${escapeHtml(a.token_address.slice(0,8))}…${escapeHtml(a.token_address.slice(-6))}</div>
          </td>
          <td>
            <div>${escapeHtml(a.spender_label)}</div>
            <div class="token-sub mono">${escapeHtml(a.spender_address.slice(0,8))}…${escapeHtml(a.spender_address.slice(-6))}</div>
          </td>
          <td class="num">${tag}</td>
          <td>
            <button class="swap-btn" onclick="revokeApproval(${i})">Revoke</button>
          </td>
        </tr>`;
    });
    html += '</tbody></table>';
    root.innerHTML = html;
  }

  async function revokeApproval(idx) {
    const a = lastApprovals[idx];
    if (!a) return;
    if (!getWallet()) return alert('MetaMask не установлен');
    if (!registryData) await loadRegistry();
    const chain = registryData?.chains.find(c => c.key === a.chain_key);
    if (!chain) return alert('Сеть не поддерживается');

    const ok = confirm(
      `Отозвать разрешение для ${a.token_symbol} → ${a.spender_label}?\n\n` +
      `Будет одна транзакция: approve(spender, 0). Газ платишь ты.`
    );
    if (!ok) return;

    showSwapModal([
      `Переключиться на сеть «${chain.name}»`,
      `Revoke approve → 0`,
      `Дождаться подтверждения`,
    ]);
    let stepIdx = 0;
    const next = (state, detail) => setSwapStep(stepIdx, state, detail);

    try {
      next('active');
      const accs = await getWallet().request({ method: 'eth_requestAccounts' });
      const wallet = accs[0];
      const cur = await getWallet().request({ method: 'eth_chainId' });
      if (parseInt(cur, 16) !== chain.chain_id) {
        await getWallet().request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex(chain.chain_id) }],
        });
      }
      next('done', `аккаунт <span class="mono">${wallet.slice(0,6)}…${wallet.slice(-4)}</span>`);
      stepIdx++;

      const tx = {
        from: wallet,
        to: a.token_address,
        data: encodeApprove(a.spender_address, '0'),
      };
      const gas = await estimateGasCost(chain.key, tx);
      next('active', gas.label || 'отправка approve(spender, 0)');
      const txHash = await getWallet().request({
        method: 'eth_sendTransaction',
        params: [tx],
      });
      next('done', linkTx(chain, txHash));
      stepIdx++;

      next('active');
      await waitForReceipt(txHash);
      next('done', 'approve обнулён');
      // Refresh the list after a short delay so the UI shows the change.
      setTimeout(refreshApprovals, 2000);
    } catch (e) {
      console.error(e);
      next('error', escapeHtml(e?.message || String(e)));
    }
  }
  window.revokeApproval = revokeApproval;

  $('apprRefresh').addEventListener('click', refreshApprovals);
  document.querySelector('.tab[data-tab="approvals"]').addEventListener('click', () => {
    if (!$('apprResult').dataset.loaded) {
      $('apprResult').dataset.loaded = '1';
      refreshApprovals();
    }
  });

  // ============== Transaction history (Etherscan V2 Universal API) ========
  // One API key covers all 11 EVM chains. Free tier: 5 req/sec, 100k calls/day
  // — overkill for personal use. Key lives in localStorage, never touches the
  // server (so a public deploy doesn't leak keys).
  const TX_KEY = 'cryptoapp.etherscan_key';
  const TX_V2_URL = 'https://api.etherscan.io/v2/api';
  const TX_CHAIN_NAMES = {
    '1': 'ethereum', '42161': 'arbitrum', '10': 'optimism', '8453': 'base',
    '137': 'polygon', '56': 'bnb', '43114': 'avalanche', '100': 'gnosis',
    '59144': 'linea', '534352': 'scroll', '81457': 'blast',
  };
  const TX_EXPLORERS = {
    '1': 'https://etherscan.io',
    '42161': 'https://arbiscan.io',
    '10': 'https://optimistic.etherscan.io',
    '8453': 'https://basescan.org',
    '137': 'https://polygonscan.com',
    '56': 'https://bscscan.com',
    '43114': 'https://snowscan.xyz',
    '100': 'https://gnosisscan.io',
    '59144': 'https://lineascan.build',
    '534352': 'https://scrollscan.com',
    '81457': 'https://blastscan.io',
  };
  // Native symbol per chain, for txlist / internal (where value is in wei of native).
  const TX_NATIVE_SYMBOLS = {
    '1': 'ETH', '42161': 'ETH', '10': 'ETH', '8453': 'ETH',
    '137': 'POL', '56': 'BNB', '43114': 'AVAX', '100': 'xDAI',
    '59144': 'ETH', '534352': 'ETH', '81457': 'ETH',
  };

  function getEtherscanKey() {
    try { return localStorage.getItem(TX_KEY) || ''; } catch (_) { return ''; }
  }
  function setEtherscanKey(k) {
    try {
      if (k) localStorage.setItem(TX_KEY, k);
      else localStorage.removeItem(TX_KEY);
    } catch (_) {}
  }

  function openApiKeyModal() {
    const cur = getEtherscanKey();
    const backdrop = document.createElement('div');
    backdrop.className = 'label-modal-backdrop';
    backdrop.innerHTML = `
      <div class="label-modal" role="dialog">
        <h3>Etherscan API-key</h3>
        <div class="addr-preview">
          Один ключ Etherscan V2 используется для разных сетей. История в некоторых сетях недоступна на бесплатном тарифе.<br>
          Получить бесплатно: <a href="https://etherscan.io/apis" target="_blank" rel="noopener">etherscan.io/apis</a>
          — regular account → API Keys → Add. Хранится только в твоём браузере, на сервер не шлётся.
        </div>
        <input type="text" id="akInput" placeholder="например ABC123DEF456..." value="${escapeHtml(cur)}" />
        <div class="modal-actions">
          ${cur ? '<button type="button" class="danger" id="akClear">Удалить</button>' : ''}
          <button type="button" id="akCancel">Отмена</button>
          <button type="button" class="primary" id="akSave">Сохранить</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#akCancel').addEventListener('click', close);
    const input = backdrop.querySelector('#akInput');
    setTimeout(() => input.focus(), 50);
    const save = () => {
      setEtherscanKey(input.value.trim());
      close();
      refreshTxs();
    };
    backdrop.querySelector('#akSave').addEventListener('click', save);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    const clearBtn = backdrop.querySelector('#akClear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      setEtherscanKey('');
      close();
      $('txResult').innerHTML = '<div class="empty">Ключ удалён. Нажми ⚙ Ключ чтобы задать новый.</div>';
    });
  }

  function parseEtherscanTransactions(response) {
    if (response?.status === '1' && Array.isArray(response.result)) return response.result;
    const detail = typeof response?.result === 'string' ? response.result : '';
    const message = typeof response?.message === 'string' ? response.message : '';
    if (response?.status === '0' &&
        (/^no transactions found[.!]?$/i.test(detail.trim()) ||
         (/^no transactions found[.!]?$/i.test(message.trim()) &&
          Array.isArray(response.result) && response.result.length === 0))) return [];
    if (/free api access is not supported|upgrade your api plan|paid plan/i.test(detail)) {
      throw new Error('Тариф Etherscan не поддерживает историю в этой сети. Можно открыть историю в обозревателе без API-ключа.');
    }
    if (/invalid api key|missing.*api key/i.test(detail)) {
      throw new Error('Неверный API-ключ Etherscan. Нажми «Ключ» и укажи ключ с etherscan.io, а не Basescan или другого обозревателя. Новый ключ может активироваться несколько минут.');
    }
    if (/rate limit|free api limit|too many/i.test(detail)) {
      throw new Error('Etherscan ограничил число запросов. Подожди и повтори загрузку. ' + detail);
    }
    throw new Error(detail || (message && message !== 'NOTOK' ? message : 'Etherscan вернул некорректный ответ. Попробуй позже.'));
  }

  async function fetchTxs(chainId, kind, wallet, apiKey) {
    const u = new URL(TX_V2_URL);
    u.searchParams.set('chainid', chainId);
    u.searchParams.set('module', 'account');
    u.searchParams.set('action', kind);              // txlist | tokentx | txlistinternal
    u.searchParams.set('address', wallet);
    u.searchParams.set('page', '1');
    u.searchParams.set('offset', '50');
    u.searchParams.set('sort', 'desc');
    u.searchParams.set('apikey', apiKey);
    const r = await fetch(u.toString());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    try {
      return parseEtherscanTransactions(j);
    } catch (error) {
      // Never echo the API key back through an upstream error message.
      throw new Error(apiKey ? error.message.split(apiKey).join('[ключ скрыт]') : error.message);
    }
  }

  function relTime(unixSec) {
    const diff = Math.floor(Date.now() / 1000 - unixSec);
    if (diff < 60)    return diff + ' сек';
    if (diff < 3600)  return Math.floor(diff / 60) + ' мин';
    if (diff < 86400) return Math.floor(diff / 3600) + ' ч';
    if (diff < 86400 * 30) return Math.floor(diff / 86400) + ' дн';
    return new Date(unixSec * 1000).toISOString().slice(0, 10);
  }

  function formatNativeFromWei(valueWei, nativeSymbol) {
    try {
      const bi = BigInt(valueWei || '0');
      const whole = Number(bi / 10n ** 18n);
      const frac = Number(bi % 10n ** 18n) / 1e18;
      const total = whole + frac;
      if (total === 0) return '0 ' + nativeSymbol;
      const digits = total < 0.0001 ? 8 : total < 1 ? 6 : 4;
      return total.toFixed(digits).replace(/\.?0+$/, '') + ' ' + nativeSymbol;
    } catch (_) { return (valueWei || '0') + ' wei'; }
  }
  function formatTokenAmount(valueRaw, decimals) {
    try {
      const d = Number(decimals || 18);
      const bi = BigInt(valueRaw || '0');
      const divisor = 10n ** BigInt(d);
      const whole = Number(bi / divisor);
      const frac = Number(bi % divisor) / Number(divisor);
      const total = whole + frac;
      if (total === 0) return '0';
      const digits = total < 0.0001 ? 8 : total < 1 ? 6 : 4;
      return total.toFixed(digits).replace(/\.?0+$/, '');
    } catch (_) { return valueRaw || '0'; }
  }

  function renderTxs(items, chainId, kind, wallet) {
    const root = $('txResult');
    if (!items.length) {
      root.innerHTML = '<div class="empty">Нет транзакций в этой сети по данному адресу.</div>';
      return;
    }
    const walletLower = wallet.toLowerCase();
    const explorer = TX_EXPLORERS[chainId] || 'https://etherscan.io';
    const native = TX_NATIVE_SYMBOLS[chainId] || 'ETH';
    let html = '';
    for (const t of items) {
      const from = (t.from || '').toLowerCase();
      const to = (t.to || '').toLowerCase();
      const isIn = to === walletLower && from !== walletLower;
      const isOut = from === walletLower && to !== walletLower;
      const isSelf = from === walletLower && to === walletLower;
      const dirCls = isIn ? 'in' : isOut ? 'out' : 'self';
      const dirIcon = isIn ? '↓' : isOut ? '↑' : '↔';

      let title, amount, amountCls;
      if (kind === 'tokentx') {
        const sym = t.tokenSymbol || '?';
        const amt = formatTokenAmount(t.value, t.tokenDecimal);
        title = `${isIn ? 'Получено' : isOut ? 'Отправлено' : 'Перевод'} ${escapeHtml(sym)}`;
        amount = (isIn ? '+' : isOut ? '−' : '±') + amt + ' ' + escapeHtml(sym);
        amountCls = dirCls;
      } else if (kind === 'txlistinternal') {
        const amt = formatNativeFromWei(t.value, native);
        title = `Внутренняя операция · ${escapeHtml(t.type || 'call')}`;
        amount = (isIn ? '+' : isOut ? '−' : '±') + amt;
        amountCls = dirCls;
      } else {
        // txlist (normal)
        const amt = formatNativeFromWei(t.value, native);
        const isContract = t.input && t.input !== '0x';
        title = isContract ? 'Контракт · ' + (t.functionName || t.methodId || '').split('(')[0] || 'метод' : (isIn ? 'Получено' : isOut ? 'Отправлено' : 'Перевод');
        title = String(title).slice(0, 60);
        amount = (isIn ? '+' : isOut ? '−' : '±') + amt;
        amountCls = dirCls;
      }

      const err = (t.isError === '1' || t.txreceipt_status === '0')
        ? '<span class="tx-badge err">failed</span>' : '';
      const counterparty = isIn ? t.from : t.to;
      const cpShort = counterparty ? (counterparty.slice(0, 8) + '…' + counterparty.slice(-6)) : '';

      html += `
        <div class="tx-row" data-hash="${escapeHtml(t.hash)}" data-explorer="${explorer}">
          <div class="tx-dir ${dirCls}">${dirIcon}</div>
          <div class="tx-main">
            <div class="tx-title">${escapeHtml(title)}${err}</div>
            <div class="tx-sub">${isIn ? 'от' : 'к'} ${escapeHtml(cpShort)}</div>
          </div>
          <div class="tx-amount ${amountCls}">${escapeHtml(amount)}</div>
          <div class="tx-time">${relTime(Number(t.timeStamp))}</div>
        </div>`;
    }
    root.innerHTML = html;
    // Click row → open explorer with the tx hash.
    root.querySelectorAll('.tx-row').forEach(row => {
      row.addEventListener('click', () => {
        const h = row.dataset.hash;
        const exp = row.dataset.explorer;
        if (h && exp) window.open(exp + '/tx/' + h, '_blank', 'noopener');
      });
    });
  }

  async function refreshTxs() {
    const root = $('txResult');
    const wallet = ($('addrInput').value || '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      root.innerHTML = '<div class="empty">Сначала введи 0x-адрес в поле выше или подключи MetaMask.</div>';
      return;
    }
    const key = getEtherscanKey();
    if (!key) {
      root.innerHTML = `
        <div class="empty">
          Нужен бесплатный ключ Etherscan — зарегай за 1 мин на
          <a href="https://etherscan.io/apis" target="_blank" rel="noopener">etherscan.io/apis</a>
          и жми ⚙ Ключ.
        </div>`;
      return;
    }
    const chainId = $('txChain').value;
    const kind = $('txKind').value;
    root.innerHTML = '<div class="empty">Загрузка…</div>';
    try {
      const items = await fetchTxs(chainId, kind, wallet, key);
      renderTxs(items, chainId, kind, wallet);
    } catch (e) {
      const explorer = TX_EXPLORERS[chainId];
      const addressUrl = explorer + '/address/' + wallet + (kind === 'tokentx' ? '#tokentxns' : kind === 'txlistinternal' ? '#internaltx' : '');
      root.innerHTML = `<div class="error">${escapeHtml(e.message || String(e))}</div>` +
        (explorer ? `<p><a href="${escapeHtml(addressUrl)}" target="_blank" rel="noopener">Открыть историю в обозревателе ↗</a></p>` : '');
    }
  }

  $('txRefresh').addEventListener('click', refreshTxs);
  $('txApiKeyBtn').addEventListener('click', openApiKeyModal);
  $('txChain').addEventListener('change', () => {
    if ($('txResult').dataset.loaded) refreshTxs();
  });
  $('txKind').addEventListener('change', () => {
    if ($('txResult').dataset.loaded) refreshTxs();
  });
  document.querySelector('.tab[data-tab="txs"]').addEventListener('click', () => {
    if (!$('txResult').dataset.loaded) {
      $('txResult').dataset.loaded = '1';
      refreshTxs();
    }
  });

  // ============== AML / counterparty address check (GoPlus) ============
  // Критичная функция для P2P-сделок: перед принятием перевода проверяем
  // отправителя на 20+ сигналов GoPlus — mixer, phishing, sanctions,
  // honeypot deployer, cybercrime и т.д. Запрос идёт напрямую из браузера
  // (GoPlus разрешает CORS, API бесплатный, лимитов на анон. запросы
  // хватает для ручного использования).
  const AML_LAST = { addr: '', chainId: '1', res: null };

  // Критические флаги (красный verdict). Проверяем is-truthy "1" или число>0.
  const AML_CRITICAL_FLAGS = {
    sanctioned:                '🚫 санкционный адрес (OFAC/SDN)',
    sanctioned_address:        '🚫 санкционный адрес',
    money_laundering:          '💸 отмывание денег',
    honeypot_related_address:  '🍯 связан с honeypot-токенами',
    phishing_activities:       '🎣 фишинг',
    stealing_attack:           '🦹 кражи криптовалюты',
    cybercrime:                '👾 киберпреступность',
    financial_crime:           '📑 финансовые преступления',
    blackmail_activities:      '✉ шантаж / вымогательство',
    darkweb_transactions:      '🌑 даркнет-транзакции',
    mixer:                     '🌀 миксер (Tornado и т.п.)',
    malicious_mining_activities: '⛏ вредоносный майнинг',
    fake_kyc:                  '🪪 поддельный KYC',
  };
  // Жёлтые флаги — не критические, но стоит знать
  const AML_WARN_FLAGS = {
    blacklist_doubt:           '📋 подозрение на блэклист биржи',
    gas_abuse:                 '⛽ злоупотребление газом',
    fake_standard_interface:   '📝 поддельный ERC-20 интерфейс',
    reinit:                    '🔄 contract reinit (proxy abuse)',
  };

  async function amlCheck(address, chainId) {
    // GoPlus Address Security endpoint
    const url = `https://api.gopluslabs.io/api/v1/address_security/${address}?chain_id=${chainId}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j.code !== 1) throw new Error(j.message || 'GoPlus error');
    return j.result || {};
  }

  function amlAnalyze(result) {
    const criticalHits = [];
    const warnHits = [];
    for (const [k, label] of Object.entries(AML_CRITICAL_FLAGS)) {
      const v = result[k];
      if (v && v !== '0' && v !== 0 && v !== 'null') criticalHits.push({ k, label, v });
    }
    for (const [k, label] of Object.entries(AML_WARN_FLAGS)) {
      const v = result[k];
      if (v && v !== '0' && v !== 0 && v !== 'null') warnHits.push({ k, label, v });
    }
    // number_of_malicious_contracts_created: число — жёлтый если >0, красный если >=5
    const nMalic = Number(result.number_of_malicious_contracts_created || 0);
    if (nMalic >= 5) criticalHits.push({ k:'malicious_contracts', label: `☠ создал ${nMalic} вредоносных контрактов`, v: nMalic });
    else if (nMalic > 0) warnHits.push({ k:'malicious_contracts', label: `⚠ создал ${nMalic} подозрительных контракта`, v: nMalic });

    const isContract = result.contract_address === '1' || result.contract_address === 1;

    let verdict, title, sub;
    if (criticalHits.length) {
      verdict = 'danger';
      title = '🚨 АДРЕС В ЧЁРНОМ СПИСКЕ';
      sub = 'Не принимай транзакции с этого адреса. Биржа может заблокировать твой счёт при их получении.';
    } else if (warnHits.length) {
      verdict = 'warn';
      title = '⚠ Есть замечания';
      sub = 'Не критично, но стоит перепроверить контрагента перед крупной сделкой.';
    } else {
      verdict = 'clean';
      title = '✓ Адрес чист';
      sub = isContract ? 'Это контракт, явных рисков по GoPlus не обнаружено.' : 'По базе GoPlus (20+ источников) флагов нет.';
    }
    return { verdict, title, sub, criticalHits, warnHits, isContract };
  }

  function amlRender(container, analysis, address) {
    const flagsHtml = [...analysis.criticalHits.map(h => `<span class="aml-flag danger">${escapeHtml(h.label)}</span>`),
                      ...analysis.warnHits.map(h => `<span class="aml-flag warn">${escapeHtml(h.label)}</span>`)].join('');
    container.innerHTML = `
      <div class="aml-verdict ${analysis.verdict}">
        <div class="verdict-title">${escapeHtml(analysis.title)}</div>
        <div class="verdict-sub">${escapeHtml(address)}</div>
        <div class="verdict-sub" style="font-family:inherit; margin-top:6px;">${escapeHtml(analysis.sub)}</div>
        ${flagsHtml ? `<div class="aml-flags">${flagsHtml}</div>` : ''}
      </div>`;
  }

  function openAmlModal(prefillAddr) {
    const backdrop = document.createElement('div');
    backdrop.className = 'label-modal-backdrop';
    backdrop.innerHTML = `
      <div class="label-modal big-modal" role="dialog">
        <h3>🛡 Проверка адреса (AML)</h3>
        <div class="modal-sub">
          Проверка контрагента перед P2P-сделкой: санкции, mixer, phishing, honeypot deployers,
          cybercrime. Данные GoPlus (агрегирует 20+ источников: Chainalysis, SlowMist, OFAC, биржевые блэклисты).
        </div>
        <label class="field">0x-адрес контрагента</label>
        <div class="inline-row" style="margin-bottom:10px;">
          <input type="text" id="amlInput" placeholder="0x742d35cc6634c0532925a3b844bc45436aec1234" value="${escapeHtml(prefillAddr || '')}" />
          <select id="amlChain">
            <option value="1">Ethereum</option>
            <option value="42161">Arbitrum</option>
            <option value="10">Optimism</option>
            <option value="8453">Base</option>
            <option value="137">Polygon</option>
            <option value="56">BNB</option>
            <option value="43114">Avalanche</option>
            <option value="100">Gnosis</option>
            <option value="59144">Linea</option>
            <option value="534352">Scroll</option>
            <option value="81457">Blast</option>
          </select>
        </div>
        <div class="modal-actions" style="justify-content:flex-start;">
          <button type="button" class="primary" id="amlRunBtn">Проверить</button>
          <button type="button" id="amlCloseBtn" style="margin-left:auto;">Закрыть</button>
        </div>
        <div id="amlResult"></div>
      </div>`;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#amlCloseBtn').addEventListener('click', close);

    const input = backdrop.querySelector('#amlInput');
    const chainSel = backdrop.querySelector('#amlChain');
    const result = backdrop.querySelector('#amlResult');
    setTimeout(() => input.focus(), 50);

    const run = async () => {
      const addr = input.value.trim();
      const chainId = chainSel.value;
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
        result.innerHTML = '<div class="aml-verdict warn"><div class="verdict-title">⚠ Невалидный адрес</div><div class="verdict-sub">Нужно 42 символа, начинается с 0x.</div></div>';
        return;
      }
      result.innerHTML = '<div class="aml-verdict loading"><div class="verdict-title">⟳ Проверяю…</div><div class="verdict-sub">GoPlus обычно отвечает за 1-3 секунды.</div></div>';
      try {
        const raw = await amlCheck(addr, chainId);
        // GoPlus возвращает { result: { "0xaddr": {...} } } — ключи lowercased
        const data = raw[addr.toLowerCase()] || raw[addr] || {};
        const analysis = amlAnalyze(data);
        amlRender(result, analysis, addr);
        AML_LAST.addr = addr; AML_LAST.chainId = chainId; AML_LAST.res = analysis;
      } catch (e) {
        result.innerHTML = `<div class="aml-verdict warn"><div class="verdict-title">⚠ Ошибка запроса</div><div class="verdict-sub">${escapeHtml(e.message || String(e))}</div></div>`;
      }
    };
    backdrop.querySelector('#amlRunBtn').addEventListener('click', run);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });

    // Если префилл есть — сразу запускаем
    if (prefillAddr && /^0x[0-9a-fA-F]{40}$/.test(prefillAddr)) {
      setTimeout(run, 100);
    }
  }

  // ============== Settings modal ======================================
  // Централизует все пользовательские настройки:
  //  • Etherscan V2 API key (для вкладки Транзакции)
  //  • Статус backend-конфигурации (Alchemy и т.п.)
  //  • Информация о версии
  async function fetchBackendStatus() {
    try {
      const r = await fetch(API_BASE + '/api/config/status');
      if (!r.ok) return null;
      return await r.json();
    } catch (_) { return null; }
  }

  function openSettingsModal() {
    const curEtherscan = getEtherscanKey();
    const backdrop = document.createElement('div');
    backdrop.className = 'label-modal-backdrop';
    backdrop.innerHTML = `
      <div class="label-modal big-modal" role="dialog">
        <h3>⚙ Настройки</h3>
        <div class="modal-sub">Все ключи и настройки — локально в твоём браузере.</div>

        <div class="modal-section">
          <div class="modal-section-title">Browser-side keys</div>
          <label class="field">Etherscan V2 API key — доступ к истории зависит от тарифа</label>
          <input type="text" id="setEtherscan" placeholder="бесплатно на etherscan.io/apis" value="${escapeHtml(curEtherscan)}" />
          <div style="font-size:11px; color:var(--muted); margin-top:-4px;">
            Хранится только в localStorage. На сервер не отправляется.
          </div>
        </div>

        <div class="modal-section">
          <div class="modal-section-title">Server configuration</div>
          <div id="setServerStatus">
            <div class="status-row">
              <span class="status-label">Загрузка…</span>
              <span class="status-value off">—</span>
            </div>
          </div>
        </div>

        <div class="modal-section">
          <div class="modal-section-title">About</div>
          <div class="status-row">
            <span class="status-label">RuDeFi — open source</span>
            <span class="status-value ok">
              <a href="https://github.com/21astroboy/RuDeFi" target="_blank" rel="noopener" style="font-size:12px;">GitHub ↗</a>
            </span>
          </div>
          <div class="status-row">
            <span class="status-label">Лицензия</span>
            <span class="status-value off">MIT</span>
          </div>
        </div>

        <div class="modal-actions">
          <button type="button" id="setCancel">Отмена</button>
          <button type="button" class="primary" id="setSave">Сохранить</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('#setCancel').addEventListener('click', close);

    const save = () => {
      const k = backdrop.querySelector('#setEtherscan').value.trim();
      setEtherscanKey(k);
      close();
    };
    backdrop.querySelector('#setSave').addEventListener('click', save);

    // Async: fetch backend status
    fetchBackendStatus().then(st => {
      const box = backdrop.querySelector('#setServerStatus');
      if (!box) return;  // modal closed in the meantime
      if (!st) {
        box.innerHTML = `
          <div class="status-row">
            <span class="status-label">Статус бэкенда</span>
            <span class="status-value warn">endpoint не доступен</span>
          </div>`;
        return;
      }
      const alchemy = st.alchemy_configured
        ? '<span class="status-value ok">✓ подключён</span>'
        : '<span class="status-value off">публичные RPC</span>';
      const rpc = Number(st.rpc_chain_count || 0);
      box.innerHTML = `
        <div class="status-row">
          <span class="status-label">Alchemy RPC (бэкенд)</span>
          ${alchemy}
        </div>
        <div class="status-row">
          <span class="status-label">Поддержка сетей</span>
          <span class="status-value ok">${rpc} EVM чейнов</span>
        </div>
        <div class="status-row">
          <span class="status-label">Версия бэкенда</span>
          <span class="status-value off">${escapeHtml(st.version || 'unknown')}</span>
        </div>`;
    });
  }

  // Wire up buttons
  $('amlOpenBtn').addEventListener('click', () => {
    // Пред-заполняем текущим адресом в input'е — часто хочешь проверить именно его
    const cur = ($('addrInput').value || '').trim();
    openAmlModal(/^0x[0-9a-fA-F]{40}$/.test(cur) ? cur : '');
  });
  $('settingsOpenBtn').addEventListener('click', openSettingsModal);

  // ============== Health Factor monitoring ==========================
  // Watches Aave/Spark/Compound positions across all chains. Two thresholds:
  //   * 1.5  → "warn" — yellow toast, browser notification (no sound)
  //   * 1.1  → "danger" — red toast, browser notification + audio cue
  // Per-chain throttle: one alert of each severity per 30 minutes.
  const HF_WARN = 1.5;
  const HF_DANGER = 1.1;
  const HF_ALERT_THROTTLE_MS = 30 * 60 * 1000;
  const HF_STORAGE_KEY = 'cryptoapp.hf_alerts';

  function loadHfState() {
    try { return JSON.parse(localStorage.getItem(HF_STORAGE_KEY) || '{}'); }
    catch (_) { return {}; }
  }
  function saveHfState(s) {
    try { localStorage.setItem(HF_STORAGE_KEY, JSON.stringify(s)); } catch (_) {}
  }

  // Lazy permission request — only when we have something to alert about.
  async function ensureNotifPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied')  return false;
    try {
      const r = await Notification.requestPermission();
      return r === 'granted';
    } catch (_) { return false; }
  }

  function playAlertBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch (_) { /* audio blocked — silent failure */ }
  }

  function showHfToast(severity, title, body) {
    // Remove any existing toast first (we only show one at a time).
    document.querySelectorAll('.hf-toast').forEach(n => n.remove());
    const el = document.createElement('div');
    el.className = `hf-toast${severity === 'warn' ? ' warn' : ''}`;
    el.innerHTML = `
      <div class="title">${escapeHtml(title)}</div>
      <div class="body">${escapeHtml(body)}</div>`;
    el.addEventListener('click', () => { setActiveTab('defi'); el.remove(); });
    document.body.appendChild(el);
    // Auto-dismiss in 30s.
    setTimeout(() => { try { el.remove(); } catch (_) {} }, 30000);
  }

  function checkHealthFactors(scan) {
    const positions = scan?.defi_positions || [];
    // For each (chain, protocol) summary row that has a meaningful HF, check.
    // A "summary" row's hf can be huge (no debt) — only alert when there's
    // actual debt, i.e. hf < 100.
    const state = loadHfState();
    const now = Date.now();

    // De-dup by (chain, protocol).
    const seen = new Set();
    for (const p of positions) {
      if (!p.health_factor || p.health_factor <= 0) continue;
      if (p.health_factor > 100) continue;     // sentinel "no debt"
      const key = `${p.chain_key}|${p.protocol}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const hf = Number(p.health_factor);
      let severity = null;
      if (hf < HF_DANGER) severity = 'danger';
      else if (hf < HF_WARN) severity = 'warn';
      if (!severity) continue;

      // Throttle: don't re-alert if we sent the same severity recently.
      const stKey = `${key}|${severity}`;
      const last = state[stKey] || 0;
      if (now - last < HF_ALERT_THROTTLE_MS) continue;
      state[stKey] = now;

      const title = severity === 'danger'
        ? `⛔ ${p.protocol} ${p.chain_name}: HF ${hf.toFixed(2)} — на грани ликвидации`
        : `⚠ ${p.protocol} ${p.chain_name}: HF ${hf.toFixed(2)}`;
      const body = severity === 'danger'
        ? 'Срочно: пополни залог или закрой часть долга, иначе ликвидация.'
        : 'HF просел ниже 1.5 — стоит присмотреть за позицией.';

      showHfToast(severity, title, body);
      if (severity === 'danger') playAlertBeep();
      ensureNotifPermission().then(ok => {
        if (!ok) return;
        try {
          new Notification(title, {
            body, requireInteraction: severity === 'danger',
            tag: stKey,  // browser dedupes notifications with same tag
          });
        } catch (_) {}
      });
    }
    saveHfState(state);
  }

  // ============== Gas tracker ========================================
  function fmtGwei(g) {
    if (g >= 100) return g.toFixed(0) + ' gwei';
    if (g >= 1)   return g.toFixed(1) + ' gwei';
    if (g >= 0.01) return g.toFixed(3) + ' gwei';
    return g.toExponential(1) + ' gwei';
  }
  async function refreshGasBar() {
    try {
      const r = await fetch(API_BASE + '/api/gas');
      if (!r.ok) {
        $('gasBar').innerHTML =
          `<span class="gas-label">газ сейчас</span>
           <span class="muted" style="font-size:11px;">бэкенд вернул ${r.status} — пересобери (./dev.sh)</span>`;
        return;
      }
      const data = await r.json();
      const bar = $('gasBar');
      bar.innerHTML = '<span class="gas-label">газ сейчас</span>';
      for (const c of (data.chains || [])) {
        const meta = CHAIN_META[c.chain_key] || {};
        const lvl  = c.error ? 'unknown' : (c.level || 'unknown');
        const num  = c.error ? '—' : fmtGwei(c.gwei || 0);
        const tip  = c.error ? c.error : `${c.chain_name} · уровень: ${lvl}`;
        bar.insertAdjacentHTML('beforeend',
          `<span class="gas-pill lvl-${lvl}" title="${escapeHtml(tip)}">
             <span class="chain-icon">${meta.svg || ''}</span>
             <span class="gas-num">${escapeHtml(num)}</span>
           </span>`);
      }
    } catch (e) {
      console.error('gas refresh failed', e);
      $('gasBar').innerHTML =
        `<span class="gas-label">газ сейчас</span>
         <span class="muted" style="font-size:11px;">недоступно (${escapeHtml(e.message || e)})</span>`;
    }
  }
  refreshGasBar();
  setInterval(() => {
    if (document.visibilityState === 'visible') refreshGasBar();
  }, 20000);

  // Restore without popups, including delayed provider injection on mobile.
  setTimeout(tryRestoreConnection, 0);

  // Address book — рендерим при старте и обновляем highlight при любой смене адреса
  renderWalletBook();
  document.getElementById('addrInput').addEventListener('input', () => {
    // live-подсветка активного чипа по мере ввода
    renderWalletBook();
    updateWalletStatus();
  });

  // ============== PWA service worker registration =====================
  // Регистрируем SW только по HTTPS или localhost (Chrome/Safari блокируют
  // SW на обычных http с foreign-origin). При ошибке — тихо игнорим,
  // просто не будет оффлайн-кэша.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => {
          console.log('[rudefi] service worker registered', reg.scope);
          // Проверяем обновления раз в час — чтобы юзер не сидел на старом коде
          setInterval(() => reg.update().catch(() => {}), 3600 * 1000);
        })
        .catch(err => console.warn('[rudefi] sw registration failed', err));
    });
  }
