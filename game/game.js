"use strict";
/*
 * FERROFRENZY — Polarity Arena (v2)
 * An original canvas arcade game. You are FERRO, a magnet core.
 *
 *   - Flip your polarity with SPACE / click: NORTH (cyan) or SOUTH (coral).
 *   - OPPOSITE shards are pulled in. Touch one softly and you CAPTURE it:
 *     points, combo and pulse energy.
 *   - SAME polarity shards are pushed away. Slam one into a wall fast
 *     enough and it SHATTERS for points.
 *   - A same-polarity shard that still touches you OVERLOADS the core:
 *     you lose hull. Flip in time.
 *   - FERAL MINES (gold, spiky) ignore magnetism and crawl at you.
 *     Destroy them by smashing a repelled shard into them, or pulse.
 *   - TWINCORES (violet diamonds) split when destroyed: two fast mini
 *     shards of OPPOSITE polarities burst out. Be ready to flip.
 *   - Between waves you DEPLOY ANCHOR SATELLITES: fixed mini-magnets
 *     with a polarity you choose. They bend shard trajectories for the
 *     whole run — park one by a wall and its repelled shards shatter
 *     themselves; cluster them badly and they funnel chaos onto you.
 *   - Charge the PULSE with captures, fire it with E / right-click.
 *   - Clear wave 10 to stabilize the core and WIN. Hull 0 = core breach.
 */
(function () {
  var W = 960, H = 600, TOP = 44;
  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  var AU = window.FERRO_AUDIO;

  var COL = {
    bg: "#070b1a", grid: "rgba(90,130,220,0.07)",
    north: "#35e0ff", south: "#ff5470",
    mine: "#ffc94d", twin: "#c77dff", text: "#eaf4ff", dim: "#8fa8cc",
    good: "#5dff9d", bad: "#ff5470", energy: "#b78bff"
  };

  // ---------- rng (seedable for reproducible test runs) ----------
  var rnd = Math.random;
  if (typeof window.__FERRO_SEED === "number") {
    var _s = window.__FERRO_SEED >>> 0;
    rnd = function () {
      _s = (_s * 1664525 + 1013904223) >>> 0;
      return _s / 4294967296;
    };
  }

  // ---------- input ----------
  var keys = {};
  var mouse = { x: W / 2, y: H / 2, inside: false };
  window.addEventListener("keydown", function (e) {
    keys[e.code] = true;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(e.code) >= 0) e.preventDefault();
    onKey(e.code);
  });
  window.addEventListener("keyup", function (e) { keys[e.code] = false; });
  canvas.addEventListener("mousemove", function (e) {
    var r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) * (W / r.width);
    mouse.y = (e.clientY - r.top) * (H / r.height);
    mouse.inside = true;
  });
  canvas.addEventListener("mousedown", function (e) {
    AU.ensure();
    if (state.mode === "deploy") {
      if (e.button === 0) deployClick(mouse.x, mouse.y);
      else if (e.button === 2) deployGhost.north = !deployGhost.north;
      return;
    }
    if (e.button === 2) { firePulse(); return; }
    if (e.button === 0) handleClick(mouse.x, mouse.y);
  });
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  function onKey(code) {
    AU.ensure();
    if (code === "KeyM") { AU.setMuted(!AU.muted); return; }
    if (state.mode === "title" && (code === "Enter" || code === "Space")) { startRun(); return; }
    if ((state.mode === "over" || state.mode === "win") && code === "Enter") { startRun(); return; }
    if (state.mode === "deploy") {
      if (code === "Enter") confirmDeploy();
      if (code === "Space" || code === "KeyQ") deployGhost.north = !deployGhost.north;
      if (code === "KeyP" || code === "Escape") state.paused = !state.paused;
      return;
    }
    if (state.mode === "playing") {
      if (code === "Space") flipPolarity();
      if (code === "KeyE") firePulse();
      if (code === "KeyP" || code === "Escape") state.paused = !state.paused;
    }
  }

  function handleClick(x, y) {
    var i, b;
    for (i = 0; i < buttons.length; i++) {
      b = buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { b.fn(); return; }
    }
    if (state.mode === "title") { startRun(); return; }
    if (state.mode === "playing" && !state.paused) flipPolarity();
  }

  // ---------- state ----------
  var state;
  var buttons = [];
  var stars = [];
  (function makeStars() {
    for (var i = 0; i < 90; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.6 + 0.4, p: Math.random() * 6.28 });
  })();
  // iron filings: fixed home points that orient along the local field
  var filings = [];
  (function makeFilings() {
    for (var gy = TOP + 26; gy < H - 12; gy += 34) {
      for (var gx = 22; gx < W - 12; gx += 34) {
        filings.push({ x: gx + (Math.random() - 0.5) * 14, y: gy + (Math.random() - 0.5) * 14, a: 0, m: 0 });
      }
    }
  })();

  function bestScore() {
    try { return parseInt(localStorage.getItem("ferrofrenzy_best") || "0", 10) || 0; }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem("ferrofrenzy_best", String(v)); } catch (e) {}
  }

  function resetState() {
    state = {
      mode: "title", paused: false, t: 0,
      score: 0, best: bestScore(), wave: 0,
      shards: [], mines: [], parts: [], floats: [],
      anchors: [], anchorSlots: 0, pendingWave: 0, nextComp: null,
      spawnQueue: 0, twinQueue: 0, spawnTimer: 0, minesQueue: 0,
      waveBanner: 0, shake: 0,
      endless: false, timePlayed: 0,
      stats: { captures: 0, shatters: 0, mineSmashes: 0, overloads: 0, splits: 0 }
    };
  }
  resetState();

  var player = null;
  function resetPlayer() {
    player = {
      x: W / 2, y: H / 2, vx: 0, vy: 0, r: 16,
      north: true, hull: 5, maxHull: 5,
      combo: 0, comboTimer: 0, energy: 0,
      invuln: 0, flipAnim: 0, trail: []
    };
  }
  resetPlayer();

  function startRun() {
    resetState();
    resetPlayer();
    beginWave(1);
    AU.click();
    AU.startMusic();
  }

  function flipPolarity() {
    player.north = !player.north;
    player.flipAnim = 1;
    burst(player.x, player.y, player.north ? COL.north : COL.south, 10, 120);
    AU.flip(player.north);
  }

  // ---------- waves & deployment ----------
  function compFor(n) {
    var shards = Math.min(5 + n * 2, 26);
    var twins = n >= 3 ? Math.round(shards * 0.18) : 0;
    var mines = n >= 2 ? Math.min(Math.floor((n - 1) * 0.9), 6) : 0;
    return { shards: shards - twins, twins: twins, mines: mines };
  }
  function slotsFor(n) {
    if (n < 2) return 0;
    if (n <= 3) return 2;
    if (n <= 5) return 3;
    return 4;
  }

  function beginWave(n) {
    state.wave = n;
    var c = compFor(n);
    state.spawnQueue = c.shards;
    state.twinQueue = c.twins;
    state.minesQueue = c.mines;
    state.spawnTimer = 0.4;
    state.waveBanner = 2.0;
    state.mode = "playing";
    AU.wave();
  }

  function enterDeploy() {
    state.pendingWave = state.wave + 1;
    state.anchorSlots = slotsFor(state.pendingWave);
    state.nextComp = compFor(state.pendingWave);
    if (state.anchors.length > state.anchorSlots) state.anchors.length = state.anchorSlots;
    deployGhost.north = true;
    deployGhost.carrying = -1;
    state.mode = "deploy";
    AU.click();
  }

  function confirmDeploy() {
    if (state.mode !== "deploy") return;
    deployGhost.carrying = -1;
    beginWave(state.pendingWave);
  }

  // ghost / placement state for the deployment phase
  var deployGhost = { north: true, carrying: -1 }; // carrying: index of anchor being moved, -1 = placing new

  function anchorPosOK(x, y, skipIdx) {
    if (x < 44 || x > W - 44 || y < TOP + 46 || y > H - 44) return false;
    var dx = x - player.x, dy = y - player.y;
    if (dx * dx + dy * dy < 78 * 78) return false; // not on top of the core
    for (var i = 0; i < state.anchors.length; i++) {
      if (i === skipIdx) continue;
      var ax = x - state.anchors[i].x, ay = y - state.anchors[i].y;
      if (ax * ax + ay * ay < 64 * 64) return false;
    }
    return true;
  }

  function deployClick(x, y) {
    var i, b;
    for (i = 0; i < buttons.length; i++) {
      b = buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { b.fn(); return; }
    }
    // pick up an existing anchor?
    for (i = 0; i < state.anchors.length; i++) {
      var a = state.anchors[i];
      var dx = x - a.x, dy = y - a.y;
      if (dx * dx + dy * dy < 26 * 26) {
        if (deployGhost.carrying === i) { // click the carried anchor again: flip its polarity in place
          a.north = !a.north; deployGhost.north = a.north; AU.flip(a.north); return;
        }
        deployGhost.carrying = i;
        deployGhost.north = a.north;
        AU.click();
        return;
      }
    }
    if (deployGhost.carrying >= 0) {
      var ca = state.anchors[deployGhost.carrying];
      if (anchorPosOK(x, y, deployGhost.carrying)) {
        ca.x = x; ca.y = y; ca.north = deployGhost.north;
        deployGhost.carrying = -1;
        AU.place();
      }
      return;
    }
    if (state.anchors.length < state.anchorSlots && anchorPosOK(x, y, -1)) {
      state.anchors.push({ x: x, y: y, north: deployGhost.north, pulse: 1 });
      AU.place();
    }
  }

  function spawnInterval() { return Math.max(0.85 - state.wave * 0.045, 0.34); }

  function spawnShard(kind) {
    var side = Math.floor(rnd() * 4), x, y;
    if (side === 0) { x = rnd() * W; y = -20; }
    else if (side === 1) { x = rnd() * W; y = H + 20; }
    else if (side === 2) { x = -20; y = rnd() * H; }
    else { x = W + 20; y = rnd() * H; }
    var ang = Math.atan2(H / 2 - y, W / 2 - x) + (rnd() - 0.5) * 0.9;
    var sp = 55 + rnd() * 45 + state.wave * 3;
    state.shards.push({
      x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      r: kind === "twin" ? 17 : (kind === "mini" ? 8 : 11 + rnd() * 4),
      north: rnd() < 0.5, kind: kind || "norm",
      rot: rnd() * 6.28, vr: (rnd() - 0.5) * 2.4, trail: []
    });
  }

  function spawnMine() {
    var side = Math.floor(rnd() * 4), x, y;
    if (side === 0) { x = rnd() * W; y = -24; }
    else if (side === 1) { x = rnd() * W; y = H + 24; }
    else if (side === 2) { x = -24; y = rnd() * H; }
    else { x = W + 24; y = rnd() * H; }
    state.mines.push({ x: x, y: y, vx: 0, vy: 0, r: 15, rot: rnd() * 6.28 });
  }

  // a destroyed twincore bursts into two fast minis of opposite polarity
  function splitTwin(s) {
    state.stats.splits++;
    AU.split();
    burst(s.x, s.y, COL.twin, 18, 220);
    var a0 = rnd() * 6.283;
    for (var k = 0; k < 2; k++) {
      var a = a0 + k * Math.PI, sp = 230 + rnd() * 60;
      // spawn offset from the twin's centre, flying apart: a mini must not
      // be born inside the core's contact radius (instant capture/overload)
      state.shards.push({
        x: s.x + Math.cos(a) * 27, y: s.y + Math.sin(a) * 27,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: 8, north: k === 0, kind: "mini",
        rot: rnd() * 6.28, vr: (rnd() - 0.5) * 4, trail: []
      });
    }
  }

  // ---------- effects ----------
  function burst(x, y, color, n, speed) {
    for (var i = 0; i < n; i++) {
      var a = rnd() * 6.283, s = (0.3 + rnd() * 0.7) * speed;
      state.parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + rnd() * 0.4, max: 0.9, color: color, r: 1.5 + rnd() * 2.2 });
    }
  }
  function floater(x, y, text, color) {
    state.floats.push({ x: x, y: y, text: text, color: color, life: 1.0 });
  }
  function addScore(base, x, y, label) {
    var mult = 1 + Math.min(player.combo, 20) * 0.25;
    var pts = Math.round(base * mult);
    state.score += pts;
    floater(x, y - 14, (label || "+") + pts, COL.text);
  }

  // ---------- combat ----------
  function damagePlayer(srcX, srcY) {
    if (player.invuln > 0) return;
    player.hull--;
    player.invuln = 1.2;
    player.combo = 0; player.comboTimer = 0;
    state.stats.overloads++;
    state.shake = 10;
    burst(player.x, player.y, COL.bad, 26, 240);
    floater(player.x, player.y - 26, "OVERLOAD!", COL.bad);
    AU.damage();
    var a = Math.atan2(player.y - srcY, player.x - srcX);
    player.vx += Math.cos(a) * 260; player.vy += Math.sin(a) * 260;
    if (player.hull <= 0) gameOver();
  }

  function firePulse() {
    if (state.mode !== "playing" || state.paused || player.energy < 100) return;
    player.energy = 0;
    state.shake = 7;
    AU.pulse();
    var R = 270, i, d;
    burst(player.x, player.y, COL.energy, 40, 320);
    for (i = state.shards.length - 1; i >= 0; i--) {
      d = dist(player, state.shards[i]);
      if (d < R) {
        var s = state.shards[i];
        burst(s.x, s.y, COL.energy, 8, 160);
        state.shards.splice(i, 1);
        state.score += 25;
        if (s.kind === "twin") splitTwin(s);
      }
    }
    for (i = state.mines.length - 1; i >= 0; i--) {
      d = dist(player, state.mines[i]);
      if (d < R) { burst(state.mines[i].x, state.mines[i].y, COL.mine, 16, 220); state.mines.splice(i, 1); state.score += 50; AU.mineBoom(); }
    }
    floater(player.x, player.y - 34, "PULSE!", COL.energy);
  }

  function gameOver() {
    state.mode = "over";
    AU.stopMusic(); AU.lose();
    burst(player.x, player.y, COL.bad, 60, 300);
    if (state.score > state.best) { state.best = state.score; saveBest(state.best); }
  }
  function victory() {
    state.mode = "win";
    AU.stopMusic(); AU.win();
    if (state.score > state.best) { state.best = state.score; saveBest(state.best); }
  }
  function continueEndless() {
    state.endless = true;
    AU.startMusic();
    enterDeploy();
  }

  function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

  // ---------- magnetic field (visual: iron filings) ----------
  // Sum of the player core and every anchor, as a shard of the given
  // polarity would feel it. Filings orient along this vector.
  function fieldAt(x, y, north) {
    var fx = 0, fy = 0, i, dx, dy, d2, d, sgn, F;
    dx = player.x - x; dy = player.y - y; d2 = dx * dx + dy * dy; d = Math.sqrt(d2) || 1;
    sgn = (north !== player.north) ? 1 : -1;
    F = sgn * 62000 / Math.max(60, d) / d;
    fx += dx * F; fy += dy * F;
    for (i = 0; i < state.anchors.length; i++) {
      var a = state.anchors[i];
      dx = a.x - x; dy = a.y - y; d2 = dx * dx + dy * dy;
      if (d2 > 200 * 200 || d2 < 30 * 30) continue;
      d = Math.sqrt(d2) || 1;
      sgn = (north !== a.north) ? 1 : -1;
      F = sgn * 34000 / Math.max(50, d) / d;
      fx += dx * F; fy += dy * F;
    }
    return { x: fx, y: fy };
  }

  // anchor force on one shard: weaker than the core, hard radius,
  // dead zone inside 30px so shards slingshot through instead of parking.
  // Returns true while the shard is inside any anchor's field: field
  // exposure erodes a shard, so nothing can park in a field forever —
  // after ~4 s inside, the shard destabilizes and pops (twins split).
  function applyAnchors(s, dt) {
    var inField = false;
    for (var i = 0; i < state.anchors.length; i++) {
      var a = state.anchors[i];
      var dx = a.x - s.x, dy = a.y - s.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (d > 200) continue;
      inField = true;
      if (d < 30) continue;
      var F = 34000 / Math.max(50, d);
      var sgn = (s.north !== a.north) ? 1 : -1;
      s.vx += (dx / d) * F * dt * 3.2 * sgn;
      s.vy += (dy / d) * F * dt * 3.2 * sgn;
    }
    return inField;
  }

  // ---------- update ----------
  function update(dt) {
    state.t += dt;
    var i, j, s, m;
    for (i = state.parts.length - 1; i >= 0; i--) {
      var p = state.parts[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.life -= dt;
      if (p.life <= 0) state.parts.splice(i, 1);
    }
    for (i = state.floats.length - 1; i >= 0; i--) {
      state.floats[i].y -= 34 * dt; state.floats[i].life -= dt;
      if (state.floats[i].life <= 0) state.floats.splice(i, 1);
    }
    for (i = 0; i < state.anchors.length; i++) {
      if (state.anchors[i].pulse > 0) state.anchors[i].pulse = Math.max(0, state.anchors[i].pulse - dt * 2);
    }
    // filings follow the field of a NORTH test charge (pretty + informative)
    if (state.mode === "playing" || state.mode === "deploy") {
      for (i = 0; i < filings.length; i++) {
        var f = fieldAt(filings[i].x, filings[i].y, true);
        var fm = Math.sqrt(f.x * f.x + f.y * f.y);
        filings[i].m = fm;
        if (fm > 1) filings[i].a = Math.atan2(f.y, f.x);
      }
    }
    if (state.mode !== "playing" || state.paused) return;
    state.timePlayed += dt;
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 22);
    if (state.waveBanner > 0) state.waveBanner -= dt;
    if (player.invuln > 0) player.invuln -= dt;
    if (player.flipAnim > 0) player.flipAnim = Math.max(0, player.flipAnim - dt * 5);
    if (player.comboTimer > 0) { player.comboTimer -= dt; if (player.comboTimer <= 0) player.combo = 0; }

    // player movement
    var ax = 0, ay = 0, ACC = 1500;
    if (keys.KeyW || keys.ArrowUp) ay -= ACC;
    if (keys.KeyS || keys.ArrowDown) ay += ACC;
    if (keys.KeyA || keys.ArrowLeft) ax -= ACC;
    if (keys.KeyD || keys.ArrowRight) ax += ACC;
    player.vx += ax * dt; player.vy += ay * dt;
    player.vx *= Math.pow(0.0015, dt); player.vy *= Math.pow(0.0015, dt);
    var pv = Math.sqrt(player.vx * player.vx + player.vy * player.vy), MAXP = 330;
    if (pv > MAXP) { player.vx *= MAXP / pv; player.vy *= MAXP / pv; }
    player.x += player.vx * dt; player.y += player.vy * dt;
    player.x = Math.max(player.r, Math.min(W - player.r, player.x));
    player.y = Math.max(player.r + TOP, Math.min(H - player.r, player.y));
    player.trail.push({ x: player.x, y: player.y, life: 0.3 });
    if (player.trail.length > 22) player.trail.shift();
    for (i = player.trail.length - 1; i >= 0; i--) { player.trail[i].life -= dt; if (player.trail[i].life <= 0) player.trail.splice(i, 1); }

    // spawning
    if (state.spawnQueue > 0 || state.twinQueue > 0 || state.minesQueue > 0) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        var roll = rnd();
        if (state.minesQueue > 0 && (state.spawnQueue + state.twinQueue === 0 || roll < 0.22)) { spawnMine(); state.minesQueue--; }
        else if (state.twinQueue > 0 && (state.spawnQueue === 0 || roll < 0.45)) { spawnShard("twin"); state.twinQueue--; }
        else if (state.spawnQueue > 0) { spawnShard("norm"); state.spawnQueue--; }
        state.spawnTimer = spawnInterval();
      }
    } else if (state.shards.length === 0 && state.mines.length === 0) {
      // wave cleared
      if (state.wave >= 10 && !state.endless) { victory(); return; }
      if (player.hull < player.maxHull) player.hull++;
      floater(player.x, player.y - 40, "WAVE CLEAR  +1 HULL", COL.good);
      enterDeploy();
      return;
    }

    // shards: magnetic forces + motion
    for (i = state.shards.length - 1; i >= 0; i--) {
      s = state.shards[i];
      var dx = player.x - s.x, dy = player.y - s.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / d, uy = dy / d;
      var opposite = s.north !== player.north;
      var F = 62000 / Math.max(60, d);
      if (opposite) { s.vx += ux * F * dt * 3.2; s.vy += uy * F * dt * 3.2; }
      else { s.vx -= ux * F * dt * 3.2; s.vy -= uy * F * dt * 3.2; }
      var inField = applyAnchors(s, dt);
      s.fieldTime = inField ? (s.fieldTime || 0) + dt : 0;
      if (s.fieldTime > 4) {
        // destabilized by long field exposure: pops where it floats
        burst(s.x, s.y, COL.twin, 12, 180);
        addScore(25, s.x, s.y, "FIELD POP +");
        state.stats.shatters++;
        player.energy = Math.min(100, player.energy + 4);
        AU.shatter();
        state.shards.splice(i, 1);
        if (s.kind === "twin") splitTwin(s);
        continue;
      }
      if (opposite) {
        var toward = s.vx * ux + s.vy * uy;
        if (toward > 175) { s.vx -= ux * (toward - 175); s.vy -= uy * (toward - 175); }
      }
      var spd = Math.sqrt(s.vx * s.vx + s.vy * s.vy), MAXS = 430;
      if (spd > MAXS) { s.vx *= MAXS / spd; s.vy *= MAXS / spd; }
      s.x += s.vx * dt; s.y += s.vy * dt; s.rot += s.vr * dt;
      s.trail.push({ x: s.x, y: s.y, life: 0.22 });
      if (s.trail.length > 7) s.trail.shift();
      for (j = s.trail.length - 1; j >= 0; j--) { s.trail[j].life -= dt; if (s.trail[j].life <= 0) s.trail.splice(j, 1); }

      // wall shatter for fast shards
      if ((s.x < s.r || s.x > W - s.r || s.y < s.r + TOP || s.y > H - s.r) && spd > 255) {
        burst(s.x, s.y, s.north ? COL.north : COL.south, 12, 200);
        addScore(s.kind === "twin" ? 80 : (s.kind === "mini" ? 25 : 50), s.x, s.y, "SHATTER +");
        state.stats.shatters++;
        player.energy = Math.min(100, player.energy + 8);
        AU.shatter();
        state.shards.splice(i, 1);
        if (s.kind === "twin") splitTwin(s);
        continue;
      }
      s.x = Math.max(s.r, Math.min(W - s.r, s.x));
      s.y = Math.max(s.r + TOP, Math.min(H - s.r, s.y));

      // player contact
      if (d < player.r + s.r - 2) {
        if (opposite) {
          // CAPTURE
          player.combo++; player.comboTimer = 2.5;
          addScore(s.kind === "twin" ? 150 : (s.kind === "mini" ? 50 : 100), s.x, s.y, "CAPTURE +");
          state.stats.captures++;
          player.energy = Math.min(100, player.energy + 16);
          burst(s.x, s.y, s.north ? COL.north : COL.south, 14, 170);
          AU.capture(player.combo);
          state.shards.splice(i, 1);
          if (s.kind === "twin") splitTwin(s);
          continue;
        } else {
          burst(s.x, s.y, COL.bad, 12, 200);
          state.shards.splice(i, 1);
          if (s.kind === "twin") splitTwin(s);
          damagePlayer(s.x, s.y);
          continue;
        }
      }
    }

    // shard vs mine: a fast shard smashes a mine
    for (i = state.mines.length - 1; i >= 0; i--) {
      m = state.mines[i];
      for (j = state.shards.length - 1; j >= 0; j--) {
        s = state.shards[j];
        var sSpd = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
        if (dist(m, s) < m.r + s.r && sSpd > 170) {
          burst(m.x, m.y, COL.mine, 24, 260);
          burst(s.x, s.y, s.north ? COL.north : COL.south, 10, 180);
          addScore(250, m.x, m.y, "MINE SMASH +");
          state.stats.mineSmashes++;
          AU.mineBoom();
          state.mines.splice(i, 1);
          state.shards.splice(j, 1);
          if (s.kind === "twin") splitTwin(s);
          break;
        }
      }
    }

    // mines crawl at the player, ignoring magnetism (anchors included)
    for (i = state.mines.length - 1; i >= 0; i--) {
      m = state.mines[i];
      var mdx = player.x - m.x, mdy = player.y - m.y;
      var md = Math.sqrt(mdx * mdx + mdy * mdy) || 1;
      m.vx += (mdx / md) * 130 * dt; m.vy += (mdy / md) * 130 * dt;
      var msp = Math.sqrt(m.vx * m.vx + m.vy * m.vy), MAXM = 62 + state.wave * 2;
      if (msp > MAXM) { m.vx *= MAXM / msp; m.vy *= MAXM / msp; }
      m.x += m.vx * dt; m.y += m.vy * dt; m.rot += dt * 0.9;
      m.x = Math.max(m.r, Math.min(W - m.r, m.x));
      m.y = Math.max(m.r + TOP, Math.min(H - m.r, m.y));
      if (md < player.r + m.r - 2) {
        burst(m.x, m.y, COL.mine, 22, 240);
        AU.mineBoom();
        state.mines.splice(i, 1);
        damagePlayer(m.x, m.y);
      }
    }
  }

  // ---------- render ----------
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawButton(x, y, w, h, label, fn, accent) {
    buttons.push({ x: x, y: y, w: w, h: h, fn: fn });
    var hover = mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h;
    ctx.fillStyle = hover ? accent : "rgba(16,26,54,0.92)";
    rr(x, y, w, h, 10); ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 2; rr(x, y, w, h, 10); ctx.stroke();
    ctx.fillStyle = hover ? "#06121f" : COL.text;
    ctx.font = "bold 19px 'Segoe UI', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  }
  function text(str, x, y, font, color, align) {
    ctx.font = font; ctx.fillStyle = color;
    ctx.textAlign = align || "center"; ctx.textBaseline = "middle";
    ctx.fillText(str, x, y);
  }

  // nebula backdrop, pre-rendered once (static gradients are expensive per-frame)
  var nebula = null;
  (function makeNebula() {
    nebula = document.createElement("canvas");
    nebula.width = W; nebula.height = H;
    var nctx = nebula.getContext("2d");
    nctx.fillStyle = COL.bg; nctx.fillRect(0, 0, W, H);
    var blobs = [
      [190, 170, 300, "rgba(38,80,180,0.20)"], [790, 130, 260, "rgba(140,40,90,0.16)"],
      [520, 470, 340, "rgba(30,110,140,0.15)"], [120, 500, 220, "rgba(90,50,160,0.14)"],
      [860, 470, 240, "rgba(40,60,170,0.15)"]
    ];
    for (var i = 0; i < blobs.length; i++) {
      var b = blobs[i];
      var g = nctx.createRadialGradient(b[0], b[1], 10, b[0], b[1], b[2]);
      g.addColorStop(0, b[3]); g.addColorStop(1, "rgba(0,0,0,0)");
      nctx.fillStyle = g; nctx.fillRect(0, 0, W, H);
    }
  })();

  function drawBackground() {
    ctx.drawImage(nebula, 0, 0);
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = 0; x <= W; x += 48) { ctx.moveTo(x, TOP); ctx.lineTo(x, H); }
    for (var y = TOP; y <= H; y += 48) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      ctx.globalAlpha = 0.35 + 0.3 * Math.sin(state.t * 1.4 + st.p);
      ctx.fillStyle = "#bcd7ff";
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;
    // iron filings: tiny segments aligned with the live magnetic field
    if (state.mode === "playing" || state.mode === "deploy") {
      ctx.lineWidth = 1.4;
      for (var k = 0; k < filings.length; k++) {
        var fl = filings[k];
        var str = Math.min(1, fl.m / 900);
        if (str < 0.04) continue;
        ctx.globalAlpha = 0.05 + str * 0.22;
        ctx.strokeStyle = "#9fc2ff";
        var c = Math.cos(fl.a) * 6, sn = Math.sin(fl.a) * 6;
        ctx.beginPath();
        ctx.moveTo(fl.x - c, fl.y - sn);
        ctx.lineTo(fl.x + c, fl.y + sn);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawShard(s) {
    var c = s.north ? COL.north : COL.south;
    // a shard eroding in an anchor field flickers as it destabilizes
    if (s.fieldTime > 1.5 && Math.floor(state.t * 10) % 2 === 0) c = "#ffffff";
    // motion trail
    for (var ti = 0; ti < s.trail.length; ti++) {
      var tp = s.trail[ti];
      ctx.globalAlpha = Math.max(0, tp.life) * 0.5;
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(tp.x, tp.y, s.r * 0.4, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(s.x, s.y); ctx.rotate(s.rot);
    if (s.kind === "twin") {
      // TWINCORE: two fused triangles (a diamond) with a glowing seam
      ctx.shadowColor = COL.twin; ctx.shadowBlur = 18;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(0, -s.r); ctx.lineTo(s.r * 0.85, 0); ctx.lineTo(0, s.r); ctx.lineTo(-s.r * 0.85, 0); ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = COL.twin; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(-s.r * 0.85, 0); ctx.lineTo(s.r * 0.85, 0); ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, 6.283); ctx.fill();
      ctx.fillStyle = "#07101f";
      ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(s.north ? "−" : "+", 0, -s.r * 0.52);
      ctx.fillText(s.north ? "+" : "−", 0, s.r * 0.52);
    } else {
      ctx.shadowColor = c; ctx.shadowBlur = s.kind === "mini" ? 9 : 14;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(0, -s.r); ctx.lineTo(s.r * 0.8, s.r * 0.7); ctx.lineTo(-s.r * 0.8, s.r * 0.7); ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#07101f";
      ctx.font = "bold " + Math.round(s.r * 1.05) + "px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(s.north ? "−" : "+", 0, 1);
    }
    ctx.restore();
  }

  function drawMine(m) {
    ctx.save();
    ctx.translate(m.x, m.y); ctx.rotate(m.rot);
    ctx.shadowColor = COL.mine; ctx.shadowBlur = 12;
    ctx.strokeStyle = COL.mine; ctx.lineWidth = 3;
    ctx.beginPath();
    for (var i = 0; i < 8; i++) {
      var a = (i / 8) * 6.283;
      ctx.moveTo(Math.cos(a) * (m.r - 3), Math.sin(a) * (m.r - 3));
      ctx.lineTo(Math.cos(a) * (m.r + 6), Math.sin(a) * (m.r + 6));
    }
    ctx.stroke();
    ctx.fillStyle = "#3a2a05";
    ctx.beginPath(); ctx.arc(0, 0, m.r - 2, 0, 6.283); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = COL.mine;
    ctx.font = "bold 15px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("✸", 0, 1);
    ctx.restore();
  }

  function drawAnchor(a, ghost) {
    var c = a.north ? COL.north : COL.south;
    ctx.save();
    ctx.translate(a.x, a.y);
    // field ring: the reach its shards feel
    var fr = 200;
    ctx.strokeStyle = c;
    ctx.globalAlpha = ghost ? 0.35 : 0.13 + (a.pulse || 0) * 0.25;
    ctx.lineWidth = 1.5; ctx.setLineDash([4, 9]); ctx.lineDashOffset = state.t * 10;
    ctx.beginPath(); ctx.arc(0, 0, fr, 0, 6.283); ctx.stroke();
    ctx.setLineDash([]);
    // satellite body: a small diamond pylon
    ctx.globalAlpha = ghost ? 0.75 : 1;
    ctx.shadowColor = c; ctx.shadowBlur = ghost ? 6 : 13;
    ctx.fillStyle = "#0d1730";
    ctx.beginPath();
    ctx.moveTo(0, -13); ctx.lineTo(10, 0); ctx.lineTo(0, 13); ctx.lineTo(-10, 0); ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = c; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -13); ctx.lineTo(10, 0); ctx.lineTo(0, 13); ctx.lineTo(-10, 0); ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = c;
    ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(a.north ? "−" : "+", 0, 1);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawPlayer() {
    var c = player.north ? COL.north : COL.south;
    for (var i = 0; i < player.trail.length; i++) {
      var tr = player.trail[i];
      ctx.globalAlpha = tr.life * 0.55;
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(tr.x, tr.y, player.r * 0.55, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
    var fr = 74 + Math.sin(state.t * 3) * 5 + player.flipAnim * 26;
    ctx.strokeStyle = c; ctx.globalAlpha = 0.30 + player.flipAnim * 0.3;
    ctx.lineWidth = 2; ctx.setLineDash([10, 8]); ctx.lineDashOffset = -state.t * 26;
    ctx.beginPath(); ctx.arc(player.x, player.y, fr, 0, 6.283); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (mouse.inside && state.mode === "playing") {
      ctx.strokeStyle = "rgba(200,225,255,0.13)";
      ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
    }
    var blink = player.invuln > 0 && Math.floor(state.t * 14) % 2 === 0;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.shadowColor = c; ctx.shadowBlur = blink ? 2 : 22;
    var grad = ctx.createRadialGradient(-5, -5, 2, 0, 0, player.r);
    grad.addColorStop(0, "#ffffff"); grad.addColorStop(0.35, c); grad.addColorStop(1, "#0a1430");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, player.r, 0, 6.283); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 2.5;
    for (var k = 0; k < 3; k++) {
      var a0 = state.t * 2.4 + k * 2.094;
      ctx.beginPath(); ctx.arc(0, 0, player.r + 4, a0, a0 + 0.9); ctx.stroke();
    }
    ctx.fillStyle = "#07101f";
    ctx.font = "bold 21px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(player.north ? "−" : "+", 0, 1);
    ctx.restore();
  }

  function drawHUD() {
    ctx.fillStyle = "rgba(9,14,32,0.88)"; ctx.fillRect(0, 0, W, TOP);
    ctx.strokeStyle = "rgba(90,130,220,0.25)"; ctx.beginPath(); ctx.moveTo(0, TOP + 0.5); ctx.lineTo(W, TOP + 0.5); ctx.stroke();
    for (var i = 0; i < player.maxHull; i++) {
      ctx.fillStyle = i < player.hull ? COL.good : "rgba(255,255,255,0.14)";
      ctx.beginPath(); ctx.arc(24 + i * 24, 22, 8, 0, 6.283); ctx.fill();
    }
    text("SCORE " + state.score, 150, 22, "bold 17px 'Segoe UI', sans-serif", COL.text, "left");
    text("WAVE " + Math.max(1, state.wave) + (state.endless ? " ∞" : " / 10"), W / 2, 22, "bold 17px 'Segoe UI', sans-serif", COL.text);
    if (player.combo > 1) text("COMBO ×" + (1 + Math.min(player.combo, 20) * 0.25).toFixed(2).replace(/\.?0+$/, "") + " (" + player.combo + ")", 640, 22, "bold 15px 'Segoe UI', sans-serif", "#ffd35c", "left");
    ctx.fillStyle = "rgba(255,255,255,0.13)"; rr(W - 168, 14, 148, 15, 7); ctx.fill();
    ctx.fillStyle = player.energy >= 100 ? COL.energy : "rgba(183,139,255,0.65)";
    if (player.energy > 0) { rr(W - 168, 14, 148 * player.energy / 100, 15, 7); ctx.fill(); }
    text(player.energy >= 100 ? "PULSE READY [E]" : "PULSE", W - 94, 40, "bold 10px 'Segoe UI', sans-serif", player.energy >= 100 ? COL.energy : COL.dim);
    var pc = player.north ? COL.north : COL.south;
    ctx.fillStyle = pc; rr(W / 2 - 62, 48, 124, 22, 11); ctx.fill();
    text(player.north ? "NORTH −" : "SOUTH +", W / 2, 59, "bold 13px 'Segoe UI', sans-serif", "#07101f");
    if (state.anchors.length > 0) {
      text("⚓ " + state.anchors.length, 16, 59, "bold 13px 'Segoe UI', sans-serif", COL.dim, "left");
    }
  }

  function drawTitle() {
    text("FERRO", W / 2 - 10, 116, "900 84px 'Segoe UI', sans-serif", COL.north, "right");
    text("FRENZY", W / 2 + 10, 116, "900 84px 'Segoe UI', sans-serif", COL.south, "left");
    text("P O L A R I T Y   A R E N A", W / 2, 164, "bold 17px 'Segoe UI', sans-serif", COL.dim);
    text("The reactor scattered its shards. You are the magnet sent to eat them.", W / 2, 206, "16px 'Segoe UI', sans-serif", COL.text);
    var y = 244;
    var lines = [
      ["SPACE / CLICK", "flip polarity — cyan NORTH −  ·  coral SOUTH +"],
      ["OPPOSITES", "are pulled in: touch them softly to CAPTURE (+100, combo, energy)"],
      ["LIKES", "are pushed away: slam them into a wall to SHATTER (+50)"],
      ["DANGER", "a like shard that touches you, and gold FERAL MINES, cost 1 hull"],
      ["TWINCORES", "violet diamonds SPLIT when destroyed — two minis, opposite poles"],
      ["ANCHORS", "between waves, place magnet satellites: they bend every shard's path"],
      ["E / RIGHT-CLICK", "fire the PULSE when the violet bar is full"],
      ["GOAL", "clear WAVE 10 to stabilize the core and win · 5 hull · WASD/arrows move"]
    ];
    for (var i = 0; i < lines.length; i++) {
      text(lines[i][0], W / 2 - 28, y, "bold 14px 'Segoe UI', sans-serif", "#ffd35c", "right");
      text(lines[i][1], W / 2 - 14, y, "14px 'Segoe UI', sans-serif", COL.text, "left");
      y += 26;
    }
    buttons = [];
    drawButton(W / 2 - 130, 486, 260, 54, "▶  START  (Enter)", startRun, COL.north);
    if (state.best > 0) text("BEST  " + state.best, W / 2, 568, "bold 15px 'Segoe UI', sans-serif", COL.dim);
  }

  function drawDeploy() {
    // placed anchors + ghost
    var i;
    for (i = 0; i < state.anchors.length; i++) {
      if (i === deployGhost.carrying) continue; // the carried one rides the cursor
      drawAnchor(state.anchors[i], false);
    }
    var placing = deployGhost.carrying >= 0 || state.anchors.length < state.anchorSlots;
    if (placing && mouse.inside) {
      var ok = anchorPosOK(mouse.x, mouse.y, deployGhost.carrying);
      ctx.globalAlpha = ok ? 1 : 0.45;
      drawAnchor({ x: mouse.x, y: mouse.y, north: deployGhost.north, pulse: 0 }, true);
      ctx.globalAlpha = 1;
      if (!ok) text("✕", mouse.x, mouse.y - 30, "bold 16px sans-serif", COL.bad);
    }
    // panel
    ctx.fillStyle = "rgba(5,8,20,0.82)"; ctx.fillRect(0, H - 118, W, 118);
    ctx.strokeStyle = "rgba(90,130,220,0.3)"; ctx.beginPath(); ctx.moveTo(0, H - 117.5); ctx.lineTo(W, H - 117.5); ctx.stroke();
    text("DEPLOY ANCHORS — WAVE " + state.pendingWave + " INCOMING", W / 2, H - 100, "900 21px 'Segoe UI', sans-serif", COL.text);
    var c = state.nextComp;
    text("incoming: " + (c.shards + c.twins) + " shards" + (c.twins ? " (incl. " + c.twins + " twincores)" : "") + "  ·  " + c.mines + " feral mines" +
         "      anchors placed: " + state.anchors.length + " / " + state.anchorSlots +
         "      placing: " + (deployGhost.north ? "NORTH −" : "SOUTH +"),
         W / 2, H - 74, "14px 'Segoe UI', sans-serif", COL.dim);
    text("CLICK place / move an anchor · SPACE flips the polarity you place · anchors repel their own colour, pull the other",
         W / 2, H - 52, "13px 'Segoe UI', sans-serif", COL.dim);
    buttons = [];
    drawButton(W / 2 - 120, H - 32, 240, 28, "▶  LAUNCH WAVE " + state.pendingWave + "  (Enter)", confirmDeploy, COL.good);
  }

  function drawEnd(win) {
    ctx.fillStyle = "rgba(4,7,18,0.72)"; ctx.fillRect(0, TOP, W, H - TOP);
    text(win ? "CORE STABILIZED!" : "CORE BREACH", W / 2, 178, "900 58px 'Segoe UI', sans-serif", win ? COL.good : COL.bad);
    text(win ? "You ate the storm through wave 10. The reactor hums your name."
             : "The shards scattered your core across the arena.", W / 2, 226, "17px 'Segoe UI', sans-serif", COL.text);
    text("FINAL SCORE   " + state.score, W / 2, 282, "bold 30px 'Segoe UI', sans-serif", COL.text);
    var st = state.stats;
    text("Captures " + st.captures + "   ·   Shatters " + st.shatters + "   ·   Mine smashes " + st.mineSmashes + "   ·   Twincores split " + st.splits + "   ·   Overloads " + st.overloads,
         W / 2, 318, "15px 'Segoe UI', sans-serif", COL.dim);
    text("Wave reached " + state.wave + "   ·   Best " + state.best + "   ·   Time " + Math.floor(state.timePlayed) + "s", W / 2, 344, "16px 'Segoe UI', sans-serif", COL.dim);
    buttons = [];
    drawButton(W / 2 - 280, 396, 260, 52, "↻  PLAY AGAIN  (Enter)", startRun, COL.north);
    if (win) drawButton(W / 2 + 20, 396, 260, 52, "∞  ENDLESS MODE", continueEndless, COL.energy);
    else drawButton(W / 2 + 20, 396, 260, 52, "TITLE SCREEN", function () { resetState(); resetPlayer(); }, COL.south);
  }

  function render() {
    buttons = (state.mode === "playing") ? [] : buttons;
    ctx.save();
    if (state.shake > 0) ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    drawBackground();
    var i;
    for (i = 0; i < state.anchors.length; i++) {
      if (state.mode === "deploy" && i === deployGhost.carrying) continue;
      drawAnchor(state.anchors[i], false);
    }
    for (i = 0; i < state.mines.length; i++) drawMine(state.mines[i]);
    for (i = 0; i < state.shards.length; i++) drawShard(state.shards[i]);
    if (state.mode !== "over" && state.mode !== "title") drawPlayer();
    for (i = 0; i < state.parts.length; i++) {
      var p = state.parts[i];
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (i = 0; i < state.floats.length; i++) {
      var f = state.floats[i];
      ctx.globalAlpha = Math.min(1, f.life * 1.6);
      text(f.text, f.x, f.y, "bold 15px 'Segoe UI', sans-serif", f.color);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (state.mode === "playing" || state.mode === "deploy" || state.mode === "win" || state.mode === "over") drawHUD();
    if (state.mode === "title") drawTitle();
    if (state.mode === "deploy") drawDeploy();
    if (state.mode === "over") drawEnd(false);
    if (state.mode === "win") drawEnd(true);
    if (state.mode === "playing" && state.waveBanner > 0) {
      ctx.globalAlpha = Math.min(1, state.waveBanner);
      text("WAVE " + state.wave, W / 2, 130, "900 46px 'Segoe UI', sans-serif", COL.text);
      ctx.globalAlpha = 1;
    }
    if (state.paused) {
      ctx.fillStyle = "rgba(4,7,18,0.6)"; ctx.fillRect(0, TOP, W, H - TOP);
      text("PAUSED — press P to resume", W / 2, H / 2, "bold 30px 'Segoe UI', sans-serif", COL.text);
    }
    if (AU.muted) text("MUTED (M)", W - 14, H - 14, "bold 12px 'Segoe UI', sans-serif", COL.dim, "right");
  }

  // ---------- main loop ----------
  var last = 0;
  function frame(ts) {
    var dt = Math.min(0.033, last ? (ts - last) / 1000 : 0.016);
    last = ts;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // test/debug handle (used by the maker's own play-verification harness)
  window.__FERRO = {
    get state() { return state; },
    get player() { return player; },
    get ghost() { return deployGhost; },
    startRun: startRun,
    confirmDeploy: confirmDeploy,
    enterDeploy: enterDeploy,
    beginWave: beginWave
  };
})();
