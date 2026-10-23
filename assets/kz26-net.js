/* KZ 26 · conexión con el servidor: baneos, expulsiones y regalos. No guarda ningún secreto. */
(function () {
  'use strict';
  var API = String(window.KZ_API_URL || '').replace(/\/+$/, '');
  var ID_RE = /^[1-9]\d{7}$/;
  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ok */ } }

  /* ----- cartera de Kicks (local) ----- */
  function wallet() {
    var w = { kicks: 0, items: [] };
    try {
      var j = JSON.parse(ls('kz26.wallet') || 'null');
      if (j && typeof j === 'object') {
        w.kicks = Math.max(0, Math.floor(Number(j.kicks)) || 0);
        w.items = Array.isArray(j.items) ? j.items.filter(function (x) { return typeof x === 'string'; }).slice(-100) : [];
      }
    } catch (e) { /* ok */ }
    return w;
  }
  function saveWallet(w) { lset('kz26.wallet', JSON.stringify(w)); renderChip(); }
  window.KZ = { wallet: wallet, saveWallet: saveWallet };

  /* ----- elementos visuales ----- */
  var chip = null;
  function renderChip() {
    var anchor = document.getElementById('bId');
    if (!anchor) return;
    if (!chip || !chip.isConnected) {
      chip = document.createElement('span'); chip.className = 'kzchip'; chip.title = 'Tus Kicks';
      anchor.parentNode.insertBefore(chip, anchor);
    }
    chip.textContent = '◈ ' + wallet().kicks.toLocaleString('es-CL') + ' Kicks';
  }
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'kztoast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 5200);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 6000);
  }
  function block(kind, title, text, id, btn) {
    if (document.getElementById('kzblock')) return;
    try { document.querySelectorAll('audio,video').forEach(function (a) { a.pause(); }); } catch (e) { /* ok */ }
    var o = document.createElement('div'); o.id = 'kzblock'; o.className = 'kzblock ' + kind;
    var box = document.createElement('div'); box.className = 'kzbox';
    var h = document.createElement('h2'); h.textContent = title;
    var p = document.createElement('p'); p.textContent = text;
    var c = document.createElement('code'); c.textContent = id ? 'ID ' + id : '';
    box.appendChild(h); box.appendChild(p); if (id) box.appendChild(c);
    if (btn) { var b = document.createElement('button'); b.type = 'button'; b.textContent = btn.label; b.addEventListener('click', btn.fn); box.appendChild(b); }
    o.appendChild(box); document.body.appendChild(o); document.body.style.overflow = 'hidden';
  }

  /* ----- sesión ----- */
  var sess = Number((function () { try { return sessionStorage.getItem('kz26.sess'); } catch (e) { return null; } })());
  if (!sess) { sess = Date.now(); try { sessionStorage.setItem('kz26.sess', String(sess)); } catch (e) { /* ok */ } }
  function playerId() { try { var p = JSON.parse(ls('kz26.profile') || 'null'); return p && ID_RE.test(String(p.id)) ? String(p.id) : null; } catch (e) { return null; } }

  function req(path, opt) {
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var to = ctl ? setTimeout(function () { ctl.abort(); }, 7000) : 0;
    return fetch(API + path, Object.assign({ cache: 'no-store', signal: ctl ? ctl.signal : undefined }, opt || {}))
      .then(function (r) { if (to) clearTimeout(to); if (!r.ok) throw new Error('http ' + r.status); return r.json(); });
  }

  var kicked = false;
  function check() {
    var id = playerId(); if (!id || !API) return;
    req('/player/' + id).then(function (s) {
      if (s.banned) { block('ban', 'Cuenta suspendida', 'Un administrador suspendió esta cuenta.' + (s.reason ? ' Motivo: ' + s.reason : ''), id); return; }
      if (s.kickAt && s.kickAt > sess && !kicked) {
        kicked = true;
        block('kick', 'Fuiste expulsado', 'Un administrador te sacó de la sesión. Puedes volver a entrar desde el inicio.', id,
          { label: 'Volver al inicio', fn: function () { try { sessionStorage.clear(); } catch (e) { /* ok */ } sessionStorage.setItem('kz26.sess', String(Date.now() + 1000)); location.href = rootPath(); } });
        return;
      }
      if (s.pending > 0) claim(id);
    }).catch(function () { /* sin conexión: se reintenta */ });
  }
  function rootPath() { var p = location.pathname, i = p.indexOf('/play/'); if (i < 0) i = p.indexOf('/home/'); return i >= 0 ? p.slice(0, i) + '/home/' : 'home/'; }
  function claim(id) {
    req('/player/' + id + '/claim', { method: 'POST' }).then(function (r) {
      var gs = (r && r.gifts) || []; if (!gs.length) return;
      var w = wallet(), n = 0, items = [];
      gs.forEach(function (g) { n += Math.max(0, Math.floor(Number(g.kicks)) || 0); if (g.item) { w.items.push(String(g.item).slice(0, 80)); items.push(String(g.item).slice(0, 80)); } });
      w.kicks += n; saveWallet(w);
      toast('Regalo recibido: ' + (n ? n.toLocaleString('es-CL') + ' Kicks' : '') + (n && items.length ? ' + ' : '') + items.join(', '));
    }).catch(function () { /* ok */ });
  }

  function start() { renderChip(); check(); if (API) setInterval(check, 45000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
