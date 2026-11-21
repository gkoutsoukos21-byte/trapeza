/* Τράπεζα Θεμάτων — Μαθηματικά Λυκείου (PWA) */
(function () {
  'use strict';

  const API = 'https://api.trapeza.registry.digitalschool.gov.gr/v1';
  const FILE = (id, t) => `https://subjects.draw.iep.edu.gr/${id}-${t}?unique_identifier=${id}&file_type=${t}`;
  const PAGE = 30;
  const SCHOOLS = ['Γενικό Λύκειο', 'Επαγγελματικό Λύκειο'];
  const SCHOOL_SHORT = { 'Γενικό Λύκειο': 'ΓΕΛ', 'Επαγγελματικό Λύκειο': 'ΕΠΑΛ' };
  const CLASSES = ['Α΄ Λυκείου', 'Β΄ Λυκείου', 'Γ΄ Λυκείου'];

  const SUBJ = (window.TRAPEZA_DATA || []).map((s, i) => Object.assign({ idx: i }, s));
  const $app = document.getElementById('app');
  const BRAND = window.BRAND || {};
  const COLORS = Object.assign({ primary: '#163A5F', accent: '#C84B20', silver: '#B8BDC2', text: '#2B303A' }, BRAND.colors || {});
  const SOURCE_NOTE = BRAND.sourceNote || 'Τα θέματα προέρχονται από την Τράπεζα Θεμάτων Διαβαθμισμένης Δυσκολίας του Ι.Ε.Π. (iep.edu.gr)';

  // ---------- brand ----------
  (function applyBrand() {
    const logo = document.getElementById('brandLogo');
    if (BRAND.logoHeader) { logo.src = BRAND.logoHeader; logo.alt = BRAND.name || ''; } else logo.remove();
    if (BRAND.appTitle) document.getElementById('appTitle').textContent = BRAND.appTitle;
    if (BRAND.appSubtitle) document.getElementById('appSub').textContent = BRAND.appSubtitle;
    document.getElementById('brandLine').textContent = [BRAND.name, BRAND.tagline].filter(Boolean).join(' · ') + (BRAND.contact ? ' · ' + BRAND.contact : '');
    document.title = [BRAND.appTitle || 'Τράπεζα Θεμάτων', BRAND.name].filter(Boolean).join(' · ');
  })();

  // ---------- storage (best effort) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };

  // ---------- state ----------
  const saved = store.get('tt_sel', {});
  const state = {
    view: 'home',
    school: SCHOOLS.includes(saved.school) ? saved.school : SCHOOLS[0],
    cls: CLASSES.includes(saved.cls) ? saved.cls : CLASSES[0],
    sIdx: null,
    sel: new Set(),
    upTo: false,
    q: 'all',
    shown: PAGE,
    random: null,
    codeQuery: '',
    cart: store.get('tt_cart', []),
    withSol: store.get('tt_withsol', false)
  };

  // ---------- helpers ----------
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const subjLabel = s => `${s.subject} · ${s.cls} · ${SCHOOL_SHORT[s.school] || s.school}`;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }
  function saveSel() { store.set('tt_sel', { school: state.school, cls: state.cls }); }
  function saveCart() { store.set('tt_cart', state.cart); updateCartCount(); }
  function updateCartCount() { document.getElementById('cartCount').textContent = state.cart.length; }
  const inCart = (id) => state.cart.some(c => c.id === id);

  function matKey(name) {
    let m = /Κεφάλαιο\s*(\d+)/.exec(name);
    if (m) return [+m[1], 0];
    m = /(\d+)\.(\d+)/.exec(name);
    if (m) return [+m[1], +m[2]];
    return null;
  }

  // ---------- live refresh from the IEP API ----------
  let treeP = null;
  function getTree() {
    if (!treeP) treeP = fetch(API + '/public/school/type/tree').then(r => { if (!r.ok) throw 0; return r.json(); }).catch(e => { treeP = null; throw e; });
    return treeP;
  }
  const refreshed = new Set();
  async function refreshSubject(s) {
    if (refreshed.has(s.idx)) return;
    refreshed.add(s.idx);
    try {
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 12000);
      const [tree, data] = await Promise.all([
        getTree(),
        fetch(`${API}/public/school/type/${s.t}/class/${s.c}/subject/${s.s}/items?up_to_last_chapter=false`, { signal: ctrl.signal }).then(r => { if (!r.ok) throw 0; return r.json(); })
      ]);
      clearTimeout(to);
      const st = tree.school_types.find(x => x.id === s.t);
      const cl = st && st.classes.find(x => x.id === s.c);
      const le = cl && cl.lessons.find(x => x.id === s.s);
      if (!le || !data || !Array.isArray(data.items) || !data.items.length) return;
      let mats = le.material.slice().sort((a, b) => a.vieworder - b.vieworder);
      const keys = mats.map(m => matKey(m.name));
      if (keys.every(Boolean)) mats = mats.map((m, i) => [m, keys[i]]).sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1]).map(x => x[0]);
      const pos = new Map(mats.map((m, i) => [m.id, i]));
      const items = data.items.map(it => [it.id, it.question, (it.material || []).map(m => pos.get(m.id)).filter(x => x !== undefined).sort((a, b) => a - b)]);
      const before = s.items.length;
      s.mats = mats.map(m => String(m.name).replace(/"+$/, '').trim());
      s.items = items;
      if (state.view === 'subject' && state.sIdx === s.idx) {
        render();
        if (items.length > before) toast(`Ενημερώθηκε: ${items.length - before} νέα θέματα`);
      }
    } catch (e) { /* offline or API change: keep the bundled catalogue */ }
  }

  // ---------- navigation ----------
  function go(view, extra, replace) {
    Object.assign(state, extra || {});
    state.view = view;
    const snap = { view, sIdx: state.sIdx };
    if (replace) history.replaceState(snap, ''); else history.pushState(snap, '');
    render(); window.scrollTo(0, 0);
  }
  window.addEventListener('popstate', e => {
    const s = e.state || { view: 'home' };
    if (V.open && !s.viewer) { hideViewer(); if (s.view === state.view) return; }
    if (s.viewer && !V.open) { history.back(); return; }
    state.view = s.view; if (s.sIdx != null) state.sIdx = s.sIdx;
    render();
  });
  document.getElementById('backBtn').onclick = () => history.back();
  document.getElementById('cartBtn').onclick = () => { if (state.view !== 'cart') go('cart'); };

  // ---------- filtering ----------
  function filtered(s) {
    const sel = state.sel; const max = sel.size ? Math.max(...sel) : -1;
    return s.items.filter(([, q, mats]) => {
      if (state.q !== 'all' && q !== state.q) return false;
      if (!sel.size) return true;
      if (!mats.some(m => sel.has(m))) return false;
      if (state.upTo && mats.some(m => m > max)) return false;
      return true;
    });
  }

  // ---------- item card ----------
  function itemCard(s, it, opts) {
    const [id, q, mats] = it;
    const matNames = mats.map(m => s.mats[m]).filter(Boolean);
    const added = inCart(id);
    return `<div class="item" data-id="${id}" data-s="${s.idx}">
      <div class="top"><span class="code">Κωδ. ${id}</span><span class="badge q${q}">Θέμα ${q}ο</span></div>
      ${opts && opts.where ? `<div class="where">${esc(subjLabel(s))}</div>` : ''}
      <div class="meta">${matNames.length ? matNames.map(esc).join(' • ') : 'Χωρίς ένδειξη ενότητας'}</div>
      <div class="actions">
        <button class="btn" data-act="view" data-t="1">📄 Εκφώνηση</button>
        <button class="btn sol" data-act="view" data-t="2">💡 Λύση</button>
        <button class="btn wide ${added ? 'added' : 'alt'}" data-act="cart">${added ? '✓ Στη λίστα εκτύπωσης' : '＋ Προσθήκη στην εκτύπωση'}</button>
      </div>
    </div>`;
  }
  function cartEntry(s, it) { return { id: it[0], q: it[1], label: subjLabel(s), mats: it[2].map(m => s.mats[m]).filter(Boolean) }; }
  function toggleCart(entry) {
    if (inCart(entry.id)) { state.cart = state.cart.filter(c => c.id !== entry.id); toast('Αφαιρέθηκε από τη λίστα'); }
    else { state.cart.push(entry); toast('Προστέθηκε στη λίστα εκτύπωσης'); }
    saveCart();
  }
  function bindItems(root) {
    root.querySelectorAll('[data-act="view"]').forEach(b => b.onclick = () => {
      const card = b.closest('.item'); const id = +card.dataset.id; const s = SUBJ[+card.dataset.s];
      const it = s && s.items.find(x => x[0] === id);
      const entry = it ? cartEntry(s, it) : (state.cart.find(c => c.id === id) || { id, q: '', label: '', mats: [] });
      openViewer(id, +b.dataset.t, entry);
    });
    root.querySelectorAll('[data-act="cart"]').forEach(b => b.onclick = () => {
      const card = b.closest('.item'); const id = +card.dataset.id; const s = SUBJ[+card.dataset.s];
      const it = s.items.find(x => x[0] === id);
      toggleCart(cartEntry(s, it));
      const added = inCart(id);
      b.className = `btn wide ${added ? 'added' : 'alt'}`;
      b.textContent = added ? '✓ Στη λίστα εκτύπωσης' : '＋ Προσθήκη στην εκτύπωση';
    });
  }

  // ---------- views ----------
  function viewHome() {
    const subs = SUBJ.filter(s => s.school === state.school && s.cls === state.cls);
    return `
    <div class="hero"><b>${esc(BRAND.appTitle || 'Τράπεζα Θεμάτων')}</b>${esc(BRAND.appSubtitle || 'Μαθηματικά Λυκείου · ΓΕΛ & ΕΠΑΛ')}</div>
    <div class="card">
      <h2>🔎 Αναζήτηση με κωδικό</h2>
      <form class="code-search" id="codeForm">
        <input id="codeInput" inputmode="numeric" pattern="[0-9]*" placeholder="π.χ. 12630" value="${esc(state.codeQuery)}" aria-label="Κωδικός θέματος">
        <button class="btn" type="submit">Βρες</button>
      </form>
    </div>
    <div class="card">
      <h2>Επιλογή μαθήματος</h2>
      <h3>Τύπος σχολείου</h3>
      <div class="seg" id="segSchool">${SCHOOLS.map(x => `<button data-v="${esc(x)}" class="${x === state.school ? 'on' : ''}">${esc(x)}</button>`).join('')}</div>
      <h3>Τάξη</h3>
      <div class="seg" id="segClass">${CLASSES.map(x => `<button data-v="${esc(x)}" class="${x === state.cls ? 'on' : ''}">${esc(x)}</button>`).join('')}</div>
      <h3>Μάθημα</h3>
      <div class="subjects">${subs.map(s => `<button class="subj" data-s="${s.idx}"><b>${esc(s.subject)}</b><span>${s.items.length} θέματα ›</span></button>`).join('') || '<div class="note">Δεν υπάρχουν μαθήματα.</div>'}</div>
    </div>
    <div class="card install" id="installCard">
      <h2>📲 Εγκατάσταση στο κινητό</h2>
      <p class="note" id="installText">Προσθέστε την εφαρμογή στην αρχική οθόνη για να την ανοίγετε σαν κανονική εφαρμογή.</p>
      <button class="btn" id="installBtn">Εγκατάσταση</button>
    </div>`;
  }
  function bindHome() {
    document.querySelectorAll('#segSchool button').forEach(b => b.onclick = () => { state.school = b.dataset.v; saveSel(); render(); });
    document.querySelectorAll('#segClass button').forEach(b => b.onclick = () => { state.cls = b.dataset.v; saveSel(); render(); });
    document.querySelectorAll('.subj').forEach(b => b.onclick = () => openSubject(+b.dataset.s));
    document.getElementById('codeForm').onsubmit = e => {
      e.preventDefault();
      const v = document.getElementById('codeInput').value.replace(/\D/g, '');
      if (!v) { toast('Γράψτε έναν κωδικό θέματος'); return; }
      go('code', { codeQuery: v });
    };
    setupInstall();
  }

  function openSubject(idx) {
    go('subject', { sIdx: idx, sel: new Set(), upTo: false, q: 'all', shown: PAGE, random: null });
    refreshSubject(SUBJ[idx]);
  }

  function viewSubject() {
    const s = SUBJ[state.sIdx];
    const list = filtered(s);
    const counts = s.mats.map((_, i) => s.items.filter(it => it[2].includes(i)).length);
    const qs = [...new Set(s.items.map(it => it[1]))].sort();
    const items = list.slice(0, state.shown);
    return `
    <div class="card">
      <h2>${esc(s.subject)} <span class="note">· ${esc(s.cls)} · ${esc(SCHOOL_SHORT[s.school])}</span></h2>
      <h3>Θέμα</h3>
      <div class="seg" id="segQ">
        <button data-q="all" class="${state.q === 'all' ? 'on' : ''}">Όλα</button>
        ${qs.map(q => `<button data-q="${q}" class="${state.q === q ? 'on' : ''}">Θέμα ${q}ο</button>`).join('')}
      </div>
      <h3 class="row" style="justify-content:space-between">Ενότητες ύλης
        <span><button class="btn ghost" id="selAll">Όλες</button><button class="btn ghost" id="selNone">Καμία</button></span></h3>
      <div class="mats">${s.mats.map((m, i) => `<label class="mat"><input type="checkbox" data-m="${i}" ${state.sel.has(i) ? 'checked' : ''}><span>${esc(m)}</span><small>${counts[i]}</small></label>`).join('')}</div>
      <label class="switch"><input type="checkbox" id="upTo" ${state.upTo ? 'checked' : ''}><span>Μόνο θέματα <b>μέχρι την τελευταία επιλεγμένη ενότητα</b></span></label>
    </div>
    <div class="sum">
      <span>Βρέθηκαν <b>${list.length}</b> θέματα</span>
      <span class="row">
        <button class="btn orange" id="randBtn" ${list.length ? '' : 'disabled'}>🎲 Τυχαίο θέμα</button>
        <button class="btn alt" id="addAll" ${list.length ? '' : 'disabled'}>＋ Όλα στην εκτύπωση</button>
      </span>
    </div>
    <div id="randBox">${state.random ? `<div class="note" style="margin:0 0 6px">🎲 Τυχαίο θέμα:</div>${itemCard(s, state.random)}<hr style="border:0;border-top:1px solid var(--line);margin:4px 0 14px">` : ''}</div>
    <div id="list">${items.map(it => itemCard(s, it)).join('') || '<div class="empty">Δεν βρέθηκαν θέματα με αυτά τα φίλτρα.</div>'}</div>
    ${list.length > state.shown ? `<button class="btn alt" id="more" style="width:100%">Εμφάνιση περισσότερων (${list.length - state.shown})</button>` : ''}`;
  }
  function bindSubject() {
    const s = SUBJ[state.sIdx];
    document.querySelectorAll('#segQ button').forEach(b => b.onclick = () => { state.q = b.dataset.q === 'all' ? 'all' : +b.dataset.q; state.shown = PAGE; state.random = null; render(); });
    document.querySelectorAll('.mats input').forEach(c => c.onchange = () => { const m = +c.dataset.m; c.checked ? state.sel.add(m) : state.sel.delete(m); state.shown = PAGE; state.random = null; renderKeepScroll(); });
    document.getElementById('selAll').onclick = () => { state.sel = new Set(s.mats.map((_, i) => i)); state.random = null; renderKeepScroll(); };
    document.getElementById('selNone').onclick = () => { state.sel = new Set(); state.random = null; renderKeepScroll(); };
    document.getElementById('upTo').onchange = e => { state.upTo = e.target.checked; state.shown = PAGE; renderKeepScroll(); };
    const more = document.getElementById('more'); if (more) more.onclick = () => { state.shown += PAGE; renderKeepScroll(); };
    document.getElementById('randBtn').onclick = () => {
      const list = filtered(s); state.random = list[Math.floor(Math.random() * list.length)];
      renderKeepScroll(); document.getElementById('randBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    document.getElementById('addAll').onclick = () => {
      let n = 0;
      filtered(s).forEach(it => { if (!inCart(it[0])) { state.cart.push(cartEntry(s, it)); n++; } });
      saveCart(); renderKeepScroll(); toast(n ? `Προστέθηκαν ${n} θέματα στη λίστα` : 'Είναι ήδη όλα στη λίστα');
    };
    bindItems($app);
  }

  function viewCode() {
    const id = +state.codeQuery;
    const hits = [];
    SUBJ.forEach(s => s.items.forEach(it => { if (it[0] === id) hits.push([s, it]); }));
    return `<div class="card"><h2>Αποτελέσματα για «${esc(state.codeQuery)}»</h2>
      <form class="code-search" id="codeForm"><input id="codeInput" inputmode="numeric" value="${esc(state.codeQuery)}" aria-label="Κωδικός θέματος"><button class="btn" type="submit">Βρες</button></form></div>
      ${hits.length ? hits.map(([s, it]) => itemCard(s, it, { where: true })).join('') :
        `<div class="item" data-id="${id}" data-s="-1"><div class="empty" style="padding:10px">Ο κωδικός δεν βρέθηκε στα Μαθηματικά.<br>Μπορείτε να δοκιμάσετε απευθείας τα αρχεία του ΙΕΠ:</div>
         <div class="actions"><button class="btn" data-act="view" data-t="1">📄 Εκφώνηση</button><button class="btn sol" data-act="view" data-t="2">💡 Λύση</button></div></div>`}`;
  }
  function bindCode() {
    document.getElementById('codeForm').onsubmit = e => {
      e.preventDefault(); const v = document.getElementById('codeInput').value.replace(/\D/g, '');
      if (v) { state.codeQuery = v; history.replaceState({ view: 'code' }, ''); render(); }
    };
    bindItems($app);
  }

  function viewCart() {
    const c = state.cart;
    return `<div class="card">
      <h2>🖨️ Λίστα εκτύπωσης (${c.length})</h2>
      ${c.length ? `
      <p class="note">Φτιάχνει <b>ένα ενιαίο PDF</b> με όλες τις εκφωνήσεις, έτοιμο για εκτύπωση ή αποστολή.</p>
      <label class="switch"><input type="checkbox" id="withSol" ${state.withSol ? 'checked' : ''}><span>Να μπουν και οι <b>ενδεικτικές απαντήσεις</b> (στο τέλος)</span></label>
      <div class="row" style="margin-top:12px">
        <button class="btn" id="makePdf">📄 Δημιουργία PDF</button>
        <button class="btn alt" id="clearCart">Άδειασμα λίστας</button>
      </div>
      <div id="pdfBox" class="hidden"><div class="progress"><i id="bar"></i></div><div class="note" id="pdfMsg"></div><div class="row" id="pdfLinks" style="margin-top:8px"></div></div>
      ` : '<div class="empty">Η λίστα είναι άδεια.<br>Πατήστε «Προσθήκη στην εκτύπωση» σε όποια θέματα θέλετε.</div>'}
    </div>
    ${c.map((x, i) => `<div class="item" data-i="${i}" data-id="${x.id}" data-s="-1">
      <div class="top"><span class="code">${i + 1}. Κωδ. ${x.id}</span><span class="badge q${x.q}">Θέμα ${x.q}ο</span></div>
      <div class="where">${esc(x.label)}</div>
      <div class="meta">${(x.mats || []).map(esc).join(' • ')}</div>
      <div class="actions">
        <button class="btn" data-act="view" data-t="1">📄 Εκφώνηση</button>
        <button class="btn sol" data-act="view" data-t="2">💡 Λύση</button>
        <div class="row wide"><button class="btn alt" data-up style="flex:1">↑</button><button class="btn alt" data-down style="flex:1">↓</button><button class="btn alt" data-del style="flex:2">✕ Αφαίρεση</button></div>
      </div></div>`).join('')}`;
  }
  function bindCart() {
    const ws = document.getElementById('withSol'); if (ws) ws.onchange = () => { state.withSol = ws.checked; store.set('tt_withsol', ws.checked); };
    const cl = document.getElementById('clearCart'); if (cl) cl.onclick = () => { if (confirmClear()) { state.cart = []; saveCart(); render(); } };
    const mk = document.getElementById('makePdf'); if (mk) mk.onclick = makePdf;
    bindItems($app);
    $app.querySelectorAll('.item[data-i]').forEach(card => {
      const i = +card.dataset.i;
      card.querySelector('[data-del]').onclick = () => { state.cart.splice(i, 1); saveCart(); renderKeepScroll(); };
      card.querySelector('[data-up]').onclick = () => { if (i > 0) { [state.cart[i - 1], state.cart[i]] = [state.cart[i], state.cart[i - 1]]; saveCart(); renderKeepScroll(); } };
      card.querySelector('[data-down]').onclick = () => { if (i < state.cart.length - 1) { [state.cart[i + 1], state.cart[i]] = [state.cart[i], state.cart[i + 1]]; saveCart(); renderKeepScroll(); } };
    });
  }
  let clearArmed = 0;
  function confirmClear() {
    if (Date.now() - clearArmed < 3000) return true;
    clearArmed = Date.now(); toast('Πατήστε ξανά για άδειασμα της λίστας'); return false;
  }

  // ---------- script loader ----------
  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) loaded[src] = new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = src; sc.onload = res;
      sc.onerror = () => { delete loaded[src]; rej(new Error('load ' + src)); }; document.head.appendChild(sc);
    });
    return loaded[src];
  }
  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const PDFLIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
  const FONTKIT = 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js';

  // small in-memory cache of downloaded PDFs
  const fileCache = new Map();
  async function getFile(id, t) {
    const k = id + '-' + t;
    if (fileCache.has(k)) return fileCache.get(k);
    const r = await fetch(FILE(id, t)); if (!r.ok) throw new Error('http ' + r.status);
    const buf = await r.arrayBuffer();
    fileCache.set(k, buf); if (fileCache.size > 12) fileCache.delete(fileCache.keys().next().value);
    return buf;
  }

  // ---------- in-app PDF viewer ----------
  const V = { open: false, id: 0, t: 1, entry: null, zoom: 1, doc: null, token: 0 };
  const $v = document.getElementById('viewer'), $vb = document.getElementById('vBody');
  function viewerChrome() {
    const e = V.entry || {};
    document.getElementById('vTitle').innerHTML = `Κωδ. ${V.id} · ${V.t === 1 ? 'Εκφώνηση' : 'Ενδεικτική απάντηση'}<small>${esc(e.label || '')}${e.q ? ' · Θέμα ' + e.q + 'ο' : ''}</small>`;
    document.getElementById('vSwap').textContent = V.t === 1 ? '💡 Δείξε τη λύση' : '📄 Δείξε την εκφώνηση';
    const added = inCart(V.id);
    const vc = document.getElementById('vCart');
    vc.textContent = added ? '✓ Στην εκτύπωση' : '＋ Εκτύπωση';
    vc.className = 'btn ' + (added ? 'added' : 'alt');
  }
  function openViewer(id, t, entry) {
    Object.assign(V, { open: true, id, t, entry, zoom: 1 });
    $v.classList.remove('hidden'); document.body.style.overflow = 'hidden';
    history.pushState({ view: state.view, sIdx: state.sIdx, viewer: true }, '');
    viewerChrome(); loadDoc();
  }
  function hideViewer() {
    V.open = false; V.token++; $v.classList.add('hidden'); document.body.style.overflow = ''; $vb.innerHTML = '';
    if (V.doc) { try { V.doc.destroy(); } catch (e) { } V.doc = null; }
    renderKeepScroll();
  }
  async function loadDoc() {
    const my = ++V.token;
    $vb.innerHTML = '<div class="vmsg">Φόρτωση…</div>';
    try {
      await loadScript(PDFJS);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      const buf = await getFile(V.id, V.t);
      if (my !== V.token) return;
      if (V.doc) { try { V.doc.destroy(); } catch (e) { } }
      V.doc = await window.pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
      if (my !== V.token) return;
      await drawPages(my);
    } catch (e) {
      if (my !== V.token) return;
      $vb.innerHTML = `<div class="vmsg">Δεν ήταν δυνατή η εμφάνιση του αρχείου.<br>Ελέγξτε τη σύνδεση στο internet.<br><br>
        <a href="${FILE(V.id, V.t)}" target="_blank" rel="noopener">Άνοιγμα του αρχείου εκτός εφαρμογής</a></div>`;
    }
  }
  async function drawPages(my) {
    const doc = V.doc; if (!doc) return;
    const avail = Math.min($vb.clientWidth - 16, 900);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const frag = document.createDocumentFragment(); const canvases = [];
    for (let i = 1; i <= doc.numPages; i++) { const c = document.createElement('canvas'); frag.appendChild(c); canvases.push(c); }
    $vb.innerHTML = ''; $vb.appendChild(frag);
    for (let i = 1; i <= doc.numPages; i++) {
      if (my !== V.token) return;
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = avail / base.width * V.zoom;
      const vp = page.getViewport({ scale: scale * dpr });
      const c = canvases[i - 1];
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = Math.floor(vp.width / dpr) + 'px'; c.style.height = Math.floor(vp.height / dpr) + 'px';
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
  }
  function setZoom(z) {
    const old = V.zoom; V.zoom = Math.max(1, Math.min(3, z)); if (V.zoom === old || !V.doc) return;
    const ry = $vb.scrollTop / Math.max(1, $vb.scrollHeight), rx = $vb.scrollLeft / Math.max(1, $vb.scrollWidth);
    const my = ++V.token;
    drawPages(my).then(() => { $vb.scrollTop = ry * $vb.scrollHeight; $vb.scrollLeft = rx * $vb.scrollWidth; });
  }
  document.getElementById('vClose').onclick = () => history.back();
  document.getElementById('vIn').onclick = () => setZoom(V.zoom + 0.5);
  document.getElementById('vOut').onclick = () => setZoom(V.zoom - 0.5);
  document.getElementById('vSwap').onclick = () => { V.t = V.t === 1 ? 2 : 1; V.zoom = 1; viewerChrome(); loadDoc(); };
  document.getElementById('vCart').onclick = () => {
    const e = V.entry && V.entry.label ? V.entry : (state.cart.find(c => c.id === V.id) || { id: V.id, q: '', label: '', mats: [] });
    toggleCart(e); viewerChrome();
  };
  let rsT; window.addEventListener('resize', () => { if (!V.open) return; clearTimeout(rsT); rsT = setTimeout(() => drawPages(++V.token), 250); });

  // ---------- merged, branded PDF ----------
  const hex = (h) => { const n = parseInt(String(h).replace('#', ''), 16); return window.PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
  async function fetchBytes(url) { const r = await fetch(url); if (!r.ok) throw new Error(url); return r.arrayBuffer(); }
  function fitText(font, text, size, maxW) { while (size > 5 && font.widthOfTextAtSize(text, size) > maxW) size -= 0.25; return size; }

  let lastUrl = null;
  async function makePdf() {
    const btn = document.getElementById('makePdf'); const box = document.getElementById('pdfBox');
    const bar = document.getElementById('bar'); const msg = document.getElementById('pdfMsg'); const links = document.getElementById('pdfLinks');
    btn.disabled = true; box.classList.remove('hidden'); links.innerHTML = ''; bar.style.width = '0';
    const jobs = state.cart.map(c => [c, 1]);
    if (state.withSol) state.cart.forEach(c => jobs.push([c, 2]));
    const failed = [];
    try {
      msg.textContent = 'Προετοιμασία…';
      await loadScript(PDFLIB); await loadScript(FONTKIT);
      const { PDFDocument } = window.PDFLib;
      const out = await PDFDocument.create();
      out.registerFontkit(window.fontkit);
      const [fReg, fBold, logoBytes] = await Promise.all([
        fetchBytes('font.ttf'), fetchBytes('font-bold.ttf'),
        BRAND.logoPdf ? fetchBytes(BRAND.logoPdf).catch(() => null) : Promise.resolve(null)
      ]);
      const font = await out.embedFont(fReg, { subset: true });
      const bold = await out.embedFont(fBold, { subset: true });
      const logo = logoBytes ? await out.embedPng(logoBytes).catch(() => null) : null;

      // 1) collect pages
      const pages = []; // {emb, w, h, label}
      for (let k = 0; k < jobs.length; k++) {
        const [c, t] = jobs[k];
        msg.textContent = `Λήψη ${k + 1} από ${jobs.length} (κωδ. ${c.id}${t === 2 ? ', λύση' : ''})…`;
        try {
          const bytes = await getFile(c.id, t);
          const src = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: true });
          const idx = src.getPageIndices();
          const embs = await out.embedPdf(src, idx);
          idx.forEach((pi, j) => {
            const sz = src.getPage(pi).getSize();
            pages.push({ emb: embs[j], w: sz.width, h: sz.height, label: `Κωδ. ${c.id} · ${t === 1 ? 'Εκφώνηση' : 'Ενδεικτική απάντηση'}${c.q ? ' · Θέμα ' + c.q + 'ο' : ''}` });
          });
        } catch (e) { failed.push(c.id + (t === 2 ? ' (λύση)' : '')); }
        bar.style.width = Math.round((k + 1) / jobs.length * 90) + '%';
      }
      if (!pages.length) throw new Error('empty');

      // 2) draw with header/footer
      msg.textContent = 'Σελιδοποίηση…';
      const N = pages.length, M = 28;
      const cPri = hex(COLORS.primary), cAcc = hex(COLORS.accent), cSil = hex(COLORS.silver), cTxt = hex(COLORS.text);
      pages.forEach((pg, i) => {
        const { w, h } = pg; const HB = 50, FB = 34;
        const p = out.addPage([w, h]);
        const s = Math.min(1, (h - HB - FB) / h);
        const dw = w * s, dh = h * s;
        p.drawPage(pg.emb, { x: (w - dw) / 2, y: FB + ((h - HB - FB) - dh) / 2, width: dw, height: dh });
        // header
        const top = h - 12;
        let lx = M;
        if (logo) {
          const lh = 28, lw = logo.width * lh / logo.height;
          p.drawImage(logo, { x: M, y: top - lh, width: lw, height: lh }); lx = M + lw + 10;
        } else if (BRAND.name) {
          p.drawText(BRAND.name, { x: M, y: top - 20, size: 14, font: bold, color: cPri }); lx = M + bold.widthOfTextAtSize(BRAND.name, 14) + 10;
        }
        const maxR = w - M - lx;
        const ls = fitText(bold, pg.label, 9, maxR);
        p.drawText(pg.label, { x: w - M - bold.widthOfTextAtSize(pg.label, ls), y: top - 12, size: ls, font: bold, color: cPri });
        if (BRAND.contact) {
          const cs = fitText(font, BRAND.contact, 7.5, maxR);
          p.drawText(BRAND.contact, { x: w - M - font.widthOfTextAtSize(BRAND.contact, cs), y: top - 24, size: cs, font, color: cTxt });
        }
        p.drawLine({ start: { x: M, y: h - HB + 6 }, end: { x: w - M, y: h - HB + 6 }, thickness: 1.2, color: cAcc });
        // footer
        p.drawLine({ start: { x: M, y: FB - 6 }, end: { x: w - M, y: FB - 6 }, thickness: 0.6, color: cSil });
        const pn = `Σελίδα ${i + 1} από ${N}`;
        const pnw = font.widthOfTextAtSize(pn, 8);
        p.drawText(pn, { x: w - M - pnw, y: FB - 18, size: 8, font, color: cTxt });
        const ns = fitText(font, SOURCE_NOTE, 7, w - 2 * M - pnw - 14);
        p.drawText(SOURCE_NOTE, { x: M, y: FB - 18, size: ns, font, color: cTxt });
      });

      const bytes = await out.save();
      bar.style.width = '100%';
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const name = `themata-${new Date().toISOString().slice(0, 10)}.pdf`;
      msg.textContent = `Έτοιμο: ${N} σελίδες.` + (failed.length ? ` Δεν κατέβηκαν: ${failed.join(', ')}.` : '');
      links.innerHTML = `<a class="btn" href="${lastUrl}" target="_blank" rel="noopener">👁️ Άνοιγμα</a><a class="btn orange" href="${lastUrl}" download="${name}">⬇️ Λήψη / Εκτύπωση</a>`;
    } catch (e) {
      msg.textContent = 'Δεν ήταν δυνατή η δημιουργία του PDF. Ελέγξτε τη σύνδεση στο internet και δοκιμάστε ξανά.';
      console.error(e);
    }
    btn.disabled = false;
  }
  // ---------- install ----------
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; setupInstall(); });
  function setupInstall() {
    const card = document.getElementById('installCard'); if (!card) return;
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const btn = document.getElementById('installBtn');
    if (deferredPrompt) {
      card.classList.add('show'); btn.classList.remove('hidden');
      btn.onclick = async () => { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; card.classList.remove('show'); };
    } else if (ios) {
      card.classList.add('show'); btn.classList.add('hidden');
      document.getElementById('installText').innerHTML = 'Στο Safari πατήστε <b>Κοινοποίηση</b> (το τετράγωνο με το βέλος) και μετά <b>«Προσθήκη στην οθόνη Αφετηρίας»</b>.';
    } else {
      card.classList.add('show'); btn.classList.add('hidden');
      document.getElementById('installText').innerHTML = 'Στο Chrome πατήστε τις <b>⋮</b> πάνω δεξιά και μετά <b>«Προσθήκη στην αρχική οθόνη»</b> ή <b>«Εγκατάσταση εφαρμογής»</b>.';
    }
  }

  // ---------- render ----------
  function render() {
    document.getElementById('backBtn').classList.toggle('show', state.view !== 'home');
    if (state.view === 'subject' && state.sIdx != null) { $app.innerHTML = viewSubject(); bindSubject(); }
    else if (state.view === 'cart') { $app.innerHTML = viewCart(); bindCart(); }
    else if (state.view === 'code') { $app.innerHTML = viewCode(); bindCode(); }
    else { state.view = 'home'; $app.innerHTML = viewHome(); bindHome(); }
  }
  function renderKeepScroll() { const y = window.scrollY; render(); window.scrollTo(0, y); }

  document.getElementById('updated').textContent = window.TRAPEZA_UPDATED ? `Κατάλογος: ${window.TRAPEZA_UPDATED} · ${SUBJ.reduce((a, s) => a + s.items.length, 0)} θέματα` : '';
  updateCartCount();
  history.replaceState({ view: 'home' }, '');
  render();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
