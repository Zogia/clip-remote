'use strict';
// Clip Remote: controls the hair clip over Bluetooth (the same "Nordic UART" text commands as Serial Bluetooth Terminal).

const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';   // phone -> clip
const TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';   // clip -> phone

const FONTS = ['pixel', 'normal', 'sans', 'serif', 'mono'];
const MODES = { scroll: 'Scroll', bounce: 'Bounce', still: 'Still', jelly: 'Jelly', jellybounce: 'Jelly bounce' };
const EFFECTS = { solid: 'Solid', rainbow: 'Rainbow', flash: 'Flash', wave: 'Wave', party: 'Party', dvd: 'DVD' };
const SWATCHES = ['FFFFFF', '000000', 'FF0000', 'FF8000', 'FFFF00', '00FF00', '00FFFF', '0000FF', '9B30FF', 'FF00FF', 'FF69B4'];

// What the clip is showing (filled in from its ".state" reply; these are the clip's defaults until then)
const state = {
  fg: 'FFFFFF', bg: '000000', font: 'normal', size: 2, maxsize: 2, speed: 3, mode: 'scroll', fx: 'solid',
  hold: 5, bright: 10, paused: false, icon: true, flip: false, wifi: true, bat: -1,
  msgs: ['HELLO WORLD', 'nice to meet you', 'have a great day'],
};

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ Bluetooth
let device = null, rxChar = null, txChar = null;
let writeChain = Promise.resolve();
let rxBuffer = '';
const decoder = new TextDecoder();
let wantConnected = false;

async function connect() {
  if (!navigator.bluetooth) {
    toast('No Bluetooth in this browser. Open this page in Chrome on Android.');
    return;
  }
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ name: 'Hairclip' }, { namePrefix: 'Air' }],   // ("Air..." for older firmware and the air mouse page)
      optionalServices: [NUS],
    });
    device.addEventListener('gattserverdisconnected', onDisconnected);
    wantConnected = true;
    await openLink();
  } catch (e) {
    if (e.name !== 'NotFoundError') toast('Could not connect: ' + e.message);   // (NotFoundError = chooser cancelled)
    setStatus(rxChar ? 'on' : 'off');
  }
}

async function openLink() {
  setStatus('connecting');
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(NUS);
  rxChar = await service.getCharacteristic(RX);
  txChar = await service.getCharacteristic(TX);
  txChar.addEventListener('characteristicvaluechanged', onNotify);
  await txChar.startNotifications();
  rxBuffer = '';
  setStatus('on');
  send('.state');
}

function disconnect() {
  wantConnected = false;
  if (device && device.gatt.connected) device.gatt.disconnect();
}

function onDisconnected() {
  rxChar = txChar = null;
  setStatus('off');
  if (wantConnected) reconnect(1);
}

// the clip can drop out for a moment (out of range, restarting): try again a few times without asking
function reconnect(attempt) {
  if (!wantConnected || !device || attempt > 5) return;
  setTimeout(async () => {
    if (!wantConnected || rxChar) return;
    try { await openLink(); } catch (e) { setStatus('off'); reconnect(attempt + 1); }
  }, 1500 * attempt);
}

// Send one line. Bluetooth takes 20 bytes at a time, one after another.
function send(line) {
  if (!rxChar) {
    toast('Not connected to the clip');
    return false;
  }
  const data = new TextEncoder().encode(line + '\n');
  const ch = rxChar;
  writeChain = writeChain.then(async () => {
    for (let i = 0; i < data.length; i += 20) {
      const part = data.slice(i, i + 20);
      if (ch.writeValueWithResponse) await ch.writeValueWithResponse(part);
      else await ch.writeValue(part);
    }
  }).catch((e) => console.warn('send failed', e));
  log('> ' + line);
  return true;
}

function onNotify(event) {
  rxBuffer += decoder.decode(event.target.value, { stream: true });
  let nl;
  while ((nl = rxBuffer.indexOf('\n')) >= 0) {
    const line = rxBuffer.slice(0, nl).trim();
    rxBuffer = rxBuffer.slice(nl + 1);
    if (line) onLine(line);
  }
  if (rxBuffer.length > 3000) rxBuffer = '';
}

function onLine(line) {
  if (line.startsWith('state ')) {
    parseState(line);
    return;
  }
  log('< ' + line);
  if (line.startsWith('battery ')) $('batteryInfo').textContent = line;
  else if (line.startsWith('unknown command')) toast('The clip needs a firmware update for this button');
}

// "state v=1 fg=FFFFFF ... msgs=one|two"  (msgs is last because it may contain spaces)
function parseState(line) {
  const cut = line.indexOf(' msgs=');
  const head = cut >= 0 ? line.slice(6, cut) : line.slice(6);
  for (const pair of head.split(' ')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const k = pair.slice(0, eq), v = pair.slice(eq + 1);
    switch (k) {
      case 'fg': case 'bg': state[k] = v.toUpperCase(); break;
      case 'font': case 'mode': case 'fx': state[k] = v; break;
      case 'size': case 'maxsize': case 'speed': case 'hold': case 'bright': case 'bat': state[k] = parseInt(v, 10); break;
      case 'paused': case 'icon': case 'flip': case 'wifi': state[k] = v === '1'; break;
    }
  }
  if (cut >= 0) {
    const msgs = line.slice(cut + 6).split('|').map((s) => s.trim()).filter(Boolean);
    if (msgs.length) state.msgs = msgs;
  }
  renderControls();
  restartPreview();
}

// some changes are adjusted by the clip (a font brings its own size, sizes are limited): ask it how things ended up
let resyncTimer = null;
function resyncSoon() {
  clearTimeout(resyncTimer);
  resyncTimer = setTimeout(() => { if (rxChar) send('.state'); }, 700);
}

// ------------------------------------------------------------------ the page
function setStatus(s) {
  const btn = $('connectBtn');
  document.body.dataset.link = s;
  if (s === 'on') { $('status').textContent = 'Connected'; btn.textContent = 'Disconnect'; }
  else if (s === 'connecting') { $('status').textContent = 'Connecting...'; btn.textContent = 'Cancel'; }
  else { $('status').textContent = 'Not connected'; btn.textContent = 'Connect'; }
}

let toastTimer = null;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function log(line) {
  const box = $('log');
  box.textContent = (box.textContent + line + '\n').split('\n').slice(-60).join('\n');
  box.scrollTop = box.scrollHeight;
}

function buttonRow(container, items, onPick) {
  container.innerHTML = '';
  for (const [value, label] of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset.value = value;
    b.addEventListener('click', () => onPick(value));
    container.appendChild(b);
  }
}

function markSelected(container, value) {
  for (const b of container.children) b.classList.toggle('selected', b.dataset.value === value);
}

function swatches(container, onPick) {
  for (const hex of SWATCHES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = '#' + hex;
    b.title = '#' + hex;
    b.addEventListener('click', () => onPick(hex));
    container.appendChild(b);
  }
}

// messages are sent as one line: "one|two|three". A first message starting with a dot would look like a command, so
// it then gets a "|" in front (the clip ignores empty messages).
function sendMessages() {
  const list = state.msgs.map((m) => m.replace(/\|/g, '/').trim()).filter(Boolean);
  if (!list.length) return;
  state.msgs = list;
  let line = list.join('|');
  if (/^\.[A-Za-z]/.test(line)) line = '|' + line;
  send(line);
  restartPreview();
  renderMessages();
}

function renderMessages() {
  const ul = $('msgList');
  ul.innerHTML = '';
  state.msgs.forEach((text, i) => {
    const li = document.createElement('li');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = text;
    input.maxLength = 80;
    input.addEventListener('change', () => {
      const v = input.value.trim();
      if (v) state.msgs[i] = v; else state.msgs.splice(i, 1);
      sendMessages();
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon';
    del.textContent = '✕';
    del.title = 'Delete';
    del.disabled = state.msgs.length <= 1;
    del.addEventListener('click', () => {
      state.msgs.splice(i, 1);
      sendMessages();
    });
    li.append(input, del);
    ul.appendChild(li);
  });
  $('addBtn').disabled = state.msgs.length >= 10;
}

function renderControls() {
  $('fg').value = '#' + state.fg.toLowerCase();
  $('bg').value = '#' + state.bg.toLowerCase();
  markSelected($('fontRow'), state.font);
  markSelected($('modeRow'), state.mode);
  markSelected($('fxRow'), state.fx);
  const size = $('size');
  size.max = Math.max(1, state.maxsize);
  size.value = Math.min(state.size, state.maxsize);
  $('sizeVal').textContent = size.value + (state.maxsize <= 1 ? ' (this font only fits size 1)' : '');
  size.disabled = state.maxsize <= 1;
  $('speed').value = state.speed; $('speedVal').textContent = state.speed;
  $('hold').value = state.hold; $('holdVal').textContent = state.hold + ' s';
  $('bright').value = state.bright; $('brightVal').textContent = state.bright + ' of 10';
  $('pauseBtn').textContent = state.paused ? '▶ Play' : '❚❚ Pause';
  $('wifiBtn').textContent = state.wifi ? 'Wi-Fi: on' : 'Wi-Fi: off';
  $('wifiBtn').classList.toggle('selected', state.wifi);
  $('iconBtn').textContent = state.icon ? 'Battery icon: on' : 'Battery icon: off';
  $('iconBtn').classList.toggle('selected', state.icon);
  $('flipBtn').classList.toggle('selected', state.flip);
  $('battery').textContent = state.bat >= 0 ? state.bat + '%' : '';
  $('holdRow').hidden = state.mode === 'scroll';
  renderMessages();
}

function setupControls() {
  $('connectBtn').addEventListener('click', () => {
    if (document.body.dataset.link === 'off') connect(); else disconnect();
  });

  $('addBtn').addEventListener('click', () => {
    const input = $('newMsg');
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    state.msgs.push(v);
    input.value = '';
    sendMessages();
  });
  $('newMsg').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('addBtn').click(); });

  for (const which of ['fg', 'bg']) {
    const cmd = which === 'fg' ? '.color ' : '.bg ';
    const pick = (hex) => { state[which] = hex.toUpperCase(); renderControls(); send(cmd + state[which]); };
    $(which).addEventListener('input', (e) => { state[which] = e.target.value.slice(1).toUpperCase(); });   // live preview
    $(which).addEventListener('change', (e) => pick(e.target.value.slice(1)));
    swatches($(which + 'Sw'), pick);
  }

  buttonRow($('fontRow'), FONTS.map((f) => [f, f[0].toUpperCase() + f.slice(1)]), (f) => {
    state.font = f; renderControls(); restartPreview(); send('.font ' + f); resyncSoon();
  });
  buttonRow($('modeRow'), Object.entries(MODES), (m) => {
    state.mode = m; renderControls(); restartPreview(); send('.mode ' + m);
  });
  buttonRow($('fxRow'), Object.entries(EFFECTS), (f) => {
    state.fx = f; renderControls(); send('.fx ' + f);
  });

  const slider = (id, key, label, onSend) => {
    $(id).addEventListener('input', (e) => { state[key] = +e.target.value; $(id + 'Val').textContent = label(state[key]); });
    $(id).addEventListener('change', (e) => { state[key] = +e.target.value; onSend(state[key]); });
  };
  slider('size', 'size', (v) => v, (v) => { restartPreview(); send('.size ' + v); resyncSoon(); });
  slider('speed', 'speed', (v) => v, (v) => send('.speed ' + v));
  slider('hold', 'hold', (v) => v + ' s', (v) => send('.hold ' + v));
  slider('bright', 'bright', (v) => v + ' of 10', (v) => send('.brightness ' + v));

  $('pauseBtn').addEventListener('click', () => {
    state.paused = !state.paused; renderControls(); send(state.paused ? '.pause' : '.play');
  });
  $('shakeBtn').addEventListener('click', () => { send('.shake'); shakePreview(); });
  $('resetBtn').addEventListener('click', () => {
    if (confirm('Put color, font, size, speed, mode and effect back to the defaults? (Your messages stay.)')) {
      send('.reset'); resyncSoon();
    }
  });
  for (const n of [1, 2]) {
    $('load' + n).addEventListener('click', () => { send('.load' + n); resyncSoon(); });
    $('save' + n).addEventListener('click', () => {
      if (confirm('Save the current messages and look into preset ' + n + '? (This replaces what is in it.)')) send('.save' + n);
    });
  }

  $('flipBtn').addEventListener('click', () => { state.flip = !state.flip; renderControls(); send('.flip'); });
  $('wifiBtn').addEventListener('click', () => {
    state.wifi = !state.wifi; renderControls(); send(state.wifi ? '.wifi on' : '.wifi off');
  });
  $('iconBtn').addEventListener('click', () => {
    state.icon = !state.icon; renderControls(); send(state.icon ? '.battery on' : '.battery off');
  });
  $('batteryBtn').addEventListener('click', () => send('.battery'));
  $('btOffBtn').addEventListener('click', () => {
    if (confirm('Switch the clip\'s Bluetooth off? The phone loses the connection. To switch it back on, use the ' +
                'Bluetooth button in the clip\'s Settings, or MORE > BT in the text app.')) {
      wantConnected = false;
      send('.bt off');
    }
  });

  $('cmdForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('cmd').value.trim();
    if (v && send(v)) $('cmd').value = '';
  });
}

// ------------------------------------------------------------------ the preview (an approximation of the clip's screen)
const W = 284, H = 76;
const canvas = $('preview');
const ctx = canvas.getContext('2d');
const P = { index: 0, x: W, y: H / 2, dx: 1, dy: 1, age: 0, t: 0, hue: 0, dvdHit: false, dvdBase: '', last: 0, letters: [] };

// The clip's "pixel" font is the display library's classic 5x7 dot font (TFT_eSPI glcdfont.c), copied here so the
// preview draws exactly the same dots: characters 32 to 126, 5 columns each, lowest bit = top row, 6 dots apart.
const GLCD = '000000000000005f00000007000700147f147f14242a7f2a12231308646236495620500008070300001c2241000041221c002a1c7f1c2a08083e080800807030000808080808000060600020100804023e5149453e00427f400072494949462141494d331814127f1027454545393c4a49493141211109073649494936464949291e0000140000004034000000081422411414141414004122140802015909063e415d594e7c1211127c7f494949363e414141227f4141413e7f494949417f090909013e414151737f0808087f00417f41002040413f017f081422417f404040407f021c027f7f0408107f3e4141413e7f090909063e4151215e7f09192946264949493203017f01033f4040403f1f2040201f3f4038403f631408146303047804036159494d43007f4141410204081020004141417f04020102044040404040000307080020545478407f284444383844444428384444287f385454541800087e090218a4a49c787f0804047800447d40002040403d007f1028440000417f40007c047804787c080404783844444438fc1824241818242418fc7c08040408485454542404043f44243c4040207c1c2040201c3c4030403c44281028444c9090907c4464544c440008364100000077000000413608000201020402';

function isPixel() { return state.font === 'pixel'; }

function textW(str) {                        // how wide a piece of text is in the current font
  return isPixel() ? str.length * 6 * state.size : ctx.measureText(str).width;
}

// draw text with its left edge at x and its middle at y, in the current fill color
function drawStr(str, x, y) {
  if (!isPixel()) { ctx.fillText(str, x, y); return; }
  const s = state.size, top = Math.round(y - 4 * s);
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 32 || code > 126) code = 63;   // ('?' for anything the font doesn't have)
    const at = (code - 32) * 10;
    const cx = Math.round(x) + i * 6 * s;
    for (let col = 0; col < 5; col++) {
      const bits = parseInt(GLCD.substr(at + col * 2, 2), 16);
      for (let row = 0; row < 8; row++) if (bits & (1 << row)) ctx.fillRect(cx + col * s, top + row * s, s, s);
    }
  }
}

function fontCss() {
  const s = state.size;
  switch (state.font) {
    case 'pixel': return { css: `${8 * s}px monospace`, h: 8 * s };   // (drawn dot by dot: see drawStr)
    case 'sans': return { css: `bold ${Math.round(40 * s)}px Arial, Helvetica, sans-serif`, h: 40 * s };
    case 'serif': return { css: `bold ${Math.round(40 * s)}px Georgia, "Times New Roman", serif`, h: 40 * s };
    case 'mono': return { css: `bold ${Math.round(38 * s)}px "Courier New", monospace`, h: 38 * s };
    default: return { css: `${Math.round(24 * s)}px Arial, Helvetica, sans-serif`, h: 19 * s };
  }
}

function currentText() {
  return state.msgs[P.index % state.msgs.length] || '';
}

function restartPreview() {
  if (P.index >= state.msgs.length) P.index = 0;
  P.age = 0;
  P.x = W;
  P.y = H / 2;
  P.dx = Math.random() < 0.5 ? 1 : -1;
  P.dy = Math.random() < 0.5 ? 1 : -1;
  P.letters = [];
  if (state.mode !== 'bounce') P.dvdHit = false;
  if (state.mode === 'bounce') {
    ctx.font = fontCss().css;
    const w = textW(currentText());
    P.x = Math.random() * Math.max(0, W - w);
  }
}

function nextMessage() {
  P.index = (P.index + 1) % state.msgs.length;
  restartPreview();
}

function shakePreview() {
  for (const l of P.letters) { l.vx += (Math.random() - 0.5) * 600; l.vy += (Math.random() - 0.5) * 600; }
}

function colorFor(i) {
  switch (state.fx) {
    case 'rainbow': case 'party': return `hsl(${(P.t / 6 + i * 28) % 360}, 100%, 50%)`;
    case 'flash': return `hsl(${(Math.floor(P.t / 250) * 67) % 360}, 100%, 50%)`;
    case 'dvd':                                     // the chosen color until the text bumps an edge (as on the clip)
      if (state.fg !== P.dvdBase) { P.dvdBase = state.fg; P.dvdHit = false; }
      return P.dvdHit ? `hsl(${P.hue}, 100%, 50%)` : '#' + state.fg;
    default: return '#' + state.fg;
  }
}

function drawBattery() {
  if (!state.icon || state.bat < 0) return;
  const x = W - 42, y = 2, w = 36, h = 13;
  ctx.fillStyle = '#000'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = '#fff'; ctx.fillRect(x + w, y + 4, 2, h - 8);
  const pct = Math.max(0, Math.min(100, state.bat));
  ctx.fillStyle = `hsl(${pct * 1.2}, 100%, 45%)`;
  ctx.fillRect(x + 2, y + 2, (w - 4) * pct / 100, h - 4);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 9px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(pct + '%', x + w / 2, y + h / 2 + 1);
  ctx.textAlign = 'left';
}

function frame(now) {
  const dt = Math.min(100, now - (P.last || now));
  P.last = now;
  const text = currentText();
  const f = fontCss();
  ctx.fillStyle = '#' + state.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.font = f.css;
  ctx.textBaseline = 'middle';
  const w = textW(text);
  const still = state.mode === 'still' && w <= W;
  const scroll = state.mode === 'scroll' || (state.mode === 'still' && !still);
  const jelly = state.mode === 'jelly' || state.mode === 'jellybounce';

  if (!state.paused) {
    P.t += dt;
    P.age += dt;
    const step = (px) => px * dt / 20;              // the clip's speed setting: pixels per 20 ms
    if (scroll) {
      P.x -= step(state.speed);
      if (P.x < -(w + 60)) nextMessage();
    } else if (state.mode === 'bounce') {
      const xMin = Math.min(0, W - w), xMax = Math.max(0, W - w);
      const yMin = f.h * 0.4, yMax = H - f.h * 0.4;
      let hit = false;
      P.x += P.dx * step(Math.max(1, Math.floor(state.speed / 2)));
      if (P.x <= xMin) { P.x = xMin; P.dx = 1; hit = true; }
      if (P.x >= xMax) { P.x = xMax; P.dx = -1; hit = true; }
      if (yMax > yMin) {
        P.y += P.dy * step(Math.max(1, Math.floor(state.speed / 3)));
        if (P.y <= yMin) { P.y = yMin; P.dy = 1; hit = true; }
        if (P.y >= yMax) { P.y = yMax; P.dy = -1; hit = true; }
      } else {
        P.y = H / 2;
      }
      if (hit) { P.hue = (P.hue + 60 + Math.random() * 240) % 360; P.dvdHit = true; }
    }
    if (!scroll && state.msgs.length > 1 && P.age >= state.hold * 1000) nextMessage();
  }

  if (jelly) {
    drawJelly(text, w, dt);
  } else {
    const x0 = still ? (W - w) / 2 : P.x;
    const y0 = state.mode === 'bounce' ? P.y : H / 2;
    const perLetter = ['rainbow', 'wave', 'party'].includes(state.fx);
    if (!perLetter) {
      ctx.fillStyle = colorFor(0);
      drawStr(text, x0, y0);
    } else {
      const amp = (state.fx === 'wave' || state.fx === 'party') ? Math.max(0, Math.min(10, (H - f.h) / 2 - 1)) : 0;
      for (let i = 0; i < text.length; i++) {
        const x = x0 + textW(text.slice(0, i));
        if (x > W || x < -60) continue;
        ctx.fillStyle = colorFor(i);
        drawStr(text[i], x, y0 + Math.sin(P.t / 140 + i * 0.7) * amp);
      }
    }
  }
  drawBattery();
  requestAnimationFrame(frame);
}

// jelly: the letters as wobbly balls (only a rough idea of the clip's physics)
function drawJelly(text, w, dt) {
  const bouncy = state.mode === 'jellybounce';
  if (P.letters.length === 0 && text.length) {
    const fit = w > W - 8 ? (W - 8) / w : 1;
    let x = (W - w * fit) / 2;
    for (let i = 0; i < text.length; i++) {
      const cw = textW(text[i]);
      if (text[i] !== ' ') {
        const speed = 40 + state.speed * 25;
        const a = Math.random() * Math.PI * 2;
        P.letters.push({ ch: text[i], hx: x + cw * fit / 2, x: x + cw * fit / 2, y: H / 2, r: Math.max(7, cw * fit / 2),
          vx: bouncy ? Math.cos(a) * speed : 0, vy: bouncy ? Math.sin(a) * speed : 0, i });
      }
      x += cw * fit;
    }
  }
  const s = dt / 1000;
  for (const l of P.letters) {
    if (!state.paused) {
      if (bouncy) {
        l.x += l.vx * s; l.y += l.vy * s;
        if (l.x < l.r || l.x > W - l.r) { l.vx = -l.vx; l.x = Math.max(l.r, Math.min(W - l.r, l.x)); if (state.fx === 'dvd') l.hue = Math.random() * 360; }
        if (l.y < l.r || l.y > H - l.r) { l.vy = -l.vy; l.y = Math.max(l.r, Math.min(H - l.r, l.y)); if (state.fx === 'dvd') l.hue = Math.random() * 360; }
      } else {
        l.vx += ((l.hx - l.x) * 6 - l.vx * 2) * s;
        l.vy += (700 - l.vy * 2) * s;
        l.x += l.vx * s; l.y += l.vy * s;
        if (l.y > H - l.r) { l.y = H - l.r; l.vy *= -0.4; }
      }
    }
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(Math.sin(P.t / 400 + l.i * 1.3) * 0.15);
    ctx.fillStyle = (state.fx === 'dvd' && l.hue !== undefined) ? `hsl(${l.hue},100%,50%)` : colorFor(l.i);
    if (isPixel()) {
      drawStr(l.ch, -textW(l.ch) / 2, 0);
    } else {
      ctx.textAlign = 'center';
      ctx.fillText(l.ch, 0, 0);
    }
    ctx.restore();
  }
  ctx.textAlign = 'left';
}

// ------------------------------------------------------------------ start
setupControls();
renderControls();
restartPreview();
setStatus('off');
requestAnimationFrame(frame);
if (!navigator.bluetooth) $('noBt').hidden = false;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});   // works offline after the first visit
