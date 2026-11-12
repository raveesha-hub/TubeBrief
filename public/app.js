import { firebaseConfig } from './firebase-config.js';

const $ = id => document.getElementById(id);
const V = 'https://www.gstatic.com/firebasejs/10.12.2/';

/* ================= Theme ================= */
const root = document.documentElement;
function setTheme(t) {
  root.dataset.theme = t;
  $('themeBtn').textContent = t === 'dark' ? '☀️' : '🌙';
  try { localStorage.setItem('theme', t); } catch (e) {}
}
setTheme(root.dataset.theme);
$('themeBtn').onclick = () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');

/* ================= Views & slides ================= */
function showView(v) {
  $('slides').hidden = v !== 'home';
  $('dots').hidden = v !== 'home';
  $('view-history').hidden = v !== 'history';
  document.querySelectorAll('.nav [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  if (v === 'history') renderHistory();
}
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => showView(b.dataset.view));
$('logo').onclick = e => { e.preventDefault(); showView('home'); $('s-hero').scrollIntoView(); };
document.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => $(b.dataset.goto).scrollIntoView({ behavior: 'smooth' }));

const slideIds = ['s-hero', 's-url', 's-summary', 's-ask'];
function buildDots() {
  const box = $('dots'); box.innerHTML = '';
  slideIds.filter(id => !$(id).hidden).forEach(id => {
    const b = document.createElement('button');
    b.dataset.id = id; b.title = id.replace('s-', '');
    b.onclick = () => $(id).scrollIntoView({ behavior: 'smooth' });
    box.appendChild(b);
  });
  observe();
}
let io;
function observe() {
  io && io.disconnect();
  io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) document.querySelectorAll('.dots button').forEach(b => b.classList.toggle('on', b.dataset.id === e.target.id));
  }), { root: $('slides'), threshold: 0.55 });
  slideIds.forEach(id => !$(id).hidden && io.observe($(id)));
}
buildDots();

/* language selects stay in sync */
$('lang').onchange = () => { $('lang2').value = $('lang').value; };
$('lang2').onchange = () => { $('lang').value = $('lang2').value; };

/* ================= Firebase (optional) ================= */
let fb = null, user = null;
const configured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('YOUR_');
if (configured) {
  try {
    const [{ initializeApp }, A, F] = await Promise.all([
      import(V + 'firebase-app.js'), import(V + 'firebase-auth.js'), import(V + 'firebase-firestore.js')
    ]);
    const app = initializeApp(firebaseConfig);
    fb = { A, F, auth: A.getAuth(app), db: F.getFirestore(app) };
    A.onAuthStateChanged(fb.auth, u => {
      user = u;
      $('authBtn').textContent = u ? 'Logout' : 'Login';
      $('userName').textContent = u ? (u.displayName || u.email) : '';
      if (!$('view-history').hidden) renderHistory();
    });
  } catch (e) { console.warn('Firebase failed to load', e); }
}

let registerMode = false;
function authMode(reg) {
  registerMode = reg;
  $('authTitle').textContent = reg ? 'Register' : 'Login';
  $('authSubmit').textContent = reg ? 'Register' : 'Login';
  $('authSwitch').textContent = reg ? 'Already have an account? Login' : 'New here? Register';
}
$('authSwitch').onclick = () => authMode(!registerMode);
$('authBtn').onclick = () => {
  if (!fb) return alert("Firebase configuration has not been added to public/firebase-config.js. Currently, the history is being saved in this browser.");
  if (user) return fb.A.signOut(fb.auth);
  $('authErr').hidden = true; $('authModal').showModal();
};
const authErr = e => { $('authErr').textContent = e.message.replace('Firebase: ', ''); $('authErr').hidden = false; };
$('googleBtn').onclick = () => fb.A.signInWithPopup(fb.auth, new fb.A.GoogleAuthProvider()).then(() => $('authModal').close()).catch(authErr);
$('authSubmit').onclick = () => {
  const fn = registerMode ? fb.A.createUserWithEmailAndPassword : fb.A.signInWithEmailAndPassword;
  fn(fb.auth, $('email').value, $('pass').value).then(() => $('authModal').close()).catch(authErr);
};

/* ================= Helpers ================= */
const videoId = u => (u.match(/(?:v=|youtu\.be\/|shorts\/|live\/)([\w-]{11})/) || [])[1];
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
function md(text) {
  let html = '', inList = false;
  for (const raw of String(text).split('\n')) {
    const l = raw.trim();
    const li = l.match(/^[-*•]\s+(.*)/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (/^#{1,6}\s/.test(l)) html += `<h2>${inline(l.replace(/^#+\s*/, ''))}</h2>`;
    else if (l) html += `<p>${inline(l)}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}
async function fetchTitle(url) {
  try {
    const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url));
    return (await r.json()).title || '';
  } catch (e) { return ''; }
}
async function api(body) {
  const r = await fetch('/api/summarize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data.result;
}

/* ================= Current session ================= */
let cur = null; // {url,vid,title,summary,qa:[{q,a}],transcript,fid,lid}
let saveChain = Promise.resolve();

const LS = 'tb_history';
const lsGet = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { return []; } };
const lsSet = a => { try { localStorage.setItem(LS, JSON.stringify(a.slice(0, 50))); } catch (e) {} };

async function persist() {
  const s = cur; if (!s) return;
  const data = { url: s.url, vid: s.vid, title: s.title, summary: s.summary, qa: s.qa, date: s.date };
  if (user && fb) {
    const { F } = fb;
    if (s.fid) await F.updateDoc(F.doc(fb.db, 'users', user.uid, 'history', s.fid), { qa: s.qa, title: s.title });
    else s.fid = (await F.addDoc(F.collection(fb.db, 'users', user.uid, 'history'), { ...data, createdAt: F.serverTimestamp() })).id;
  } else {
    const arr = lsGet();
    const i = arr.findIndex(x => x.id === s.lid);
    if (i >= 0) arr[i] = { ...arr[i], qa: s.qa, title: s.title };
    else { s.lid = String(Date.now()); arr.unshift({ id: s.lid, ...data }); }
    lsSet(arr);
  }
}
const save = () => { saveChain = saveChain.then(persist).catch(e => console.warn('save failed', e)); };

/* ================= Render session into slides ================= */
function bubble(cls, html) {
  const d = document.createElement('div');
  d.className = 'bub ' + cls; d.innerHTML = html;
  $('thread').appendChild(d);
  $('thread').scrollTop = $('thread').scrollHeight;
  return d;
}
function renderSession(s, goto = 's-summary') {
  cur = s;
  $('thumb').src = s.vid ? `https://i.ytimg.com/vi/${s.vid}/mqdefault.jpg` : '';
  $('thumb').hidden = !s.vid;
  $('vtitle').textContent = s.title || s.url || 'Pasted transcript';
  $('out').innerHTML = md(s.summary);
  $('thread').innerHTML = '';
  s.qa.forEach(x => { bubble('q', esc(x.q)); bubble('a md', md(x.a)); });
  $('s-summary').hidden = false; $('s-ask').hidden = false;
  buildDots();
  setTimeout(() => $(goto).scrollIntoView({ behavior: 'smooth' }), 60);
}
function setError(m) { $('error').textContent = m || ''; $('error').hidden = !m; }

/* ================= Generate summary ================= */
$('go').onclick = async () => {
  setError('');
  const url = $('url').value.trim(), transcript = $('transcript').value.trim();
  if (!url && !transcript) return setError('Add a YouTube URL.');
  if (url && !videoId(url) && !transcript) return setError('Invalid YouTube URL.');
  $('go').disabled = true; $('loader').hidden = false;
  try {
    const [summary, title] = await Promise.all([
      api({ url, language: $('lang').value, transcript }),
      url ? fetchTitle(url) : Promise.resolve('')
    ]);
    const s = { url, vid: videoId(url) || '', title, summary, qa: [], transcript, date: Date.now() };
    renderSession(s);
    save();
  } catch (e) { setError(e.message); }
  $('go').disabled = false; $('loader').hidden = true;
};

$('copyBtn').onclick = () => {
  navigator.clipboard.writeText(cur.summary);
  $('copyBtn').textContent = 'Copied ✓'; setTimeout(() => $('copyBtn').textContent = 'Copy', 1500);
};
$('dlBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([cur.summary], { type: 'text/markdown' }));
  a.download = 'summary.md'; a.click();
};

/* ================= Ask questions (unlimited) ================= */
const SUGGEST = ['What is the main idea?', 'Give me 5 key takeaways.', 'What are some examples?', 'Explain like I am a beginner'];
SUGGEST.forEach(t => {
  const b = document.createElement('button'); b.textContent = t;
  b.onclick = () => ask(t); $('chips').appendChild(b);
});

async function ask(q) {
  q = (q || $('question').value).trim();
  if (!q || !cur || $('askBtn').disabled) return;
  $('question').value = '';
  $('askBtn').disabled = true;
  bubble('q', esc(q));
  const wait = bubble('a typing', 'Thinking…');
  try {
    const a = await api({ url: cur.url, question: q, language: $('lang2').value, transcript: cur.transcript });
    wait.className = 'bub a md'; wait.innerHTML = md(a);
    cur.qa.push({ q, a });
    save();
  } catch (e) { wait.className = 'bub a'; wait.innerHTML = `<span class="error">${esc(e.message)}</span>`; }
  $('thread').scrollTop = $('thread').scrollHeight;
  $('askBtn').disabled = false;
  $('question').focus();
}
$('askBtn').onclick = () => ask();
$('question').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } };

/* ================= History ================= */
async function loadHistory() {
  if (user && fb) {
    const { F } = fb;
    const q = F.query(F.collection(fb.db, 'users', user.uid, 'history'), F.orderBy('createdAt', 'desc'), F.limit(50));
    return (await F.getDocs(q)).docs.map(d => ({ id: d.id, ...d.data() }));
  }
  return lsGet();
}
async function renderHistory() {
  $('histNote').textContent = user ? 'Saved to your account ☁️' : 'If you log in, your history will be saved to your account (currently, it is saved in this browser).';
  const items = await loadHistory();
  const box = $('histList');
  box.innerHTML = items.length ? '' : '<p class="muted">There is no history yet.</p>';
  items.forEach(it => {
    const qa = it.qa || [];
    const el = document.createElement('div');
    el.className = 'hist-item';
    el.innerHTML = `
      <div class="hist-head">
        <img src="https://i.ytimg.com/vi/${esc(it.vid || '')}/mqdefault.jpg" alt="">
        <div class="meta"><b>${esc(it.title || it.url || 'Summary')}</b>
          <span>${new Date(it.date || Date.now()).toLocaleString()} • ${qa.length} question${qa.length === 1 ? '' : 's'}</span></div>
        <button class="arrow" title="Show summary & questions" aria-expanded="false">▾</button>
        <button class="trash" title="Delete">🗑️</button>
      </div>
      <div class="hist-body">
        <h4>Summary</h4><div class="md">${md(it.summary || '')}</div>
        <h4>Questions & answers</h4>
        ${qa.length ? qa.map(x => `<div class="bub q">${esc(x.q)}</div><div class="bub a md">${md(x.a)}</div>`).join('') : '<p class="muted">No questions have been asked about this yet.</p>'}
        <button class="btn small open">Open & continue asking</button>
      </div>`;
    const arrow = el.querySelector('.arrow');
    arrow.onclick = () => { const o = el.classList.toggle('open'); arrow.setAttribute('aria-expanded', o); };
    el.querySelector('.open').onclick = () => {
      showView('home');
      renderSession({ url: it.url, vid: it.vid, title: it.title, summary: it.summary, qa: [...qa], transcript: '', date: it.date, fid: user && fb ? it.id : undefined, lid: user && fb ? undefined : it.id }, 's-ask');
    };
    el.querySelector('.trash').onclick = async () => {
      if (user && fb) await fb.F.deleteDoc(fb.F.doc(fb.db, 'users', user.uid, 'history', it.id));
      else lsSet(lsGet().filter(x => x.id !== it.id));
      renderHistory();
    };
    box.appendChild(el);
  });
}
$('clearHist').onclick = async () => {
  if (!confirm('Are you sure you want to delete all history?')) return;
  if (user && fb) for (const it of await loadHistory()) await fb.F.deleteDoc(fb.F.doc(fb.db, 'users', user.uid, 'history', it.id));
  else lsSet([]);
  renderHistory();
};

showView('home');
