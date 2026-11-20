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
        <a class="btn" href="${FILE(id, 1)}" target="_blank" rel="noopener">📄 Εκφώνηση</a>
        <a class="btn sol" href="${FILE(id, 2)}" target="_blank" rel="noopener">💡 Λύση</a>
        <button class="btn wide ${added ? 'added' : 'alt'}" data-act="cart">${added ? '✓ Στη λίστα εκτύπωσης' : '＋ Προσθήκη στην εκτύπωση'}</button>
      </div>
    </div>`;
  }
  function bindItems(root) {
    root.querySelectorAll('[data-act="cart"]').forEach(b => b.onclick = () => {
      const card = b.closest('.item'); const id = +card.dataset.id; const s = SUBJ[+card.dataset.s];
      const it = s.items.find(x => x[0] === id);
      if (inCart(id)) { state.cart = state.cart.filter(c => c.id !== id); toast('Αφαιρέθηκε από τη λίστα'); }
      else { state.cart.push({ id, q: it[1], label: subjLabel(s), mats: it[2].map(m => s.mats[m]).filter(Boolean) }); toast('Προστέθηκε στη λίστα εκτύπωσης'); }
      saveCart();
      const added = inCart(id);
      b.className = `btn wide ${added ? 'added' : 'alt'}`;
      b.textContent = added ? '✓ Στη λίστα εκτύπωσης' : '＋ Προσθήκη στην εκτύπωση';
    });
  }

  // ---------- views ----------
  function viewHome() {
    const subs = SUBJ.filter(s => s.school === state.school && s.cls === state.cls);
    return `
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
      filtered(s).forEach(it => { if (!inCart(it[0])) { state.cart.push({ id: it[0], q: it[1], label: subjLabel(s), mats: it[2].map(m => s.mats[m]).filter(Boolean) }); n++; } });
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
        `<div class="item"><div class="empty" style="padding:10px">Ο κωδικός δεν βρέθηκε στα Μαθηματικά.<br>Μπορείτε να δοκιμάσετε απευθείας τα αρχεία του ΙΕΠ:</div>
         <div class="actions"><a class="btn" href="${FILE(id, 1)}" target="_blank" rel="noopener">📄 Εκφώνηση</a><a class="btn sol" href="${FILE(id, 2)}" target="_blank" rel="noopener">💡 Λύση</a></div></div>`}`;
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
    ${c.map((x, i) => `<div class="item" data-i="${i}">
      <div class="top"><span class="code">${i + 1}. Κωδ. ${x.id}</span><span class="badge q${x.q}">Θέμα ${x.q}ο</span></div>
      <div class="where">${esc(x.label)}</div>
      <div class="meta">${(x.mats || []).map(esc).join(' • ')}</div>
      <div class="actions">
        <a class="btn" href="${FILE(x.id, 1)}" target="_blank" rel="noopener">📄 Εκφώνηση</a>
        <a class="btn sol" href="${FILE(x.id, 2)}" target="_blank" rel="noopener">💡 Λύση</a>
        <div class="row wide"><button class="btn alt" data-up style="flex:1">↑</button><button class="btn alt" data-down style="flex:1">↓</button><button class="btn alt" data-del style="flex:2">✕ Αφαίρεση</button></div>
      </div></div>`).join('')}`;
  }
  function bindCart() {
    const ws = document.getElementById('withSol'); if (ws) ws.onchange = () => { state.withSol = ws.checked; store.set('tt_withsol', ws.checked); };
    const cl = document.getElementById('clearCart'); if (cl) cl.onclick = () => { if (confirmClear()) { state.cart = []; saveCart(); render(); } };
    const mk = document.getElementById('makePdf'); if (mk) mk.onclick = makePdf;
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

  // ---------- merged PDF ----------
  function loadPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    return new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
      sc.onload = () => res(window.PDFLib); sc.onerror = rej; document.head.appendChild(sc);
    });
  }
  let lastUrl = null;
  async function makePdf() {
    const btn = document.getElementById('makePdf'); const box = document.getElementById('pdfBox');
    const bar = document.getElementById('bar'); const msg = document.getElementById('pdfMsg'); const links = document.getElementById('pdfLinks');
    btn.disabled = true; box.classList.remove('hidden'); links.innerHTML = '';
    const jobs = state.cart.map(c => [c.id, 1]);
    if (state.withSol) state.cart.forEach(c => jobs.push([c.id, 2]));
    const failed = [];
    try {
      msg.textContent = 'Προετοιμασία…';
      const { PDFDocument } = await loadPdfLib();
      const out = await PDFDocument.create();
      for (let k = 0; k < jobs.length; k++) {
        const [id, t] = jobs[k];
        msg.textContent = `Λήψη ${k + 1} από ${jobs.length} (θέμα ${id}${t === 2 ? ', λύση' : ''})…`;
        try {
          const r = await fetch(FILE(id, t)); if (!r.ok) throw 0;
          const src = await PDFDocument.load(await r.arrayBuffer(), { ignoreEncryption: true });
          const pages = await out.copyPages(src, src.getPageIndices());
          pages.forEach(p => out.addPage(p));
        } catch (e) { failed.push(id + (t === 2 ? ' (λύση)' : '')); }
        bar.style.width = Math.round((k + 1) / jobs.length * 100) + '%';
      }
      if (!out.getPageCount()) throw new Error('empty');
      const bytes = await out.save();
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const name = `themata-${new Date().toISOString().slice(0, 10)}.pdf`;
      msg.textContent = `Έτοιμο: ${out.getPageCount()} σελίδες.` + (failed.length ? ` Δεν κατέβηκαν: ${failed.join(', ')}.` : '');
      links.innerHTML = `<a class="btn" href="${lastUrl}" target="_blank" rel="noopener">👁️ Άνοιγμα</a><a class="btn alt" href="${lastUrl}" download="${name}">⬇️ Λήψη</a>`;
    } catch (e) {
      msg.textContent = 'Δεν ήταν δυνατή η δημιουργία του PDF. Ελέγξτε τη σύνδεση στο internet και δοκιμάστε ξανά.';
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
