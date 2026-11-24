'use strict';
// Relevo de Mr.RoBoT en Render: mando a distancia de la app de escritorio.
//  · No guarda NADA (Render gratis no conserva disco): los datos, las IAs y los permisos viven en la app del PC.
//  · La app del PC se conecta hacia aquí (no hace falta abrir puertos en casa) y recoge las peticiones de los navegadores.
//  · La app se identifica firmando cada llamada con su llave privada (Ed25519). Aquí solo está la PÚBLICA (variable MR_LLAVE_PUBLICA).
//  · Los navegadores se vinculan con un código de un solo uso que da la app; la app decide qué se puede hacer desde fuera.
//  · Sin dependencias externas: solo Node.
const http = require('http'), crypto = require('crypto');
const PUERTO = +process.env.PORT || 10000;
const PUB = (() => { try { const t = Buffer.from(process.env.MR_LLAVE_PUBLICA || '', 'base64').toString('utf8'); return t.includes('BEGIN PUBLIC KEY') ? crypto.createPublicKey(t) : null; } catch { return null; } })();
const ESPERA_MS = 25000, RESP_MS = 60000, MAX_CUERPO = 4 * 1024 * 1024, MAX_COLA = 100;
let cola = [], recogedor = null, ultimoPC = 0;
const pendientes = new Map(); // id → { res, t }
const vistos = new Map();    // firmas usadas (contra repeticiones)
const porIP = new Map();     // límite por IP

const conectado = () => Date.now() - ultimoPC < ESPERA_MS + 15000;
const cab = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Strict-Transport-Security': 'max-age=31536000' };
function enviar(res, cod, cuerpo, tipo = 'application/json; charset=utf-8', extra = {}) { if (res.headersSent) return; res.writeHead(cod, { ...cab, 'Content-Type': tipo, ...extra }); res.end(cuerpo); }
function leer(req, max = MAX_CUERPO) { return new Promise((ok, mal) => { const p = []; let n = 0; req.on('data', c => { n += c.length; if (n > max) { mal(Object.assign(new Error('demasiado grande'), { cod: 413 })); req.destroy(); } else p.push(c); }); req.on('end', () => ok(Buffer.concat(p))); req.on('error', mal); }); }
function ipDe(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function limite(req) { const ip = ipDe(req), m = Math.floor(Date.now() / 60000), k = ip + '|' + m, n = (porIP.get(k) || 0) + 1; porIP.set(k, n); if (porIP.size > 5000) porIP.clear(); return n <= 240; }

// La app firma «t.ruta» con su llave privada; se acepta 2 minutos y una sola vez.
function esElPC(req) {
  if (!PUB) return false;
  const t = +req.headers['x-mr-t'], f = String(req.headers['x-mr-firma'] || '');
  if (!t || Math.abs(Date.now() - t) > 120000 || !f || vistos.has(f)) return false;
  let ok = false; try { ok = crypto.verify(null, Buffer.from(t + '.' + req.url), PUB, Buffer.from(f, 'base64')); } catch { }
  if (ok) { vistos.set(f, Date.now()); if (vistos.size > 2000) for (const [k, v] of vistos) if (Date.now() - v > 150000) vistos.delete(k); }
  return ok;
}
function entregar() { if (recogedor && cola.length) { const r = recogedor; recogedor = null; clearTimeout(r.tm); enviar(r.res, 200, JSON.stringify(cola.splice(0, 20))); } }

const PAGINA_FUERA = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mr.RoBoT</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f0d;color:#e6ede9;font:16px system-ui,sans-serif;padding:16px;box-sizing:border-box}div{max-width:420px;text-align:center}b{color:#f5b942}button{margin-top:16px;padding:10px 18px;border-radius:10px;border:1px solid #2f6b52;background:#13241d;color:#e6ede9;font:inherit}</style></head>
<body><div><h1>🤖 Mr.RoBoT</h1><p><b>Tu PC no responde ahora.</b></p><p>El mando a distancia necesita que la app Mis Carteras esté abierta en tu ordenador, encendido y con internet.</p><button onclick="location.reload()">Reintentar</button></div></body></html>`;

async function manejar(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/salud') return enviar(res, 200, JSON.stringify({ ok: true, pc_conectado: conectado(), llave: !!PUB }));
  // ---- Canal de la app del PC ----
  if (url.pathname === '/tunel/esperar' && req.method === 'GET') {
    if (!esElPC(req)) return enviar(res, 401, '{"error":"no autorizado"}');
    ultimoPC = Date.now();
    if (recogedor) { clearTimeout(recogedor.tm); enviar(recogedor.res, 200, '[]'); }
    if (cola.length) return enviar(res, 200, JSON.stringify(cola.splice(0, 20)));
    recogedor = { res, tm: setTimeout(() => { if (recogedor && recogedor.res === res) { recogedor = null; enviar(res, 200, '[]'); } }, ESPERA_MS) };
    req.on('close', () => { if (recogedor && recogedor.res === res) { clearTimeout(recogedor.tm); recogedor = null; } });
    return;
  }
  if (url.pathname === '/tunel/responder' && req.method === 'POST') {
    if (!esElPC(req)) return enviar(res, 401, '{"error":"no autorizado"}');
    ultimoPC = Date.now();
    let r; try { r = JSON.parse((await leer(req, 12 * 1024 * 1024)).toString('utf8')); } catch { return enviar(res, 400, '{"error":"respuesta no válida"}'); }
    const p = pendientes.get(String(r.id)); if (p) { pendientes.delete(String(r.id)); clearTimeout(p.tm);
      const h = {}; for (const [k, v] of Object.entries(r.cabeceras || {})) if (/^(content-type|set-cookie|location)$/i.test(k)) h[k] = v;
      enviar(p.res, +r.estado || 200, Buffer.from(String(r.cuerpo || ''), r.base64 ? 'base64' : 'utf8'), h['content-type'] || h['Content-Type'] || 'text/plain; charset=utf-8', h); }
    return enviar(res, 200, '{"ok":true}');
  }
  // ---- Navegadores: todo pasa a la app del PC ----
  if (!limite(req)) return enviar(res, 429, '{"__err":"Demasiadas peticiones: espera un minuto"}');
  if (!['GET', 'POST'].includes(req.method)) return enviar(res, 405, '{"__err":"Método no permitido"}');
  if (req.method === 'POST') { const o = req.headers.origin; if (o && o !== 'https://' + req.headers.host) return enviar(res, 403, '{"__err":"Origen no permitido"}'); }
  if (!conectado()) return req.method === 'GET' && !url.pathname.startsWith('/api/') ? enviar(res, 503, PAGINA_FUERA, 'text/html; charset=utf-8') : enviar(res, 503, '{"__err":"Tu PC no responde: abre Mis Carteras"}');
  if (cola.length >= MAX_COLA) return enviar(res, 503, '{"__err":"Ocupado, reintenta"}');
  let cuerpo = ''; try { cuerpo = req.method === 'POST' ? (await leer(req, url.pathname === '/subir' ? 32 * 1024 * 1024 : MAX_CUERPO)).toString('utf8') : ''; } catch (e) { return enviar(res, e.cod || 400, '{"__err":"Petición no válida"}'); }
  const id = crypto.randomBytes(12).toString('hex');
  const tm = setTimeout(() => { if (pendientes.delete(id)) enviar(res, 504, '{"__err":"Tu PC ha tardado demasiado en responder"}'); }, RESP_MS);
  pendientes.set(id, { res, tm });
  req.on('close', () => { if (!res.writableEnded && pendientes.has(id)) { clearTimeout(tm); pendientes.delete(id); } });
  cola.push({ id, metodo: req.method, ruta: url.pathname + url.search, cookie: String(req.headers.cookie || '').slice(0, 4000), tipo: String(req.headers['content-type'] || ''), agente: String(req.headers['user-agent'] || '').slice(0, 160), pin: String(req.headers['x-mr-pin'] || '').replace(/\D/g, '').slice(0, 12), cuerpo });
  entregar();
}

http.createServer((q, r) => manejar(q, r).catch(e => { console.error('relevo', e.message); enviar(r, 500, '{"__err":"error interno"}'); }))
  .listen(PUERTO, () => console.log(`Relevo de Mr.RoBoT en el puerto ${PUERTO} · llave pública ${PUB ? 'cargada' : 'SIN CONFIGURAR'}`));
