"use strict";
/*
 * FERROFRENZY — Polarity Arena (v3)
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
 *     Each anchor is WIDE (200px reach) or STRONG (130px reach, double
 *     force) — toggle with F while placing or carrying it.
 *   - From wave 4 you also deploy POLARITY LENSES: gate discs that FLIP
 *     the polarity of every shard passing through. A lens on your
 *     approach lane turns like-shards into captures — and captures
 *     into threats. Placement is a bet about which way you will flip.
 *   - Charge the PULSE with captures, fire it with E / right-click.
 *   - Clear wave 10 to stabilize the core and WIN. Hull 0 = core breach.
 *   - The run is a CAMPAIGN: five named chapters of two waves each,
 *     every chapter leaning on one mechanic and ending in a boss wave.
 *     STORM WARDENS (scaled twincores with hit points) guard waves
 *     2/4/6/8; THE FERROUS HEART itself ends wave 10. Fell it to win
 *     the campaign — endless mode unlocks afterwards.
 *   - Each chapter is a different place: its own nebula palette and
 *     ambient weather, a story beat on its chapter card, and one named
 *     SET-PIECE spectacle (FIRST LIGHT, THE SATELLITE STORM, THE
 *     LENSFLARE, THE GATE FALLS, THE HEART AWAKENS). Bosses announce
 *     themselves with an intro banner and wear a hit-point bar; the
 *     Ferrous Heart turns a second halo against the first.
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
    good: "#5dff9d", bad: "#ff5470", energy: "#b78bff", lens: "#d9ecff"
  };
  var LENS_R = 46; // polarity lens gate-disc radius

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
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"].indexOf(e.code) >= 0) e.preventDefault();
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
      if (code === "KeyT" || code === "Tab") {
        deployGhost.type = deployGhost.type === "anchor" ? "lens" : "anchor";
        AU.click();
      }
      if (code === "KeyF") {
        deployGhost.mode = deployGhost.mode === "wide" ? "strong" : "wide";
        if (deployGhost.carrying >= 0 && state.anchors[deployGhost.carrying]) {
          state.anchors[deployGhost.carrying].mode = deployGhost.mode;
        }
        AU.click();
      }
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
    for (var i = 0; i < 120; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.6 + 0.4, p: Math.random() * 6.28, l: i % 3 });
  })();
  // ambient motes: slow reactor dust drifting through the arena, so a
  // busy late-wave frame has depth behind the action (pure decoration)
  var motes = [];
  (function makeMotes() {
    for (var i = 0; i < 46; i++) {
      motes.push({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 9, vy: -3 - Math.random() * 8,
        r: Math.random() * 1.9 + 0.6, p: Math.random() * 6.28
      });
    }
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
      anchors: [], anchorSlots: 0, lenses: [], lensSlots: 0,
      pendingWave: 0, nextComp: null,
      spawnQueue: 0, twinQueue: 0, spawnTimer: 0, minesQueue: 0,
      bossQueue: 0, bossHp: 0, waveSpawned: 0, waveTotal: 0,
      waveBanner: 0, chapterBanner: 0, shake: 0,
      bossBanner: 0, bossName: "", bossHeart: false, bossMaxHp: 0,
      setpieceIdx: -1, setpieceT: 99,
      endless: false, timePlayed: 0,
      stats: { captures: 0, shatters: 0, mineSmashes: 0, overloads: 0, splits: 0, lensFlips: 0, bosses: 0 }
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
  // ---------- the campaign: five named chapters, two waves each ----------
  // Every chapter opens with a name card that teaches one idea, leans
  // its composition toward that mechanic, and ends with a boss wave:
  // a STORM WARDEN (a scaled twincore with hit points) guards waves
  // 2/4/6/8, and THE FERROUS HEART itself ends wave 10. Endless mode
  // (waves 11+) keeps the arena running afterwards, wardens included.
  var CHAPTERS = [
    { wave: 1, num: "I", name: "FIRST POLARITY", story: "The core wakes in the wreck of the Meridian reactor — hungry, and unafraid.", line: "Opposites are pulled in — capture them. Likes repel — shatter them on the walls.", event: "FIRST LIGHT" },
    { wave: 3, num: "II", name: "THE SPLITTING STORM", story: "The storm learns to divide. Every twin broken makes two funerals — or two meals.", line: "Twincores split into opposite minis. Feral mines crawl at you, deaf to magnetism.", event: "THE SATELLITE STORM" },
    { wave: 5, num: "III", name: "THE LENSFALL", story: "Glass gates rain over the arena. Whatever passes through them comes out changed.", line: "Lens gates flip whatever crosses them. Route a like through a lens and it becomes a capture.", event: "THE LENSFLARE" },
    { wave: 7, num: "IV", name: "THE STRONG FIELD", story: "The old defence gates still stand over the forge. They will not stand long.", line: "Your full architecture is online — four anchors, two lenses. Bend the storm; don't chase it.", event: "THE GATE FALLS" },
    { wave: 9, num: "V", name: "THE FERROUS HEART", story: "At the centre of the storm beats the Ferrous Heart. Still it, and the sky clears.", line: "Two waves left. The Heart of the storm beats at the end of wave 10 — still it, and the sky clears.", event: "THE HEART AWAKENS" }
  ];
  function chapterFor(wave) {
    var c = CHAPTERS[0];
    for (var i = 0; i < CHAPTERS.length; i++) if (wave >= CHAPTERS[i].wave) c = CHAPTERS[i];
    return c;
  }
  function chapterIdx(wave) {
    var idx = 0;
    for (var i = 0; i < CHAPTERS.length; i++) if (wave >= CHAPTERS[i].wave) idx = i;
    return idx;
  }
  // ---------- chapter themes: every chapter is a different place ----------
  // Its own nebula palette, grid and star tints, accent colour and
  // ambient weather (how the drifting motes move and read). Purely
  // presentational — the storm itself never changes its rules.
  var THEMES = [
    { bg: "#070b1a", grid: "rgba(90,130,220,0.07)", star: "#bcd7ff", mote: "#cfe4ff", motes: "rise", accent: "#ffd35c", filing: "#9fc2ff",
      blobs: [[190, 170, 300, "rgba(38,80,180,0.20)"], [790, 130, 260, "rgba(140,40,90,0.16)"], [520, 470, 340, "rgba(30,110,140,0.15)"], [120, 500, 220, "rgba(90,50,160,0.14)"], [860, 470, 240, "rgba(40,60,170,0.15)"]] },
    { bg: "#0c0618", grid: "rgba(150,90,255,0.07)", star: "#d9c2ff", mote: "#e3d0ff", motes: "rain", accent: "#c77dff", filing: "#c0a0ff",
      blobs: [[200, 160, 300, "rgba(110,40,200,0.22)"], [780, 140, 260, "rgba(200,40,140,0.16)"], [520, 480, 340, "rgba(60,30,160,0.20)"], [110, 500, 220, "rgba(150,60,220,0.15)"], [860, 470, 240, "rgba(90,30,180,0.16)"]] },
    { bg: "#04140f", grid: "rgba(80,220,180,0.06)", star: "#c2ffe9", mote: "#d2fff0", motes: "drift", accent: "#5dffc9", filing: "#a0ffd9",
      blobs: [[190, 170, 300, "rgba(20,160,120,0.18)"], [790, 130, 260, "rgba(30,140,180,0.16)"], [520, 470, 340, "rgba(16,110,90,0.18)"], [120, 500, 220, "rgba(60,200,160,0.12)"], [860, 470, 240, "rgba(20,120,140,0.15)"]] },
    { bg: "#150b03", grid: "rgba(255,170,80,0.06)", star: "#ffe3b3", mote: "#ffd9a0", motes: "forge", accent: "#ffb84d", filing: "#ffcf99",
      blobs: [[190, 170, 300, "rgba(200,110,20,0.18)"], [790, 130, 260, "rgba(180,70,20,0.16)"], [520, 470, 340, "rgba(160,90,20,0.17)"], [120, 500, 220, "rgba(220,150,40,0.13)"], [860, 470, 240, "rgba(170,80,30,0.15)"]] },
    { bg: "#160509", grid: "rgba(255,90,90,0.06)", star: "#ffc4c4", mote: "#ffb9a0", motes: "ember", accent: "#ff7847", filing: "#ffaaaa",
      blobs: [[190, 170, 300, "rgba(190,30,50,0.20)"], [790, 130, 260, "rgba(160,20,80,0.17)"], [520, 470, 340, "rgba(140,25,35,0.19)"], [120, 500, 220, "rgba(200,60,40,0.13)"], [860, 470, 240, "rgba(150,20,50,0.16)"]] }
  ];
  function themeFor(wave) { return THEMES[chapterIdx(wave)]; }
  function isChapterStart(wave) {
    for (var i = 0; i < CHAPTERS.length; i++) if (CHAPTERS[i].wave === wave) return true;
    return false;
  }

  function compFor(n) {
    // v3 tuning (bot-measured, see README): slightly thinner twin share
    // and one fewer mine at the cap — waves 7-9 were killing a decent
    // autopilot with overload chains before it could spend its hull.
    // Campaign pass: each chapter leans its mix toward its mechanic —
    // the Lensfall (waves 5-6) breeds twincores, the Heart (9-10) both.
    var shards = Math.min(5 + n * 2, 26);
    var twinShare = (n >= 5 && n <= 6) ? 0.22 : (n >= 9 ? 0.20 : 0.16);
    var twins = n >= 3 ? Math.round(shards * twinShare) : 0;
    var mines = n >= 2 ? Math.min(Math.floor((n - 1) * 0.9), 5) : 0;
    // chapter-final waves carry one boss; the wave-10 boss is the Heart
    var bosses = 0, bossHp = 0;
    if (n % 2 === 0) { bosses = 1; bossHp = n === 10 ? 5 : (n > 10 ? 4 : 3); }
    return { shards: shards - twins, twins: twins, mines: mines, bosses: bosses, bossHp: bossHp };
  }
  function slotsFor(n) {
    if (n < 2) return 0;
    if (n <= 3) return 2;
    if (n <= 5) return 3;
    return 4;
  }
  function lensesFor(n) {
    if (n < 4) return 0;
    if (n <= 6) return 1;
    return 2;
  }
  // an anchor's reach and strength: WIDE covers more sky, STRONG bends
  // what enters its smaller sky twice as hard. One bit, a real trade.
  function anchorRadius(a) { return a.mode === "strong" ? 130 : 200; }
  function anchorForce(a) { return a.mode === "strong" ? 68000 : 34000; }

  function beginWave(n) {
    state.wave = n;
    var c = compFor(n);
    state.spawnQueue = c.shards;
    state.twinQueue = c.twins;
    state.minesQueue = c.mines;
    state.bossQueue = c.bosses;
    state.bossHp = c.bossHp;
    state.waveTotal = c.shards + c.twins + c.mines + c.bosses;
    state.waveSpawned = 0;
    // opening burst: the first two arrivals are already inbound when
    // the banner lifts, so a fresh wave never opens on an empty arena.
    // Arrival pacing only — composition, counts and speeds unchanged.
    spawnOne();
    spawnOne();
    state.spawnTimer = spawnInterval();
    state.waveBanner = 2.0;
    state.chapterBanner = isChapterStart(n) ? 3.0 : 0;
    if (isChapterStart(n)) { state.setpieceIdx = chapterIdx(n); state.setpieceT = 0; }
    state.mode = "playing";
    AU.wave();
  }

  function enterDeploy() {
    state.pendingWave = state.wave + 1;
    state.anchorSlots = slotsFor(state.pendingWave);
    state.lensSlots = lensesFor(state.pendingWave);
    state.nextComp = compFor(state.pendingWave);
    if (state.anchors.length > state.anchorSlots) state.anchors.length = state.anchorSlots;
    if (state.lenses.length > state.lensSlots) state.lenses.length = state.lensSlots;
    deployGhost.north = true;
    deployGhost.carrying = -1;
    deployGhost.carryingLens = -1;
    deployGhost.type = "anchor";
    deployGhost.mode = "wide";
    state.mode = "deploy";
    AU.click();
  }

  function confirmDeploy() {
    if (state.mode !== "deploy") return;
    deployGhost.carrying = -1;
    deployGhost.carryingLens = -1;
    beginWave(state.pendingWave);
  }

  // ghost / placement state for the deployment phase
  // carrying: index of anchor being moved (-1 = placing new); carryingLens likewise;
  // type: what a fresh click places ("anchor" | "lens"); mode: anchor strength being placed
  var deployGhost = { north: true, carrying: -1, carryingLens: -1, type: "anchor", mode: "wide" };

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

  function lensPosOK(x, y, skipIdx) {
    if (x < 52 || x > W - 52 || y < TOP + 52 || y > H - 44) return false;
    var dx = x - player.x, dy = y - player.y;
    if (dx * dx + dy * dy < 88 * 88) return false; // not on top of the core
    var i, ax, ay;
    for (i = 0; i < state.anchors.length; i++) {
      ax = x - state.anchors[i].x; ay = y - state.anchors[i].y;
      if (ax * ax + ay * ay < 72 * 72) return false; // keep gates clear of anchors
    }
    for (i = 0; i < state.lenses.length; i++) {
      if (i === skipIdx) continue;
      ax = x - state.lenses[i].x; ay = y - state.lenses[i].y;
      if (ax * ax + ay * ay < 100 * 100) return false; // discs must not overlap
    }
    return true;
  }

  function deployClick(x, y) {
    var i, b;
    for (i = 0; i < buttons.length; i++) {
      b = buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { b.fn(); return; }
    }
    // clicking the anchor you are carrying flips its polarity in place
    if (deployGhost.carrying >= 0) {
      var ca0 = state.anchors[deployGhost.carrying];
      var cdx = x - ca0.x, cdy = y - ca0.y;
      if (cdx * cdx + cdy * cdy < 26 * 26) {
        ca0.north = !ca0.north; deployGhost.north = ca0.north; AU.flip(ca0.north); return;
      }
      if (anchorPosOK(x, y, deployGhost.carrying)) {
        ca0.x = x; ca0.y = y; ca0.north = deployGhost.north; ca0.mode = deployGhost.mode;
        deployGhost.carrying = -1;
        AU.place();
      } else floater(x, y - 24, "✕ too close to the core, an anchor or the edge", COL.bad);
      return;
    }
    // drop a carried lens
    if (deployGhost.carryingLens >= 0) {
      var cl0 = state.lenses[deployGhost.carryingLens];
      if (lensPosOK(x, y, deployGhost.carryingLens)) {
        cl0.x = x; cl0.y = y;
        deployGhost.carryingLens = -1;
        AU.place();
      } else floater(x, y - 24, "✕ too close to the core, an anchor or another lens", COL.bad);
      return;
    }
    // pick up an existing anchor?
    for (i = 0; i < state.anchors.length; i++) {
      var a = state.anchors[i];
      var dx = x - a.x, dy = y - a.y;
      if (dx * dx + dy * dy < 26 * 26) {
        deployGhost.carrying = i;
        deployGhost.north = a.north;
        deployGhost.mode = a.mode || "wide";
        deployGhost.type = "anchor";
        AU.click();
        return;
      }
    }
    // pick up an existing lens?
    for (i = 0; i < state.lenses.length; i++) {
      var l = state.lenses[i];
      var lx = x - l.x, ly = y - l.y;
      if (lx * lx + ly * ly < (LENS_R + 6) * (LENS_R + 6)) {
        deployGhost.carryingLens = i;
        deployGhost.type = "lens";
        AU.click();
        return;
      }
    }
    // place something new, of the ghost's current type
    if (deployGhost.type === "lens") {
      if (state.lenses.length >= state.lensSlots) floater(x, y - 24, "✕ no lens slots left", COL.bad);
      else if (lensPosOK(x, y, -1)) {
        state.lenses.push({ x: x, y: y, flash: 0 });
        AU.place();
      } else floater(x, y - 24, "✕ too close to the core, an anchor or another lens", COL.bad);
      return;
    }
    if (state.anchors.length >= state.anchorSlots) floater(x, y - 24, "✕ no anchor slots left", COL.bad);
    else if (anchorPosOK(x, y, -1)) {
      state.anchors.push({ x: x, y: y, north: deployGhost.north, pulse: 1, mode: deployGhost.mode });
      AU.place();
    } else floater(x, y - 24, "✕ too close to the core, an anchor or the edge", COL.bad);
  }

  function spawnInterval() {
    // waves 1-2 deliver on a tighter clock so the opening has no dead
    // air; from wave 3 on, the original ramp applies unchanged.
    if (state.wave <= 2) return Math.max(0.66 - state.wave * 0.05, 0.5);
    return Math.max(0.88 - state.wave * 0.045, 0.36);
  }

  // one arrival from the wave's queues, with the long-standing mix:
  // mines trickle in at 22%, twincores at 45% while normals remain.
  function spawnOne() {
    // the chapter boss joins once two-fifths of its wave is inbound —
    // late enough to have company, early enough to matter
    if (state.bossQueue > 0 && state.waveSpawned >= Math.ceil(state.waveTotal * 0.4)) {
      spawnBoss();
      state.bossQueue--;
      state.waveSpawned++;
      return;
    }
    var roll = rnd();
    if (state.minesQueue > 0 && (state.spawnQueue + state.twinQueue === 0 || roll < 0.22)) { spawnMine(); state.minesQueue--; }
    else if (state.twinQueue > 0 && (state.spawnQueue === 0 || roll < 0.45)) { spawnShard("twin"); state.twinQueue--; }
    else if (state.spawnQueue > 0) { spawnShard("norm"); state.spawnQueue--; }
    else if (state.bossQueue > 0) { spawnBoss(); state.bossQueue--; }
    state.waveSpawned++;
  }

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
      rot: rnd() * 6.28, vr: (rnd() - 0.5) * 2.4, trail: [],
      inLens: false, lensCd: 0
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
  // a chapter boss: a twincore scaled up, with hit points. It feels the
  // same magnetism as any shard; destruction events (capture, wall
  // shatter, field pop, pulse) cost it 1 hp instead of killing it,
  // until the last point, when it bursts into minis like its kin.
  function spawnBoss() {
    var side = Math.floor(rnd() * 4), x, y;
    if (side === 0) { x = rnd() * W; y = -52; }
    else if (side === 1) { x = rnd() * W; y = H + 52; }
    else if (side === 2) { x = -52; y = rnd() * H; }
    else { x = W + 52; y = rnd() * H; }
    var ang = Math.atan2(H / 2 - y, W / 2 - x) + (rnd() - 0.5) * 0.5;
    var sp = 40 + rnd() * 25;
    var heart = state.bossHp >= 5;
    state.shards.push({
      x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      r: heart ? 44 : 33,
      north: rnd() < 0.5, kind: "boss",
      hp: state.bossHp || 3, maxHp: state.bossHp || 3,
      name: heart ? "THE FERROUS HEART" : "STORM WARDEN",
      rot: rnd() * 6.28, vr: (rnd() - 0.5) * 1.1, trail: [],
      inLens: false, lensCd: 0, bossCd: 0, flash: 0
    });
    state.bossBanner = 2.4; state.bossName = heart ? "THE FERROUS HEART" : "STORM WARDEN";
    state.bossHeart = heart; state.bossMaxHp = state.bossHp || 3;
    floater(x, y, (heart ? "THE FERROUS HEART" : "A STORM WARDEN") + " STIRS", COL.twin);
    AU.split();
  }

  function splitBurst(s, n) {
    var a0 = rnd() * 6.283;
    for (var k = 0; k < n; k++) {
      var a = a0 + (k / n) * 6.283, sp = 230 + rnd() * 60;
      // spawn offset from the parent's centre, flying apart: a mini must
      // not be born inside the core's contact radius (instant capture)
      state.shards.push({
        x: s.x + Math.cos(a) * (s.r + 10), y: s.y + Math.sin(a) * (s.r + 10),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: 8, north: k % 2 === 0, kind: "mini",
        rot: rnd() * 6.28, vr: (rnd() - 0.5) * 4, trail: [],
        inLens: false, lensCd: 0.35
      });
    }
  }

  function splitTwin(s) {
    state.stats.splits++;
    AU.split();
    burst(s.x, s.y, COL.twin, 18, 220);
    splitBurst(s, 2);
  }

  // a boss absorbs a destruction event at the cost of 1 hp: it bursts,
  // sheds points and spends a moment unable to touch the core, but it
  // does not die. Returns true when the event was absorbed — the
  // caller must NOT remove the shard in that case.
  function bossAbsorb(s) {
    if (s.kind !== "boss" || s.hp <= 1) return false;
    s.hp--;
    s.flash = 0.18;
    state.shake = Math.max(state.shake, 6);
    s.fieldTime = 0;
    s.bossCd = 0.8;
    burst(s.x, s.y, COL.twin, 16, 230);
    addScore(100, s.x, s.y, "BOSS HIT +");
    AU.shatter();
    return true;
  }

  function bossDown(s) {
    state.stats.bosses++;
    var heart = s.maxHp >= 5;
    addScore(heart ? 1400 : 500, s.x, s.y, (heart ? "HEART STILLED +" : "WARDEN DOWN +"));
    state.shake = Math.max(state.shake, heart ? 14 : 10);
    burst(s.x, s.y, COL.twin, 36, 320);
    burst(s.x, s.y, COL.energy, 20, 240);
    AU.mineBoom();
    splitBurst(s, heart ? 4 : 2);
  }

  // split-kin bookkeeping for a shard that was truly destroyed
  function onShardDestroyed(s) {
    if (s.kind === "twin") splitTwin(s);
    else if (s.kind === "boss") bossDown(s);
  }

  // ---------- effects ----------
  function burst(x, y, color, n, speed) {
    for (var i = 0; i < n; i++) {
      var a = rnd() * 6.283, s = (0.3 + rnd() * 0.7) * speed;
      state.parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + rnd() * 0.4, max: 0.9, color: color, r: 1.5 + rnd() * 2.2 });
    }
  }
  function floater(x, y, text, color) {
    // keep popups fully on-canvas: score text centres on its event, so
    // wall impacts and long labels used to spill past the left/right
    // edge and clip mid-word. Estimate the drawn half-width (bold 15px)
    // and clamp the centre inside the arena.
    var half = text.length * 4.2 + 8;
    if (x < half + 4) x = half + 4;
    if (x > W - half - 4) x = W - half - 4;
    if (y < TOP + 14) y = TOP + 14;
    if (y > H - 8) y = H - 8;
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
        if (bossAbsorb(s)) continue;
        burst(s.x, s.y, COL.energy, 8, 160);
        state.shards.splice(i, 1);
        state.score += 25;
        onShardDestroyed(s);
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
      var ar = anchorRadius(a);
      dx = a.x - x; dy = a.y - y; d2 = dx * dx + dy * dy;
      if (d2 > ar * ar || d2 < 30 * 30) continue;
      d = Math.sqrt(d2) || 1;
      sgn = (north !== a.north) ? 1 : -1;
      F = sgn * anchorForce(a) / Math.max(50, d) / d;
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
      if (d > anchorRadius(a)) continue;
      inField = true;
      if (d < 30) continue;
      var F = anchorForce(a) / Math.max(50, d);
      var sgn = (s.north !== a.north) ? 1 : -1;
      s.vx += (dx / d) * F * dt * 3.2 * sgn;
      s.vy += (dy / d) * F * dt * 3.2 * sgn;
    }
    return inField;
  }

  // polarity lenses: a shard crossing a gate disc flips polarity, once
  // per pass (it must leave the disc before it can flip again, and a
  // short cooldown keeps newborn minis from double-flipping in place).
  // Returns true when a flip happened, so the caller can re-derive the
  // shard's relation to the core for this frame's contact check.
  function applyLenses(s, dt) {
    if (s.lensCd > 0) s.lensCd -= dt;
    var flipped = false;
    for (var i = 0; i < state.lenses.length; i++) {
      var l = state.lenses[i];
      var dx = l.x - s.x, dy = l.y - s.y;
      var d2 = dx * dx + dy * dy;
      if (d2 < LENS_R * LENS_R) {
        if (!s.inLens && s.lensCd <= 0) {
          s.north = !s.north;
          s.inLens = true;
          s.lensCd = 0.7;
          l.flash = 1;
          state.stats.lensFlips++;
          burst(s.x, s.y, COL.lens, 7, 130);
          floater(s.x, s.y - 16, "⇋ FLIP", COL.lens);
          if (AU.lens) AU.lens();
          flipped = true;
        }
      } else if (d2 > (LENS_R + 10) * (LENS_R + 10)) {
        s.inLens = false;
      }
    }
    return flipped;
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
    for (i = 0; i < state.lenses.length; i++) {
      if (state.lenses[i].flash > 0) state.lenses[i].flash = Math.max(0, state.lenses[i].flash - dt * 2.4);
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
    if (state.chapterBanner > 0) state.chapterBanner -= dt;
    if (state.bossBanner > 0) state.bossBanner -= dt;
    if (state.setpieceT < 99) state.setpieceT += dt;
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
    if (state.spawnQueue > 0 || state.twinQueue > 0 || state.minesQueue > 0 || state.bossQueue > 0) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        spawnOne();
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
      if (s.flash > 0) s.flash -= dt;
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
        if (bossAbsorb(s)) continue;
        // destabilized by long field exposure: pops where it floats
        burst(s.x, s.y, COL.twin, 12, 180);
        addScore(25, s.x, s.y, "FIELD POP +");
        state.stats.shatters++;
        player.energy = Math.min(100, player.energy + 4);
        AU.shatter();
        state.shards.splice(i, 1);
        onShardDestroyed(s);
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
      if (s.bossCd > 0) s.bossCd -= dt;

      // polarity lenses flip a crossing shard; contact below must judge
      // the shard by its NEW polarity, so refresh the relation here
      if (applyLenses(s, dt)) opposite = s.north !== player.north;

      // wall shatter for fast shards
      if ((s.x < s.r || s.x > W - s.r || s.y < s.r + TOP || s.y > H - s.r) && spd > 255) {
        if (bossAbsorb(s)) {
          // the warden ricochets off the wall instead of shattering
          s.vx *= -0.55; s.vy *= -0.55;
        } else {
          burst(s.x, s.y, s.north ? COL.north : COL.south, 12, 200);
          addScore(s.kind === "twin" ? 80 : (s.kind === "mini" ? 25 : 50), s.x, s.y, "SHATTER +");
          state.stats.shatters++;
          player.energy = Math.min(100, player.energy + 8);
          AU.shatter();
          state.shards.splice(i, 1);
          onShardDestroyed(s);
          continue;
        }
      }
      s.x = Math.max(s.r, Math.min(W - s.r, s.x));
      s.y = Math.max(s.r + TOP, Math.min(H - s.r, s.y));

      // player contact (a boss that just shed a hit point cannot touch
      // the core until its recoil moment passes)
      if (d < player.r + s.r - 2 && !(s.kind === "boss" && s.bossCd > 0)) {
        if (opposite) {
          if (bossAbsorb(s)) {
            // recoils out of the core's grip instead of being eaten
            s.vx = ux * -340; s.vy = uy * -340;
            continue;
          }
          // CAPTURE
          player.combo++; player.comboTimer = 2.5;
          addScore(s.kind === "twin" ? 150 : (s.kind === "mini" ? 50 : 100), s.x, s.y, "CAPTURE +");
          state.stats.captures++;
          player.energy = Math.min(100, player.energy + 16);
          burst(s.x, s.y, s.north ? COL.north : COL.south, 14, 170);
          AU.capture(player.combo);
          state.shards.splice(i, 1);
          onShardDestroyed(s);
          continue;
        } else {
          if (s.kind === "boss") {
            // a warden is too massive to be eaten by an overload: it
            // mauls the core and is flung clear, unharmed but spent
            burst(s.x, s.y, COL.bad, 12, 200);
            s.vx = ux * -380; s.vy = uy * -380;
            s.bossCd = 0.9;
            damagePlayer(s.x, s.y);
            continue;
          }
          burst(s.x, s.y, COL.bad, 12, 200);
          state.shards.splice(i, 1);
          onShardDestroyed(s);
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
          if (s.kind !== "boss") {
            // a boss used as the hammer ploughs through, unharmed
            state.shards.splice(j, 1);
            onShardDestroyed(s);
          }
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
      var msp = Math.sqrt(m.vx * m.vx + m.vy * m.vy), MAXM = 58 + state.wave * 2;
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

  // nebula backdrops, one pre-rendered per chapter theme (static
  // gradients are expensive per-frame), each finished with a soft
  // vignette so the arena's centre reads deeper than its edges
  var nebulas = [];
  (function makeNebulas() {
    for (var ci = 0; ci < THEMES.length; ci++) {
      var th = THEMES[ci];
      var cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      var nctx = cv.getContext("2d");
      nctx.fillStyle = th.bg; nctx.fillRect(0, 0, W, H);
      for (var i = 0; i < th.blobs.length; i++) {
        var b = th.blobs[i];
        var g = nctx.createRadialGradient(b[0], b[1], 10, b[0], b[1], b[2]);
        g.addColorStop(0, b[3]); g.addColorStop(1, "rgba(0,0,0,0)");
        nctx.fillStyle = g; nctx.fillRect(0, 0, W, H);
      }
      var vg = nctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.95);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.38)");
      nctx.fillStyle = vg; nctx.fillRect(0, 0, W, H);
      nebulas.push(cv);
    }
  })();

  // ---------- chapter set-pieces: one named spectacle per chapter,
  // purely visual, fired by beginWave on a chapter's first wave and
  // named on its chapter card ----------
  function drawSetpiece() {
    var t = state.setpieceT, idx = state.setpieceIdx;
    var fade = Math.sin(Math.PI * Math.min(1, t / 3.2));
    var i;
    ctx.save();
    if (idx === 0) {
      // FIRST LIGHT: golden rings bloom outward from the core
      for (i = 0; i < 3; i++) {
        var r0 = t * 300 - i * 80;
        if (r0 <= 0) continue;
        ctx.globalAlpha = Math.max(0.001, 0.5 * (1 - r0 / 720) * fade);
        ctx.strokeStyle = "#ffd35c"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(player.x, player.y, r0, 0, 6.283); ctx.stroke();
      }
    } else if (idx === 1) {
      // THE SATELLITE STORM: violet streaks rake the arena diagonally
      ctx.strokeStyle = "#e3d0ff"; ctx.lineWidth = 2;
      ctx.globalAlpha = 0.28 * fade;
      for (i = 0; i < 26; i++) {
        var sx = ((i * 173.3 + t * 470) % 1180) - 110;
        var sy = ((i * 271.7 + t * 340) % 720) - 60;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - 22, sy - 15); ctx.stroke();
      }
    } else if (idx === 2) {
      // THE LENSFLARE: a teal flare sweeps the arena; lenses ring out
      var fy = TOP + (t / 3.2) * (H - TOP);
      var fg = ctx.createLinearGradient(0, fy - 46, 0, fy + 46);
      fg.addColorStop(0, "rgba(93,255,201,0)");
      fg.addColorStop(0.5, "rgba(93,255,201," + (0.20 * fade) + ")");
      fg.addColorStop(1, "rgba(93,255,201,0)");
      ctx.globalAlpha = 1; ctx.fillStyle = fg; ctx.fillRect(0, fy - 46, W, 92);
      for (i = 0; i < state.lenses.length; i++) {
        var lr = (t * 150) % 100;
        ctx.globalAlpha = Math.max(0, 0.5 * (1 - lr / 100)) * fade;
        ctx.strokeStyle = "#5dffc9"; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(state.lenses[i].x, state.lenses[i].y, lr, 0, 6.283); ctx.stroke();
      }
    } else if (idx === 3) {
      // THE GATE FALLS: the old defence gates sink and gutter out
      for (i = 0; i < 2; i++) {
        var gx = i === 0 ? 64 : W - 64;
        var gh = (H - TOP - 30) * Math.max(0, 1 - (t / 3.2) * 0.9);
        if (gh <= 4) continue;
        var gg = ctx.createLinearGradient(0, TOP, 0, TOP + gh);
        gg.addColorStop(0, "rgba(255,184,77,0.5)"); gg.addColorStop(1, "rgba(255,120,40,0.05)");
        ctx.globalAlpha = (0.55 + 0.25 * Math.sin(state.t * 34 + i * 2)) * fade;
        ctx.fillStyle = gg; ctx.fillRect(gx - 5, TOP, 10, gh);
        ctx.globalAlpha = 0.8 * fade; ctx.fillStyle = "#ffd9a0";
        ctx.fillRect(gx - 9, TOP + gh - 3, 18, 3);
      }
    } else if (idx === 4) {
      // THE HEART AWAKENS: crimson pulses beat out of the arena's heart
      for (i = 0; i < 3; i++) {
        var ph = (t * 0.85 + i / 3) % 1;
        ctx.globalAlpha = (1 - ph) * 0.34 * fade;
        ctx.strokeStyle = "#ff5a3c"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(W / 2, 322, ph * 340 + 8, 0, 6.283); ctx.stroke();
      }
      var vg2 = ctx.createRadialGradient(W / 2, 322, H * 0.36, W / 2, 322, H * 0.92);
      vg2.addColorStop(0, "rgba(160,10,30,0)");
      vg2.addColorStop(1, "rgba(160,10,30," + (0.26 * (0.6 + 0.4 * Math.sin(t * 7)) * fade) + ")");
      ctx.globalAlpha = 1; ctx.fillStyle = vg2; ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawBackground() {
    var bw = state.mode === "deploy" ? state.pendingWave : Math.max(1, state.wave);
    var th = themeFor(bw);
    ctx.drawImage(nebulas[chapterIdx(bw)], 0, 0);
    ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = 0; x <= W; x += 48) { ctx.moveTo(x, TOP); ctx.lineTo(x, H); }
    for (var y = TOP; y <= H; y += 48) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      ctx.globalAlpha = (0.35 + 0.3 * Math.sin(state.t * 1.4 + st.p)) * (st.l === 0 ? 0.5 : 1);
      ctx.fillStyle = th.star;
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;
    // ambient chapter weather (positions advance in draw: purely
    // visual) — each chapter's motes move and read differently:
    // rising dust, storm rain, drifting spores, forge and heart embers
    for (var mi = 0; mi < motes.length; mi++) {
      var mo = motes[mi];
      var mvx = mo.vx, mvy = mo.vy;
      if (th.motes === "rain") { mvx = 34 + mo.vx; mvy = 108 + mo.vy; }
      else if (th.motes === "drift") { mvx = Math.sin(state.t * 0.5 + mo.p) * 8; mvy = Math.cos(state.t * 0.4 + mo.p) * 3.5; }
      else if (th.motes === "forge") { mvx = mo.vx * 0.4; mvy = -24 + mo.vy; }
      else if (th.motes === "ember") { mvx = Math.sin(state.t * 0.8 + mo.p) * 5; mvy = -13 + mo.vy * 0.6; }
      mo.x += mvx * 0.016; mo.y += mvy * 0.016;
      if (mo.y < TOP - 6) { mo.y = H + 4; mo.x = Math.random() * W; }
      if (mo.y > H + 6) { mo.y = TOP + 2; mo.x = Math.random() * W; }
      if (mo.x < -6) mo.x = W + 4; else if (mo.x > W + 6) mo.x = -4;
      ctx.globalAlpha = 0.10 + 0.10 * Math.sin(state.t * 0.9 + mo.p);
      if (th.motes === "rain") {
        ctx.strokeStyle = th.mote; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(mo.x, mo.y); ctx.lineTo(mo.x - mvx * 0.09, mo.y - mvy * 0.09); ctx.stroke();
      } else {
        ctx.fillStyle = th.mote;
        ctx.beginPath(); ctx.arc(mo.x, mo.y, mo.r, 0, 6.283); ctx.fill();
      }
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
        ctx.strokeStyle = th.filing;
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
    if (s.flash > 0) c = "#ffffff"; // a boss flashes white when its hull breaks
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
    if (s.kind === "twin" || s.kind === "boss") {
      // TWINCORE: two fused triangles (a diamond) with a glowing seam
      ctx.shadowColor = COL.twin; ctx.shadowBlur = s.kind === "boss" ? (s.maxHp >= 5 ? 36 : 27) : 18;
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
    if (s.kind === "boss") {
      // boss regalia, drawn unrotated: a pulsing aura, a dashed halo —
      // the Heart wears a second, counter-turning ring with orbiting
      // sparks — a hit-point BAR and its name, so a first-time player
      // can read the fight at a glance: big, named, visibly wearing down
      var heart = s.maxHp >= 5;
      var bc = heart ? "#ff7847" : COL.twin;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.globalAlpha = 0.09 + 0.03 * Math.sin(state.t * 3 + s.x * 0.05);
      ctx.fillStyle = bc;
      ctx.beginPath(); ctx.arc(0, 0, s.r + 15, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = bc; ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 7]); ctx.lineDashOffset = -state.t * 18;
      ctx.beginPath(); ctx.arc(0, 0, s.r + 7, 0, 6.283); ctx.stroke();
      if (heart) {
        ctx.strokeStyle = "#ffb9a0"; ctx.globalAlpha = 0.75;
        ctx.lineDashOffset = state.t * 26;
        ctx.beginPath(); ctx.arc(0, 0, s.r + 16, 0, 6.283); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#ffd9a0";
        for (var ok2 = 0; ok2 < 3; ok2++) {
          var oa = state.t * 1.9 + ok2 * 2.094;
          ctx.beginPath(); ctx.arc(Math.cos(oa) * (s.r + 16), Math.sin(oa) * (s.r + 16), 2.4, 0, 6.283); ctx.fill();
        }
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // hit-point bar: spent hull in dark, living hull in boss colour
      var bw2 = s.r * 2;
      ctx.fillStyle = "rgba(2,4,10,0.62)";
      ctx.fillRect(-bw2 / 2, -s.r - 26, bw2, 8);
      ctx.fillStyle = bc;
      if (s.hp > 0) ctx.fillRect(-bw2 / 2 + 1, -s.r - 25, (bw2 - 2) * s.hp / s.maxHp, 6);
      ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 1;
      ctx.strokeRect(-bw2 / 2, -s.r - 26, bw2, 8);
      if (s.x > 100 && s.x < W - 100) {
        ctx.fillStyle = bc;
        ctx.font = "bold 11px 'Segoe UI', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(s.name, 0, s.r + 15);
      }
      ctx.restore();
    }
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
    var strong = a.mode === "strong";
    ctx.save();
    ctx.translate(a.x, a.y);
    // field ring: the reach its shards feel (STRONG pulls a smaller sky)
    var fr = anchorRadius(a);
    ctx.strokeStyle = c;
    ctx.globalAlpha = ghost ? 0.35 : 0.13 + (a.pulse || 0) * 0.25;
    ctx.lineWidth = strong ? 2.4 : 1.5; ctx.setLineDash([4, 9]); ctx.lineDashOffset = state.t * 10;
    ctx.beginPath(); ctx.arc(0, 0, fr, 0, 6.283); ctx.stroke();
    ctx.setLineDash([]);
    if (strong) { // a second, tighter ring marks the doubled force
      ctx.globalAlpha = ghost ? 0.3 : 0.16;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, fr * 0.55, 0, 6.283); ctx.stroke();
    }
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
    if (strong) {
      ctx.fillStyle = "#ffd35c";
      ctx.font = "bold 9px sans-serif";
      ctx.fillText("×2", 0, 22);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawLens(l, ghost) {
    ctx.save();
    ctx.translate(l.x, l.y);
    var fl = l.flash || 0;
    ctx.globalAlpha = ghost ? 0.7 : 1;
    // gate disc: a pale prism that swaps whatever passes through it
    var grad = ctx.createRadialGradient(0, 0, 4, 0, 0, LENS_R);
    grad.addColorStop(0, "rgba(217,236,255," + (0.10 + fl * 0.30) + ")");
    grad.addColorStop(0.8, "rgba(150,180,255," + (0.05 + fl * 0.15) + ")");
    grad.addColorStop(1, "rgba(150,180,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, LENS_R, 0, 6.283); ctx.fill();
    // rim: two counter-rotating dashed arcs, cyan one way, coral back
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = COL.north; ctx.globalAlpha = (ghost ? 0.5 : 0.75) + fl * 0.25;
    ctx.setLineDash([14, 10]); ctx.lineDashOffset = state.t * 22;
    ctx.beginPath(); ctx.arc(0, 0, LENS_R - 2, 0, 6.283); ctx.stroke();
    ctx.strokeStyle = COL.south;
    ctx.setLineDash([14, 10]); ctx.lineDashOffset = -state.t * 22;
    ctx.beginPath(); ctx.arc(0, 0, LENS_R - 8, 0, 6.283); ctx.stroke();
    ctx.setLineDash([]);
    // swap glyph
    ctx.globalAlpha = ghost ? 0.8 : 0.95;
    ctx.fillStyle = COL.lens;
    ctx.font = "bold 21px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("⇋", 0, 1);
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
    var hw = state.mode === "deploy" ? state.pendingWave : state.wave;
    if (hw >= 1) {
      var hch = chapterFor(hw);
      ctx.globalAlpha = 0.9;
      text("CHAPTER " + hch.num + " · " + hch.name, W / 2, 86, "bold 11px 'Segoe UI', sans-serif", themeFor(hw).accent);
      ctx.globalAlpha = 1;
    }
    if (state.anchors.length > 0 || state.lenses.length > 0) {
      text("⚓ " + state.anchors.length + (state.lenses.length > 0 ? "   ⇋ " + state.lenses.length : ""), 16, 59, "bold 13px 'Segoe UI', sans-serif", COL.dim, "left");
    }
  }

  function drawTitle() {
    text("FERRO", W / 2 - 10, 116, "900 84px 'Segoe UI', sans-serif", COL.north, "right");
    text("FRENZY", W / 2 + 10, 116, "900 84px 'Segoe UI', sans-serif", COL.south, "left");
    text("P O L A R I T Y   A R E N A", W / 2, 164, "bold 17px 'Segoe UI', sans-serif", COL.dim);
    text("Pellona Station's reactor blew its heart across the sky — a core of living iron", W / 2, 200, "16px 'Segoe UI', sans-serif", COL.text);
    text("that eats magnets and breeds storms. Five storms. Five Wardens. One Heart to still.", W / 2, 222, "16px 'Segoe UI', sans-serif", COL.text);
    text("You are FERRO, the last magnet core. Eat the storm. Still the Heart. Bring the sky back.", W / 2, 246, "italic bold 15px 'Segoe UI', sans-serif", "#ffd35c");
    var y = 274;
    var lines = [
      ["SPACE / CLICK", "flip polarity — cyan NORTH −  ·  coral SOUTH +"],
      ["OPPOSITES", "are pulled in: touch them softly to CAPTURE (+100, combo, energy)"],
      ["LIKES", "are pushed away: slam them into a wall to SHATTER (+50)"],
      ["DANGER", "a like shard that touches you, and gold FERAL MINES, cost 1 hull"],
      ["TWINCORES", "violet diamonds SPLIT when destroyed — two minis, opposite poles"],
      ["ANCHORS", "between waves, place magnet satellites — WIDE or STRONG (F)"],
      ["LENSES", "from wave 4, place gate discs: shards passing through FLIP polarity"],
      ["E / RIGHT-CLICK", "fire the PULSE when the violet bar is full"],
      ["GOAL", "clear WAVE 10 to stabilize the core and win · 5 hull · WASD/arrows move"]
    ];
    for (var i = 0; i < lines.length; i++) {
      text(lines[i][0], W / 2 - 28, y, "bold 14px 'Segoe UI', sans-serif", "#ffd35c", "right");
      text(lines[i][1], W / 2 - 14, y, "14px 'Segoe UI', sans-serif", COL.text, "left");
      y += 24;
    }
    buttons = [];
    drawButton(W / 2 - 130, 486, 260, 54, "▶  START  (Enter)", startRun, COL.north);
    if (state.best > 0) text("BEST  " + state.best, W / 2, 568, "bold 15px 'Segoe UI', sans-serif", COL.dim);
  }

  function drawDeploy() {
    // placed anchors + lenses (render() already drew them; here only the ghost)
    var placingAnchor = deployGhost.carrying >= 0 || (deployGhost.type === "anchor" && state.anchors.length < state.anchorSlots);
    var placingLens = deployGhost.carryingLens >= 0 || (deployGhost.type === "lens" && state.lenses.length < state.lensSlots);
    if ((placingAnchor || placingLens) && mouse.inside) {
      if (placingLens) {
        var lok = lensPosOK(mouse.x, mouse.y, deployGhost.carryingLens);
        ctx.globalAlpha = lok ? 1 : 0.45;
        drawLens({ x: mouse.x, y: mouse.y, flash: 0 }, true);
        ctx.globalAlpha = 1;
        if (!lok) text("✕", mouse.x, mouse.y - LENS_R - 12, "bold 16px sans-serif", COL.bad);
      } else {
        var ok = anchorPosOK(mouse.x, mouse.y, deployGhost.carrying);
        ctx.globalAlpha = ok ? 1 : 0.45;
        drawAnchor({ x: mouse.x, y: mouse.y, north: deployGhost.north, pulse: 0, mode: deployGhost.mode }, true);
        ctx.globalAlpha = 1;
        if (!ok) text("✕", mouse.x, mouse.y - 30, "bold 16px sans-serif", COL.bad);
      }
    }
    // one-line teaching at the two deployment debuts
    if (state.pendingWave === 2) {
      text("NEW: ANCHOR satellites — click to place them; their fields bend shards for the whole run", W / 2, H - 140, "bold 14px 'Segoe UI', sans-serif", "#ffd35c");
    } else if (state.pendingWave === 4) {
      text("NEW: a LENS slot — press T, then click to place a gate that flips any shard crossing it", W / 2, H - 140, "bold 14px 'Segoe UI', sans-serif", "#ffd35c");
    }
    // panel
    ctx.fillStyle = "rgba(5,8,20,0.82)"; ctx.fillRect(0, H - 118, W, 118);
    ctx.strokeStyle = "rgba(90,130,220,0.3)"; ctx.beginPath(); ctx.moveTo(0, H - 117.5); ctx.lineTo(W, H - 117.5); ctx.stroke();
    var depTitle = "DEPLOY — WAVE " + state.pendingWave + " INCOMING";
    if (isChapterStart(state.pendingWave)) {
      var nch = chapterFor(state.pendingWave);
      depTitle = "DEPLOY — CHAPTER " + nch.num + ": " + nch.name + " · WAVE " + state.pendingWave;
    }
    text(depTitle, W / 2, H - 100, "900 21px 'Segoe UI', sans-serif", COL.text);
    var c = state.nextComp;
    text("incoming: " + (c.shards + c.twins) + " shards" + (c.twins ? " (incl. " + c.twins + " twincores)" : "") + "  ·  " + c.mines + " feral mines" +
         (c.bosses ? "  ·  ⚠ " + (state.pendingWave === 10 ? "THE FERROUS HEART" : "a STORM WARDEN") : "") +
         "      anchors: " + state.anchors.length + " / " + state.anchorSlots +
         (state.lensSlots > 0 ? "      lenses: " + state.lenses.length + " / " + state.lensSlots : ""),
         W / 2, H - 74, "14px 'Segoe UI', sans-serif", COL.dim);
    text("placing: " + (deployGhost.type === "lens" ? "LENS ⇋ (flips shards that cross it)"
          : "ANCHOR " + (deployGhost.north ? "NORTH −" : "SOUTH +") + " · " + (deployGhost.mode === "strong" ? "STRONG ×2, 130px" : "WIDE, 200px")) +
         "      CLICK place / move · T anchor⇄lens · SPACE polarity · F wide⇄strong",
         W / 2, H - 52, "13px 'Segoe UI', sans-serif", COL.dim);
    buttons = [];
    drawButton(W / 2 - 120, H - 32, 240, 28, "▶  LAUNCH WAVE " + state.pendingWave + "  (Enter)", confirmDeploy, COL.good);
  }

  function drawEnd(win) {
    ctx.fillStyle = "rgba(4,7,18,0.72)"; ctx.fillRect(0, TOP, W, H - TOP);
    text(win ? "CORE STABILIZED!" : "CORE BREACH", W / 2, 178, "900 58px 'Segoe UI', sans-serif", win ? COL.good : COL.bad);
    text(win ? "Campaign complete — five storms weathered, the Ferrous Heart stilled. The reactor hums your name."
             : "The shards scattered your core across the arena.", W / 2, 226, "17px 'Segoe UI', sans-serif", COL.text);
    text("FINAL SCORE   " + state.score, W / 2, 282, "bold 30px 'Segoe UI', sans-serif", COL.text);
    var st = state.stats;
    text("Captures " + st.captures + "   ·   Shatters " + st.shatters + "   ·   Mine smashes " + st.mineSmashes + "   ·   Twincores split " + st.splits + "   ·   Lens flips " + st.lensFlips + "   ·   Wardens felled " + st.bosses + "   ·   Overloads " + st.overloads,
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
    for (i = 0; i < state.lenses.length; i++) {
      if (state.mode === "deploy" && i === deployGhost.carryingLens) continue;
      drawLens(state.lenses[i], false);
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
    if (state.mode === "playing" && state.chapterBanner > 0) {
      // chapter card: the chapter's name, its story beat, the idea it
      // teaches, its named set-piece and the wave — the campaign's
      // table of contents, shown at every chapter door
      var ch = chapterFor(state.wave);
      ctx.globalAlpha = Math.min(1, state.chapterBanner);
      text("CHAPTER " + ch.num, W / 2, 100, "bold 15px 'Segoe UI', sans-serif", themeFor(state.wave).accent);
      text(ch.name, W / 2, 134, "900 40px 'Segoe UI', sans-serif", COL.text);
      text(ch.story, W / 2, 164, "italic 15px 'Segoe UI', sans-serif", COL.text);
      text(ch.line, W / 2, 188, "14px 'Segoe UI', sans-serif", COL.dim);
      text("⚜ SET-PIECE — " + ch.event, W / 2, 214, "bold 13px 'Segoe UI', sans-serif", themeFor(state.wave).accent);
      text("— WAVE " + state.wave + " —", W / 2, 238, "bold 12px 'Segoe UI', sans-serif", COL.dim);
      ctx.globalAlpha = 1;
    } else if (state.mode === "playing" && state.waveBanner > 0) {
      ctx.globalAlpha = Math.min(1, state.waveBanner);
      text("WAVE " + state.wave, W / 2, 130, "900 46px 'Segoe UI', sans-serif", COL.text);
      ctx.globalAlpha = 1;
    }
    if (state.mode === "playing" && state.setpieceT < 3.2) drawSetpiece();
    if (state.mode === "playing" && state.bossBanner > 0) {
      // boss intro banner: the fight announces itself before it lands
      ctx.globalAlpha = Math.min(1, state.bossBanner);
      text(state.bossHeart ? "⚠  THE FERROUS HEART  ⚠" : "⚠  STORM WARDEN  ⚠", W / 2, 258, "900 34px 'Segoe UI', sans-serif", state.bossHeart ? "#ff7847" : COL.twin);
      text(state.bossHeart ? "the heart of the storm — still it, and the sky clears"
                           : "a chapter warden — break its hull " + state.bossMaxHp + " times", W / 2, 290, "italic 14px 'Segoe UI', sans-serif", COL.text);
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
    // test hook: the maker's harness may set __FERRO_SPEED to step the
    // simulation several fixed steps per frame (long bot runs); absent
    // the hook the game steps exactly once, as shipped.
    var steps = 1;
    if (typeof window.__FERRO_SPEED === "number") {
      steps = Math.max(1, Math.min(6, Math.round(window.__FERRO_SPEED)));
    }
    for (var k = 0; k < steps; k++) update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // test/debug handle (used by the maker's own play-verification harness)
  window.__FERRO = {
    get state() { return state; },
    get player() { return player; },
    get ghost() { return deployGhost; },
    get chapters() { return CHAPTERS; },
    startRun: startRun,
    confirmDeploy: confirmDeploy,
    enterDeploy: enterDeploy,
    beginWave: beginWave,
    deployClick: deployClick
  };
})();
