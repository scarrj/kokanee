// conflict-dialog.js [WS6] - modal dialogs (shared helpers) and the local-vs-published conflict dialog.
import { diff } from './model.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let styled = false;
function injectStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const s = document.createElement('style');
  s.id = 'kk-dialog-style';
  s.textContent = `
dialog.kk-dlg{border:0;border-radius:var(--radius,10px);padding:0;width:min(680px,94vw);max-height:90vh;background:var(--panel,#fff);color:var(--fg,#212529);box-shadow:0 8px 30px rgba(0,0,0,.45);font-family:var(--font,system-ui,sans-serif)}
dialog.kk-dlg::backdrop{background:rgba(0,0,0,.5)}
.kk-dlg h2{margin:0;padding:14px 16px 4px;font-size:18px}
.kk-dlg .kk-body{padding:6px 16px 10px;max-height:62vh;overflow:auto;font-size:14px;line-height:1.4}
.kk-dlg .kk-body p{margin:6px 0}
.kk-dlg .kk-foot{display:flex;flex-wrap:wrap;gap:8px;padding:10px 16px 14px;justify-content:flex-end}
.kk-btn{min-height:var(--tap,44px);min-width:var(--tap,44px);padding:0 14px;border:1px solid var(--line,#dee2e6);border-radius:var(--radius,10px);background:var(--bg,#f8f9fa);color:var(--fg,#212529);font:inherit;cursor:pointer}
.kk-btn.primary{background:var(--accent,#0b6ea8);color:#fff;border-color:transparent}
.kk-btn.danger{background:var(--danger,#c92a2a);color:#fff;border-color:transparent}
.kk-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:600px){.kk-cols{grid-template-columns:1fr}}
.kk-col{border:1px solid var(--line,#dee2e6);border-radius:8px;padding:8px 10px;min-width:0}
.kk-col h3{margin:0 0 4px;font-size:14px}
.kk-list{list-style:none;margin:0;padding:0;font-size:13px}
.kk-list li{padding:2px 0;overflow-wrap:anywhere}
.kk-list .sg{display:inline-block;width:1.4em;font-weight:700;font-family:monospace}
.kk-list .sg.add{color:#2b8a3e}.kk-list .sg.chg{color:#e67700}.kk-list .sg.del{color:var(--danger,#c92a2a)}
.kk-list .both{font-weight:600}
.kk-muted{color:var(--muted,#5c636a)}
.kk-err{margin:6px 0;padding-left:18px;font-size:13px;overflow-wrap:anywhere}
`;
  document.head.appendChild(s);
}

// showDialog({title, body (HTML string or Node), actions:[{label, value, kind}], dismissValue, locked}) -> Promise<value>
export function showDialog({ title, body, actions, dismissValue = null, locked = false }) {
  injectStyle();
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'kk-dlg';
    d.setAttribute('aria-label', title || 'Dialog');
    const h = document.createElement('h2'); h.textContent = title || '';
    const b = document.createElement('div'); b.className = 'kk-body';
    if (body instanceof Node) b.appendChild(body); else b.innerHTML = body || '';
    const f = document.createElement('div'); f.className = 'kk-foot';
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { d.close(); } catch { /* already closed */ } d.remove(); resolve(v); };
    for (const a of actions || [{ label: 'OK', value: true, kind: 'primary' }]) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = `kk-btn ${a.kind || ''}`; btn.textContent = a.label;
      btn.addEventListener('click', () => finish(a.value));
      f.appendChild(btn);
    }
    d.append(h, b, f);
    d.addEventListener('cancel', (ev) => { ev.preventDefault(); if (!locked) finish(dismissValue); });
    document.body.appendChild(d);
    d.showModal();
  });
}

// confirmDialog({title, message (text) | html, ok, cancel, danger}) -> Promise<boolean>
export function confirmDialog({ title = 'Confirm', message = '', html = null, ok = 'OK', cancel = 'Cancel', danger = false }) {
  return showDialog({
    title, body: html != null ? html : `<p>${esc(message).replace(/\n/g, '<br>')}</p>`,
    actions: [{ label: cancel, value: false }, { label: ok, value: true, kind: danger ? 'danger' : 'primary' }], dismissValue: false,
  });
}

// messageDialog({title, message | html, ok}) -> Promise<void>
export function messageDialog({ title = 'Notice', message = '', html = null, ok = 'OK' }) {
  return showDialog({ title, body: html != null ? html : `<p>${esc(message).replace(/\n/g, '<br>')}</p>`, actions: [{ label: ok, value: true, kind: 'primary' }] }).then(() => undefined);
}

const KIND = { zone: 'Zone', route: 'Route', poi: 'POI', area: 'Area' };
const COLL = { zone: 'zones', route: 'routes', poi: 'pois', area: 'areas' };

function nameOf(kind, id, datas) {
  for (const d of datas) {
    const o = d && (d[COLL[kind]] || []).find((x) => x.id === id);
    if (o) return kind === 'route' ? `${o.num} ${o.name}` : o.name;
  }
  return '';
}

// diffRows(diffResult, datas) -> [{sign:'+'|'~'|'-', kind, id, text}] grouped route, zone, area, poi
export function diffRows(dif, datas) {
  const rows = [];
  const add = (list, sign) => { for (const x of list) rows.push({ sign, kind: x.kind, id: x.id, text: `${KIND[x.kind]} ${x.id} ${nameOf(x.kind, x.id, datas)}`.trim() }); };
  add(dif.added, '+'); add(dif.changed, '~'); add(dif.removed, '-');
  const order = { route: 0, zone: 1, area: 2, poi: 3 };
  return rows.sort((a, b) => order[a.kind] - order[b.kind] || a.id.localeCompare(b.id));
}

function listHTML(rows, both = new Set()) {
  if (!rows.length) return '<p class="kk-muted">No differences</p>';
  const cls = { '+': 'add', '~': 'chg', '-': 'del' };
  const shown = rows.slice(0, 40).map((r) => `<li class="${both.has(`${r.kind}:${r.id}`) ? 'both' : ''}"><span class="sg ${cls[r.sign]}">${r.sign}</span>${esc(r.text)}</li>`).join('');
  return `<ul class="kk-list">${shown}${rows.length > 40 ? `<li class="kk-muted">and ${rows.length - 40} more</li>` : ''}</ul>`;
}

// summaryHTML: used by the import confirmation. dif = diff(current, incoming).
export function summaryHTML(dif, datas) {
  const n = dif.added.length + dif.changed.length + dif.removed.length;
  if (!n) return '<p>The file is identical to your current data.</p>';
  return `<p>Compared with your current data: <b>${dif.added.length}</b> added, <b>${dif.changed.length}</b> changed, <b>${dif.removed.length}</b> removed.</p>${listHTML(diffRows(dif, datas))}`;
}

// openConflictDialog({published, local, base, baseRev}) -> Promise<'mine'|'published'|'export'>
// "export" means: the user wants a download of their data first; the caller exports and asks again.
export function openConflictDialog({ published, local, base = null, baseRev = null }) {
  const datas = [local, published, base];
  let left, right, note = '';
  if (base) {
    const mine = diff(base, local), theirs = diff(base, published);
    const ids = (d) => new Set([...d.added, ...d.changed, ...d.removed].map((x) => `${x.kind}:${x.id}`));
    const a = ids(mine), b = ids(theirs), both = new Set([...a].filter((x) => b.has(x)));
    left = listHTML(diffRows(mine, [local, base, published]), both); right = listHTML(diffRows(theirs, [published, base, local]), both);
    note = both.size ? `<p><b>${both.size}</b> item(s) were changed on both sides (shown in bold). Keeping yours overwrites the published version of those.</p>` : '';
  } else {
    const dif = diff(published, local);
    left = listHTML(diffRows(dif, datas)); right = '<p class="kk-muted">The base version is not available, so the list on the left shows every difference between the published data and yours (+ only in yours, - only in published, ~ different).</p>';
  }
  const body = `<p>The published data is now revision <b>${esc(published.content_rev)}</b>, but your unpublished edits were made on revision <b>${esc(baseRev)}</b>.</p>${note}
    <div class="kk-cols"><div class="kk-col"><h3>Your edits</h3>${left}</div><div class="kk-col"><h3>Published changes</h3>${right}</div></div>
    <p class="kk-muted">Keep mine: your data stays and is rebased on revision ${esc(published.content_rev)}. Take published: a recovery copy of your edits is saved first.</p>`;
  return showDialog({
    title: 'Your edits conflict with newer published data', body, locked: true,
    actions: [
      { label: 'Export mine first', value: 'export' },
      { label: 'Take published', value: 'published', kind: 'danger' },
      { label: 'Keep mine', value: 'mine', kind: 'primary' },
    ],
  });
}
