/* KZ 26 · API de administración (Cloudflare Workers + KV)
   Guarda baneos, expulsiones y regalos por ID de jugador, y publica en Discord.
   Secretos (NO van en el código): ADMIN_KEY, DISCORD_WEBHOOK (opcional).
   Variables opcionales: ALLOWED_ORIGIN (ej. https://tuusuario.github.io), DISCORD_AUDIT ("1" para avisar cada acción de admin en Discord).
   KV: enlaza un namespace con el nombre KZ. */

const ID_RE = /^[1-9]\d{7}$/;
const MAX_GIFT_KICKS = 1000000;

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
const json = (env, obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors(env)) });

function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  let d = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

async function getP(env, id) {
  const raw = await env.KZ.get('p:' + id);
  if (!raw) return { banned: false, reason: '', bannedAt: 0, kickAt: 0, gifts: [] };
  try { const p = JSON.parse(raw); p.gifts = Array.isArray(p.gifts) ? p.gifts : []; return p; } catch (e) { return { banned: false, reason: '', bannedAt: 0, kickAt: 0, gifts: [] }; }
}
const putP = (env, id, p) => env.KZ.put('p:' + id, JSON.stringify(p));

async function addLog(env, action, id, detail) {
  let log = [];
  try { log = JSON.parse((await env.KZ.get('log')) || '[]'); } catch (e) { log = []; }
  log.unshift({ ts: Date.now(), action, id: id || '', detail: String(detail || '').slice(0, 200) });
  await env.KZ.put('log', JSON.stringify(log.slice(0, 60)));
  if (env.DISCORD_WEBHOOK && env.DISCORD_AUDIT === '1') {
    await sendDiscord(env, 'KZ 26 · Registro', `**${action}** ${id ? '· ID ' + id : ''} ${detail ? '· ' + String(detail).slice(0, 300) : ''}`).catch(() => {});
  }
}

async function sendDiscord(env, username, content) {
  if (!env.DISCORD_WEBHOOK) throw new Error('Discord no está configurado en el servidor');
  const r = await fetch(env.DISCORD_WEBHOOK, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: String(username || 'KZ 26').slice(0, 80), content: String(content).slice(0, 1900), allowed_mentions: { parse: [] } })
  });
  if (!r.ok) throw new Error('Discord respondió ' + r.status);
}

async function auth(req, env) {
  if (!env.ADMIN_KEY) return { ok: false, status: 503, error: 'ADMIN_KEY no está configurada en el servidor' };
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const rk = 'rl:' + ip;
  const tries = Number((await env.KZ.get(rk)) || 0);
  if (tries >= 8) return { ok: false, status: 429, error: 'Demasiados intentos. Espera 15 minutos.' };
  if (!safeEqual(req.headers.get('X-Admin-Key'), env.ADMIN_KEY)) {
    await env.KZ.put(rk, String(tries + 1), { expirationTtl: 900 });
    return { ok: false, status: 401, error: 'Clave incorrecta' };
  }
  if (tries) await env.KZ.delete(rk);
  return { ok: true };
}

async function body(req) { try { return await req.json(); } catch (e) { return {}; } }
const cleanId = s => (ID_RE.test(String(s)) ? String(s) : null);

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
    if (!env.KZ) return json(env, { error: 'Falta enlazar el KV "KZ"' }, 503);
    const url = new URL(req.url), path = url.pathname.replace(/\/+$/, '') || '/';
    const parts = path.split('/').filter(Boolean);

    try {
      /* ---------- público: estado de un jugador ---------- */
      if (parts[0] === 'player' && parts[1]) {
        const id = cleanId(parts[1]); if (!id) return json(env, { error: 'ID inválido' }, 400);
        if (req.method === 'GET' && !parts[2]) {
          const p = await getP(env, id);
          return json(env, { banned: !!p.banned, reason: p.banned ? p.reason : '', kickAt: p.kickAt || 0, pending: p.gifts.filter(g => !g.claimed).length, now: Date.now() });
        }
        if (req.method === 'POST' && parts[2] === 'claim') {
          const p = await getP(env, id);
          if (p.banned) return json(env, { gifts: [] });
          const out = [];
          for (const g of p.gifts) if (!g.claimed) { g.claimed = true; g.claimedAt = Date.now(); out.push({ gid: g.gid, kicks: g.kicks, item: g.item, note: g.note }); }
          if (out.length) await putP(env, id, p);
          return json(env, { gifts: out });
        }
      }

      /* ---------- administración ---------- */
      if (parts[0] === 'admin') {
        const a = await auth(req, env);
        if (!a.ok) return json(env, { error: a.error }, a.status);
        const act = parts[1];

        if (act === 'login' && req.method === 'POST') return json(env, { ok: true, discord: !!env.DISCORD_WEBHOOK });

        if (act === 'overview' && req.method === 'GET') {
          const list = await env.KZ.list({ prefix: 'p:', limit: 1000 });
          let bans = 0, pending = 0;
          for (const k of list.keys) {
            const raw = await env.KZ.get(k.name); if (!raw) continue;
            try { const p = JSON.parse(raw); if (p.banned) bans++; pending += (p.gifts || []).filter(g => !g.claimed).length; } catch (e) { /* ok */ }
          }
          let log = []; try { log = JSON.parse((await env.KZ.get('log')) || '[]'); } catch (e) { /* ok */ }
          return json(env, { records: list.keys.length, bans, pending, log: log.slice(0, 30), discord: !!env.DISCORD_WEBHOOK });
        }

        if (act === 'player' && parts[2] && req.method === 'GET') {
          const id = cleanId(parts[2]); if (!id) return json(env, { error: 'ID inválido' }, 400);
          const p = await getP(env, id);
          return json(env, { id, banned: !!p.banned, reason: p.reason || '', bannedAt: p.bannedAt || 0, kickAt: p.kickAt || 0, gifts: p.gifts.slice(-20).reverse() });
        }

        if (act === 'bans' && req.method === 'GET') {
          const list = await env.KZ.list({ prefix: 'p:', limit: 1000 }), out = [];
          for (const k of list.keys) {
            const raw = await env.KZ.get(k.name); if (!raw) continue;
            try { const p = JSON.parse(raw); if (p.banned) out.push({ id: k.name.slice(2), reason: p.reason || '', bannedAt: p.bannedAt || 0 }); } catch (e) { /* ok */ }
          }
          return json(env, { bans: out.sort((x, y) => y.bannedAt - x.bannedAt) });
        }

        if (req.method === 'POST') {
          const b = await body(req);
          if (act === 'say') {
            const msg = String(b.message || '').trim(); if (!msg) return json(env, { error: 'Escribe un mensaje' }, 400);
            await sendDiscord(env, String(b.username || 'KZ 26 Admin').trim() || 'KZ 26 Admin', msg);
            await addLog(env, 'Mensaje a Discord', '', msg.slice(0, 80));
            return json(env, { ok: true });
          }
          const id = cleanId(b.id); if (!id) return json(env, { error: 'ID inválido (8 dígitos)' }, 400);
          const p = await getP(env, id);
          if (act === 'ban') {
            p.banned = true; p.reason = String(b.reason || 'Sin motivo').slice(0, 200); p.bannedAt = Date.now();
            await putP(env, id, p); await addLog(env, 'Baneo', id, p.reason); return json(env, { ok: true });
          }
          if (act === 'unban') {
            p.banned = false; p.reason = ''; await putP(env, id, p); await addLog(env, 'Desbaneo', id, ''); return json(env, { ok: true });
          }
          if (act === 'kick') {
            p.kickAt = Date.now(); await putP(env, id, p); await addLog(env, 'Expulsión', id, ''); return json(env, { ok: true });
          }
          if (act === 'gift') {
            const kicks = Math.max(0, Math.min(MAX_GIFT_KICKS, Math.floor(Number(b.kicks) || 0)));
            const item = String(b.item || '').trim().slice(0, 80), note = String(b.note || '').trim().slice(0, 160);
            if (!kicks && !item) return json(env, { error: 'Indica Kicks o un objeto' }, 400);
            p.gifts.push({ gid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kicks, item, note, ts: Date.now(), claimed: false });
            p.gifts = p.gifts.slice(-50);
            await putP(env, id, p); await addLog(env, 'Regalo', id, (kicks ? kicks + ' Kicks ' : '') + item); return json(env, { ok: true });
          }
        }
      }
      return json(env, { error: 'No encontrado' }, 404);
    } catch (e) {
      return json(env, { error: String(e && e.message || e) }, 500);
    }
  }
};
