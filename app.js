// ===== Panel del sensor ESP32 =====
// Pregunta al ESP32 (http://IP:8080/api) varias veces por segundo.
const $ = (id) => document.getElementById(id);
const TZ_OFFSET_S = -5 * 3600;          // Colombia UTC-5
const POLL_MS = 150;                    // frecuencia de consulta
const DIAS = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];

let demo = false, baseUrl = "", timer = null, lastCount = null, lastDetect = 0, fails = 0, soundOn = false;
let shownEventId = 0;

// ---------- utilidades ----------
function bin(n, bits) {
  let s = (n >>> 0).toString(2).padStart(bits, "0").slice(-bits);
  if (bits > 4 && bits % 4 === 0) s = s.replace(/(.{4})(?=.)/g, "$1 ");
  return s;
}
const p2 = (n) => String(n).padStart(2, "0");
function partes(epoch) {
  const d = new Date((epoch + TZ_OFFSET_S) * 1000);
  return { h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds(),
           d: d.getUTCDate(), mo: d.getUTCMonth() + 1, y: d.getUTCFullYear(), w: d.getUTCDay() };
}
function set(id, v) { $(id).textContent = v; }
function setStatus(kind, text) {
  $("dot").className = "dot " + kind;
  set("statusText", text);
}
function beep() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = 880; g.gain.value = 0.1;
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + 0.15);
  } catch (e) {}
}

// ---------- pintar datos ----------
function render(data) {
  const detect = data.detect ? 1 : 0;
  const card = $("stateCard");
  card.className = "card state " + (detect ? "alert" : "free");
  set("stateText", detect ? "¡DETECTADO!" : "LIBRE");
  set("stateBit", String(detect));

  const ok = data.epoch > 1600000000;
  if (ok) {
    const t = partes(data.epoch);
    set("hDec", p2(t.h)); set("hBin", bin(t.h, 5));
    set("mDec", p2(t.m)); set("mBin", bin(t.m, 6));
    set("sDec", p2(t.s)); set("sBin", bin(t.s, 6));
    set("dDec", p2(t.d)); set("dBin", bin(t.d, 5));
    set("moDec", p2(t.mo)); set("moBin", bin(t.mo, 4));
    set("yDec", t.y); set("yBin", bin(t.y, 12));
    set("wDec", DIAS[t.w]); set("wBin", bin(t.w, 3));
    set("eDec", data.epoch); set("eBin", bin(data.epoch, 32));
  } else {
    ["hDec","mDec","sDec","dDec","moDec","yDec","wDec","eDec"].forEach((i) => set(i, "sin hora"));
  }
  set("cDec", data.count); set("cBin", bin(data.count, 16));
  set("rDec", data.rssi + " dBm"); set("rBin", bin(Math.abs(data.rssi), 8));
  set("uDec", data.uptime); set("uBin", bin(data.uptime, 32));
  set("net", data.ssid || "--");
  set("ipShow", data.ip || "--");

  // detección nueva (por contador, así no se pierde una pasada rápida)
  if (lastCount !== null && data.count > lastCount) {
    if (soundOn) beep();
  }
  lastCount = data.count;
  renderEvents(data.events || []);
}

function renderEvents(list) {
  if (!list.length) return;
  const tb = $("events");
  const newest = list[list.length - 1].n;
  if (newest === shownEventId) return;
  const prev = shownEventId;
  shownEventId = newest;
  tb.innerHTML = "";
  list.slice().reverse().forEach((e) => {
    const tr = document.createElement("tr");
    if (e.n > prev && prev !== 0) tr.className = "new";
    let hora = "sin hora", fecha = "-", b = "-";
    if (e.epoch > 1600000000) {
      const t = partes(e.epoch);
      hora = p2(t.h) + ":" + p2(t.m) + ":" + p2(t.s);
      fecha = p2(t.d) + "/" + p2(t.mo) + "/" + t.y;
      b = bin(t.h, 5) + " : " + bin(t.m, 6) + " : " + bin(t.s, 6);
    }
    [e.n, hora, fecha, b].forEach((v, i) => {
      const td = document.createElement("td");
      td.textContent = v;
      if (i === 3) td.className = "b";
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
}

// ---------- obtener datos ----------
async function getReal() {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 1500);
  try {
    const r = await fetch(baseUrl + "/api", { signal: ctl.signal, cache: "no-store" });
    return await r.json();
  } finally { clearTimeout(to); }
}

const demoS = { count: 0, detect: 0, next: Date.now() + 2000, until: 0, events: [], start: Date.now() };
function getDemo() {
  const now = Date.now(), ep = Math.floor(now / 1000);
  if (now > demoS.next) {
    demoS.count++; demoS.detect = 1; demoS.until = now + 900;
    demoS.next = now + 3000 + Math.random() * 3000;
    demoS.events.push({ n: demoS.count, epoch: ep });
    if (demoS.events.length > 20) demoS.events.shift();
  }
  if (now > demoS.until) demoS.detect = 0;
  return { detect: demoS.detect, count: demoS.count, epoch: ep,
           uptime: Math.floor((now - demoS.start) / 1000), rssi: -55 - Math.floor(Math.random() * 6),
           ssid: "Red de prueba (demo)", ip: "demo", events: demoS.events };
}

async function tick() {
  try {
    const data = demo ? getDemo() : await getReal();
    fails = 0;
    setStatus(demo ? "demo" : "on", demo ? "Modo demo" : "Conectado a " + baseUrl);
    render(data);
  } catch (e) {
    fails++;
    if (fails >= 3) setStatus("off", "Sin conexión, reintentando…");
  }
  timer = setTimeout(tick, POLL_MS);
}

function start() {
  clearTimeout(timer);
  lastCount = null; shownEventId = 0; fails = 0;
  tick();
}

// ---------- botones ----------
function normalizarIp(v) {
  v = v.trim();
  if (!v) return "";
  if (!/^https?:\/\//.test(v)) v = "http://" + v;
  if (!/:\d+$/.test(v)) v += ":8080";
  return v;
}
$("btnConnect").onclick = () => {
  const v = normalizarIp($("ipInput").value);
  if (!v) { setStatus("off", "Escribe la IP del ESP32"); return; }
  try { localStorage.setItem("esp32ip", $("ipInput").value.trim()); } catch (e) {}
  demo = false; baseUrl = v; $("btnDemo").textContent = "Modo demo";
  start();
};
$("btnDemo").onclick = () => {
  demo = !demo;
  $("btnDemo").textContent = demo ? "Salir del demo" : "Modo demo";
  if (!demo) { clearTimeout(timer); setStatus("off", "Desconectado"); return; }
  start();
};
$("btnSound").onclick = () => {
  soundOn = !soundOn;
  $("btnSound").textContent = soundOn ? "🔊 Sonido" : "🔇 Sonido";
  if (soundOn) beep();
};

// texto fijo en binario ASCII
set("asciiBin", "MOVIMIENTO".split("").map((c) => c.charCodeAt(0).toString(2).padStart(8, "0")).join(" "));

// recordar la última IP
try {
  const saved = localStorage.getItem("esp32ip");
  if (saved) $("ipInput").value = saved;
} catch (e) {}
