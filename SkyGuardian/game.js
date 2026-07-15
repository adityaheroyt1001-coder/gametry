/* ==========================================================================
   SKY GUARDIAN — vanilla Canvas 2D game
   A 5-level campaign: dynamic cinematic chase camera, varied enemy types,
   boss fights with telegraphed attack patterns, and a persistent upgrade
   shop between levels. Fixed-timestep simulation, mobile + keyboard +
   gamepad-friendly.
   ========================================================================== */

(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // Asset manifest
  // ---------------------------------------------------------------------
  const ASSET_LIST = {
    heroIdle: "assets/hero/idle.png",
    heroFly: "assets/hero/fly.png",
    drone: "assets/enemies/krypto.png",
    boss1: "assets/enemies/boss.png",
    boss2: "assets/enemies/boss 2.png",
    boss3: "assets/enemies/boss 3.png",
    canon: "assets/enemies/canon.png",
    sky: "assets/backgrounds/sky_bg.svg",
    background2: "assets/backgrounds/background 2.png",
    background3: "assets/backgrounds/background 3.png",
    background4: "assets/backgrounds/background 4.png",
    island: "assets/backgrounds/island.png",
    bird: "assets/backgrounds/unicorn.png",
    coin: "assets/ui/coin.svg",
    crystal: "assets/ui/crystal.svg",
    heart: "assets/ui/heart.svg",
    lightning: "assets/effects/lightning.svg",
    explosion: "assets/effects/explosion.svg",
    rockWhole: "assets/skyrock/sky_rock_whole.svg",
    rockBroken: "assets/skyrock/sky_rock_broken.svg",
  };

  const SOUND_LIST = {
    start: "assets/sounds/start.mp3",
    over: "assets/sounds/over.mp3",
    powerup: "assets/sounds/powerup.mp3",
    fire: "assets/sounds/fire.wav",
    coin: "assets/sounds/coin.mp3",
    heroHit: "assets/sounds/hero hit.mp3",
    sonicBoom: "assets/sounds/sonic boom.wav",
    bossHurt: "assets/sounds/boss hurt.wav",
    bgm: "assets/sounds/bgm.mp3",
  };

  const images = {};
  const sounds = {};
  let musicVolume = Number(localStorage.getItem("skyguardian_music_vol") ?? 0.5);
  let sfxVolume = Number(localStorage.getItem("skyguardian_sfx_vol") ?? 1);
  let assetsLoaded = 0;
  let bgmStarted = false;
  const assetKeys = Object.keys(ASSET_LIST);
  const soundKeys = Object.keys(SOUND_LIST);
  const totalAssets = assetKeys.length + soundKeys.length;

  function playSound(key) {
    if (sounds[key]) {
      try {
        sounds[key].currentTime = 0;
        sounds[key].play().catch(() => {});
      } catch (e) {}
    }
  }

  function playBgm(forceRestart = false) {
    if (!sounds.bgm) return;
    try {
      const bgm = sounds.bgm;
      bgm.loop = true;
      bgm.volume = musicVolume;
      if (forceRestart) {
        bgm.currentTime = 0;
      }
      if (bgm.paused && document.visibilityState !== "hidden" && document.hasFocus()) {
        const p = bgm.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
      if (!bgmStarted) bgmStarted = true;
    } catch (e) {}
  }

  function loadAssets(onDone) {
    let done = false;
    const tick = () => {
      assetsLoaded++;
      if (assetsLoaded === totalAssets && !done) { done = true; onDone(); }
    };
    assetKeys.forEach((key) => {
      const img = new Image();
      img.onload = tick;
      img.onerror = tick;
      img.src = ASSET_LIST[key];
      images[key] = img;
    });
    soundKeys.forEach((key) => {
      const audio = new Audio();
      audio.onloadeddata = tick;
      audio.onerror = tick;
      audio.src = SOUND_LIST[key];
      audio.preload = "auto";
      if (key === "bgm") {
        audio.loop = true;
        audio.volume = musicVolume;
      }
      sounds[key] = audio;
    });
    // safety net: don't block boot forever on a slow/missing asset
    setTimeout(() => { if (!done) { done = true; onDone(); } }, 4000);
  }

  function imgOk(img) { return img && img.complete && img.naturalWidth > 0; }

  let activeBackgroundKey = "sky";
  const backgroundKeys = ["sky", "background2", "background3", "background4"];

  const startBgmOnInteraction = () => {
    playBgm(true);
    window.removeEventListener("pointerdown", startBgmOnInteraction);
    window.removeEventListener("keydown", startBgmOnInteraction);
  };
  window.addEventListener("pointerdown", startBgmOnInteraction);
  window.addEventListener("keydown", startBgmOnInteraction);

  function requestFullscreenLandscape() {
    const el = document.documentElement;
    const reqFs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    try {
      if (reqFs && !document.fullscreenElement) reqFs.call(el).catch(() => {});
    } catch (e) {}
    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock("landscape").catch(() => {});
      }
    } catch (e) {}
  }
  const tryAutoFullscreen = () => {
    if ("ontouchstart" in window || navigator.maxTouchPoints > 0) requestFullscreenLandscape();
    window.removeEventListener("pointerdown", tryAutoFullscreen);
  };
  window.addEventListener("pointerdown", tryAutoFullscreen);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") playBgm(true);
  });
  window.addEventListener("focus", () => playBgm(true));

  // ---------------------------------------------------------------------
  // Canvas + responsive setup
  // ---------------------------------------------------------------------
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const DPR_CAP = 2;
  let W = 0, H = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    const rect = document.getElementById("game-wrap").getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  resize();

  // ---------------------------------------------------------------------
  // Input — physical key codes, touch virtual stick, gamepad
  // ---------------------------------------------------------------------
  const BIND = {
    KeyW: "up", ArrowUp: "up",
    KeyS: "down", ArrowDown: "down",
    KeyA: "left", ArrowLeft: "left",
    KeyD: "right", ArrowRight: "right",
    KeyF: "fire",
    KeyE: "shield",
    KeyP: "pause", Escape: "pause",
    Enter: "confirm", Space: "confirm",
  };
  const held = new Set();
  const pressedOnce = new Set();

  window.addEventListener("keydown", (e) => {
    const cmd = BIND[e.code];
    if (!cmd) return;
    if (["up", "down", "left", "right"].includes(cmd)) e.preventDefault();
    if (!held.has(cmd)) pressedOnce.add(cmd);
    held.add(cmd);
  });
  window.addEventListener("keyup", (e) => {
    const cmd = BIND[e.code];
    if (cmd) held.delete(cmd);
  });

  const stickEl = document.getElementById("touchStick");
  const knobEl = stickEl.querySelector(".knob");
  let stickActive = false;
  let stickVec = { x: 0, y: 0 };
  let stickTouchId = null;
  const STICK_RADIUS = 52;

  function isTouchDevice() {
    return "ontouchstart" in window || navigator.maxTouchPoints > 0;
  }
  if (isTouchDevice()) document.body.classList.add("touch-mode");

  function stickCenter() {
    const r = stickEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function updateStick(clientX, clientY) {
    const c = stickCenter();
    let dx = clientX - c.x;
    let dy = clientY - c.y;
    const dist = Math.hypot(dx, dy);
    if (dist > STICK_RADIUS) {
      dx = (dx / dist) * STICK_RADIUS;
      dy = (dy / dist) * STICK_RADIUS;
    }
    knobEl.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`;
    stickVec.x = dx / STICK_RADIUS;
    stickVec.y = dy / STICK_RADIUS;
  }
  function resetStick() {
    stickActive = false;
    stickTouchId = null;
    stickVec.x = 0; stickVec.y = 0;
    knobEl.style.transform = "translate(-50%, -50%)";
  }
  stickEl.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    stickActive = true;
    stickTouchId = t.identifier;
    updateStick(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });
  stickEl.addEventListener("touchmove", (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickTouchId) updateStick(t.clientX, t.clientY);
    }
    e.preventDefault();
  }, { passive: false });
  stickEl.addEventListener("touchend", (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickTouchId) resetStick();
    }
    e.preventDefault();
  }, { passive: false });
  stickEl.addEventListener("touchcancel", resetStick);

  function bindActionButton(button, action) {
    const activate = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (button.setPointerCapture) button.setPointerCapture(e.pointerId);
      button.classList.add("pressed");
      if (!held.has(action)) pressedOnce.add(action);
      held.add(action);
    };
    const deactivate = (e) => {
      e.preventDefault();
      e.stopPropagation();
      button.classList.remove("pressed");
      held.delete(action);
    };

    button.addEventListener("pointerdown", activate);
    button.addEventListener("pointerup", deactivate);
    button.addEventListener("pointercancel", deactivate);
    button.addEventListener("lostpointercapture", deactivate);
    button.addEventListener("click", (e) => e.preventDefault());
  }

  document.querySelectorAll(".actionBtn").forEach((btn) => {
    bindActionButton(btn, btn.dataset.action);
  });

  function gamepadVec() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const x = gp.axes[0] || 0;
      const y = gp.axes[1] || 0;
      if (Math.abs(x) > 0.15 || Math.abs(y) > 0.15) return { x, y };
      const dpadX = (gp.buttons[15]?.pressed ? 1 : 0) - (gp.buttons[14]?.pressed ? 1 : 0);
      const dpadY = (gp.buttons[13]?.pressed ? 1 : 0) - (gp.buttons[12]?.pressed ? 1 : 0);
      if (dpadX || dpadY) return { x: dpadX, y: dpadY };
    }
    return { x: 0, y: 0 };
  }

  function inputVector() {
    let x = 0, y = 0;
    if (held.has("left")) x -= 1;
    if (held.has("right")) x += 1;
    if (held.has("up")) y -= 1;
    if (held.has("down")) y += 1;
    if (stickActive) { x += stickVec.x; y += stickVec.y; }
    const gp = gamepadVec();
    x += gp.x; y += gp.y;
    x = Math.max(-1, Math.min(1, x));
    y = Math.max(-1, Math.min(1, y));
    return { x, y };
  }

  // ---------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const choice = (arr) => arr[(Math.random() * arr.length) | 0];
  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  function circleHit(ax, ay, ar, bx, by, br) {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy < (ar + br) * (ar + br);
  }
  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // ---------------------------------------------------------------------
  // Meta progression (persists across runs)
  // ---------------------------------------------------------------------
  const UPGRADES = [
    { key: "hp", name: "Vitality Core", desc: "+1 max health", max: 4, baseCost: 60, icon: "❤" },
    { key: "fireRate", name: "Rapid Charger", desc: "Faster fire rate", max: 5, baseCost: 50, icon: "🔥" },
    { key: "dmg", name: "Overcharge Rounds", desc: "+1 shot damage", max: 3, baseCost: 80, icon: "💥" },
    { key: "speed", name: "Thruster Tuning", desc: "+Move speed", max: 5, baseCost: 45, icon: "🚀" },
  ];
  function upgradeCost(def, level) {
    return Math.round(def.baseCost * Math.pow(1.55, level));
  }
  function loadMeta() {
    try {
      const raw = localStorage.getItem("skyguardian_meta_v2");
      if (raw) {
        const m = JSON.parse(raw);
        return { coins: m.coins || 0, upg: Object.assign({ hp: 0, fireRate: 0, dmg: 0, speed: 0 }, m.upg || {}) };
      }
    } catch (e) {}
    return { coins: 0, upg: { hp: 0, fireRate: 0, dmg: 0, speed: 0 } };
  }
  function saveMeta() {
    try { localStorage.setItem("skyguardian_meta_v2", JSON.stringify(meta)); } catch (e) {}
  }
  let meta = loadMeta();
  let bestRunScore = Number(localStorage.getItem("skyguardian_best_v2") || 0);
  let bestSurvivalScore = Number(localStorage.getItem("skyguardian_survival_best_v1") || 0);

  // ---------------------------------------------------------------------
  // Level campaign definition
  // ---------------------------------------------------------------------
  const BOSS_ROSTER = [
    { name: "Sentinel Drone", color: "#ff5c3d" },
    { name: "Stormhawk", color: "#7fd4ff" },
    { name: "Ember Colossus", color: "#ff8c2e" },
    { name: "Frost Warden", color: "#9be8ff" },
    { name: "Voidbringer", color: "#c07fff" },
    { name: "Iron Leviathan", color: "#b0b8c9" },
    { name: "Solar Wyrm", color: "#ffd83d" },
    { name: "Abyss Kraken", color: "#3fd1c0" },
    { name: "Crimson Marauder", color: "#e8402a" },
    { name: "Glass Seraph", color: "#d9f0ff" },
    { name: "Magma Titan", color: "#ff6a2e" },
    { name: "Nebula Phantom", color: "#a888ff" },
    { name: "Rust Behemoth", color: "#c98a4b" },
    { name: "Tempest Queen", color: "#5fc9ff" },
    { name: "Obsidian Reaver", color: "#6a5acd" },
    { name: "Ashen Colossus", color: "#ff9a5c" },
    { name: "Verdant Horror", color: "#7cff8a" },
    { name: "Chrono Warden", color: "#ffe873" },
    { name: "Eclipse Harbinger", color: "#8c1aff" },
    { name: "The Last Sentinel", color: "#ffffff" },
  ];
  const SKY_PALETTES = [
    ["#8fd8ff", "#e9fbff"],
    ["#4f7fc9", "#a9d4ea"],
    ["#c9531f", "#ffcf8a"],
    ["#7fa8c9", "#eef8ff"],
    ["#1a1240", "#4a2f7a"],
  ];
  const LEVEL_NAMES = [
    "Cloudreach", "Storm Reef", "Ember Wastes", "Frost Spire", "Void Ascension",
    "Iron Causeway", "Solar Rift", "Abyssal Trench", "Crimson Straits", "Glass Highlands",
    "Magma Basin", "Nebula Fold", "Rust Belt", "Tempest Coast", "Obsidian Gate",
    "Ashen Vale", "Verdant Rift", "Chrono Fields", "Eclipse Reach", "Final Ascent",
  ];
  function buildLevels(count) {
    const arr = [];
    for (let i = 0; i < count; i++) {
      const boss = BOSS_ROSTER[i % BOSS_ROSTER.length];
      const sky = SKY_PALETTES[i % SKY_PALETTES.length];
      const spawnMix = { scout: 1 };
      if (i >= 1) spawnMix.interceptor = Math.min(0.5, 0.3 + i * 0.02);
      if (i >= 3) spawnMix.tank = Math.min(0.4, 0.2 + i * 0.015);
      if (i >= 5) spawnMix.turret = Math.min(0.45, 0.2 + i * 0.015);
      if (spawnMix.interceptor || spawnMix.tank || spawnMix.turret) spawnMix.scout = 0.5;
      const patternsPool = ["volley", "snipe", "charge", "spiral", "summon"];
      const patternCount = Math.min(patternsPool.length, 3 + Math.floor(i / 4));
      const patterns = [];
      for (let p = 0; p < patternCount; p++) patterns.push(patternsPool[p % patternsPool.length]);
      arr.push({
        name: LEVEL_NAMES[i] || `Sector ${i + 1}`,
        subtitle: i === count - 1 ? "The final watch. Nothing beyond it." : "The skies grow harsher here.",
        objective: `Score ${300 + i * 130} to summon ${boss.name}.`,
        targetScore: 300 + i * 130,
        scrollSpeedBase: Math.min(700, 260 + i * 16),
        spawnMix, sky,
        boss: {
          name: boss.name,
          maxHP: Math.round(44 + i * 20 * Math.pow(0.97, i)),
          color: boss.color,
          patterns,
          intervalMul: Math.max(0.42, 0.95 - i * 0.028),
          canSummon: i >= 3,
        },
        rewardCoins: 90 + i * 32,
      });
    }
    return arr;
  }
  const LEVELS = buildLevels(20);

  const SURVIVAL_LEVEL = {
    name: "Endless Skies", subtitle: "Survive as long as you can.",
    objective: "No boss. Just survive.",
    targetScore: Infinity, scrollSpeedBase: 260,
    spawnMix: { scout: 1 },
    sky: ["#2b3a67", "#7fa8c9"],
    boss: { name: "—", maxHP: 0, color: "#fff", patterns: [], intervalMul: 1 },
    rewardCoins: 0,
  };

  const ENEMY_TYPES = {
    scout: { r: 34, hp: 1, speedMul: 1.0, score: 35, coinChance: 0 },
    interceptor: { r: 22, hp: 1, speedMul: 1.65, score: 45, coinChance: 0 },
    tank: { r: 46, hp: 3, speedMul: 0.55, score: 75, coinChance: 0 },
    turret: { r: 30, hp: 2, speedMul: 0.35, score: 55, coinChance: 0 },
  };

  // ---------------------------------------------------------------------
  // Game constants
  // ---------------------------------------------------------------------
  const SPEEDUP_INTERVAL = 22;
  const SPEEDUP_FACTOR = 1.13;
  const BOOST_DURATION = 5;
  const BOOST_MULT = 1.75;
  const FIRE_COOLDOWN_BASE = 0.18;
  const FIRE_SPEED = 980;
  const FIRE_LIFE = 1.2;
  const INVULN_DURATION = 1.3;
  const HERO_SPEED_BASE = 480;
  const ENEMY_SHOT_SPEED = 340;
  const FIRE_CHARGE_TIME = 0.85;
  const SONIC_COOLDOWN = 4.5;
  const SONIC_LIFE = 0.9;
  const SONIC_SPEED = 620;
  const SHIELD_ABILITY_DURATION = 5;
  const SHIELD_ABILITY_COOLDOWN = 12;
  const BOSS_DEATH_DURATION = 1.1;

  function currentMaxHealth() { return 3 + meta.upg.hp; }
  function currentFireCooldown() { return FIRE_COOLDOWN_BASE * Math.pow(0.88, meta.upg.fireRate); }
  function currentShotDamage() { return 1 + meta.upg.dmg; }
  function currentHeroSpeed() { return HERO_SPEED_BASE * (1 + 0.07 * meta.upg.speed); }

  // ---------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------
  const STATE = {
    MENU: "menu", LEVEL_INTRO: "level_intro", PLAYING: "playing", PAUSED: "paused",
    LEVEL_COMPLETE: "level_complete", SHOP: "shop", GAMEOVER: "gameover", VICTORY: "victory",
  };
  let state = STATE.MENU;
  let gameMode = "levels"; // "levels" | "survival"
  let levelIndex = 0;
  let levelPhase = "running"; // 'running' | 'boss'
  let level = LEVELS[0];

  let hero, enemies, enemyShots, coins, crystals, islands, birds, skyrocks, particles, shots, boss, motes, collectibles;
  let scrollSpeed, elapsed, score, health, nextSpeedupAt, boostTimer, invulnTimer, magnetTimer, shieldTimer;
  let fireCharging, fireCharge, sonicCooldown, shieldAbilityCooldown, sonicShots;
  let spawnTimers;
  let shake = 0;
  let runScore = 0;
  let cam = { zoom: 1, zoomV: 1, rot: 0, leadX: 0, leadY: 0 };

  function freshHero() {
    return {
      x: 150, y: H / 2, targetX: 150, targetY: H / 2,
      r: 34, bob: 0, tilt: 0, fireTimer: 0,
    };
  }

  function resetLevel(idx, keepRunScore) {
    gameMode = "levels";
    levelIndex = idx;
    level = LEVELS[idx];
    levelPhase = "running";
    hero = freshHero();
    enemies = []; enemyShots = []; coins = []; crystals = [];
    islands = []; birds = []; skyrocks = []; particles = []; shots = [];
    motes = []; collectibles = [];
    boss = null;
    scrollSpeed = level.scrollSpeedBase;
    elapsed = 0;
    score = 0;
    if (!keepRunScore) runScore = 0;
    health = currentMaxHealth();
    nextSpeedupAt = SPEEDUP_INTERVAL;
    boostTimer = 0;
    invulnTimer = 0;
    magnetTimer = 0;
    shieldTimer = 0;
    fireCharging = false;
    fireCharge = 0;
    sonicCooldown = 0;
    shieldAbilityCooldown = 0;
    sonicShots = [];
    activeBackgroundKey = backgroundKeys[(Math.random() * backgroundKeys.length) | 0];
    shake = 0;
    cam = { zoom: 1, zoomV: 1, rot: 0, leadX: 0, leadY: 0 };
    spawnTimers = { enemy: 1.0, coin: 0.35, crystal: 5, island: 0, bird: 1.5, skyrock: 7.5 };
    for (let i = 0; i < 5; i++) {
      islands.push({ x: W * 0.5 + i * 420, y: rand(H * 0.55, H * 0.92), scale: rand(0.7, 1.2), bobPhase: rand(0, 6) });
    }
    for (let i = 0; i < 2; i++) {
      birds.push({ x: W * 0.6 + i * 380, y: rand(40, H * 0.55), flap: rand(0, Math.PI * 2) });
    }
    for (let i = 0; i < 2; i++) {
      skyrocks.push({ x: W + 120 + i * 460, y: rand(90, H - 120), r: 84, broken: false, loot: pickRockLoot() });
    }
    for (let i = 0; i < 26; i++) {
      motes.push({ x: rand(0, W), y: rand(0, H), r: rand(1, 3.2), depth: rand(0.15, 0.6), phase: rand(0, 6) });
    }
    buildHealthBar();
    updateHUD();
    const cw = document.getElementById("chargeMeterWrap");
    if (cw) cw.classList.remove("show");
  }

  function resetSurvival() {
    gameMode = "survival";
    levelIndex = -1;
    level = SURVIVAL_LEVEL;
    levelPhase = "running";
    hero = freshHero();
    enemies = []; enemyShots = []; coins = []; crystals = [];
    islands = []; birds = []; skyrocks = []; particles = []; shots = [];
    motes = []; collectibles = []; sonicShots = [];
    boss = null;
    scrollSpeed = level.scrollSpeedBase;
    elapsed = 0; score = 0; runScore = 0;
    health = currentMaxHealth();
    nextSpeedupAt = SPEEDUP_INTERVAL;
    boostTimer = 0; invulnTimer = 0; magnetTimer = 0; shieldTimer = 0;
    fireCharging = false; fireCharge = 0; sonicCooldown = 0; shieldAbilityCooldown = 0;
    activeBackgroundKey = backgroundKeys[(Math.random() * backgroundKeys.length) | 0];
    shake = 0;
    cam = { zoom: 1, zoomV: 1, rot: 0, leadX: 0, leadY: 0 };
    spawnTimers = { enemy: 1.0, coin: 0.35, crystal: 5, island: 0, bird: 1.5, skyrock: 7.5 };
    for (let i = 0; i < 5; i++) islands.push({ x: W * 0.5 + i * 420, y: rand(H * 0.55, H * 0.92), scale: rand(0.7, 1.2), bobPhase: rand(0, 6) });
    for (let i = 0; i < 2; i++) birds.push({ x: W * 0.6 + i * 380, y: rand(40, H * 0.55), flap: rand(0, Math.PI * 2) });
    for (let i = 0; i < 2; i++) skyrocks.push({ x: W + 120 + i * 460, y: rand(90, H - 120), r: 84, broken: false, loot: pickRockLoot() });
    for (let i = 0; i < 26; i++) motes.push({ x: rand(0, W), y: rand(0, H), r: rand(1, 3.2), depth: rand(0.15, 0.6), phase: rand(0, 6) });
    buildHealthBar();
    updateHUD();
    const cw2 = document.getElementById("chargeMeterWrap");
    if (cw2) cw2.classList.remove("show");
  }

  // ---------------------------------------------------------------------
  // Spawning — regular enemies & pickups
  // ---------------------------------------------------------------------
  function pickEnemyType() {
    const entries = Object.entries(level.spawnMix);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [k, w] of entries) { if (r < w) return k; r -= w; }
    return entries[0][0];
  }

  function difficultyMul() {
    if (gameMode === "survival") return Math.min(3.4, 1 + (elapsed / 60) * 0.9);
    return Math.min(3.2, 1 + levelIndex * 0.11);
  }

  function spawnEnemy() {
    const type = pickEnemyType();
    const def = ENEMY_TYPES[type];
    const y = rand(80, H - 80);
    const dMul = difficultyMul();
    const e = {
      type, x: W + 60, y, baseY: y, r: def.r, hp: def.hp, maxHp: def.hp,
      speedMul: def.speedMul * rand(0.92, 1.15) * dMul, hitFlash: 0,
      wobble: rand(0, Math.PI * 2), wobbleSpeed: rand(1.2, 2.4) * Math.min(1.3, dMul), wobbleAmp: rand(20, 55),
      fireTimer: rand(1.2, 2.2) / dMul, rot: 0,
    };
    enemies.push(e);
  }
  function spawnCoin() {
    coins.push({ x: W + 40, y: rand(60, H - 60), r: 18, spin: rand(0, Math.PI * 2), wave: rand(0, Math.PI * 2) });
  }
  function spawnCrystal() {
    crystals.push({ x: W + 40, y: rand(80, H - 80), r: 22, spin: rand(0, Math.PI * 2) });
  }
  function pickRockLoot() {
    const r = Math.random();
    if (r < 0.3) return "none";
    if (r < 0.55) return "coin";
    if (r < 0.75) return "crystal";
    if (r < 0.85) return "heart";
    if (r < 0.93) return "magnet";
    return "shield";
  }

  function spawnCollectible(x, y, type) {
    collectibles.push({ x, y, r: 16, type, spin: rand(0, Math.PI * 2) });
  }

  function crackRock(rock) {
    if (rock.broken) return;
    rock.broken = true;
    playSound("fire");
    spawnBurst(rock.x, rock.y, "#ff8c2e", 10);
    score += 20;
    if (rock.loot === "coin") {
      score += 30; meta.coins += 12; saveMeta();
      spawnBurst(rock.x, rock.y, "#ffe873", 16);
      playSound("coin");
    } else if (rock.loot === "crystal") {
      score += 25; meta.coins += 8; saveMeta();
      boostTimer = BOOST_DURATION;
      spawnBurst(rock.x, rock.y, "#7ff4ff", 22);
      playSound("powerup");
    } else if (rock.loot === "heart") {
      if (health < currentMaxHealth()) { health += 1; }
      else { score += 60; meta.coins += 15; saveMeta(); }
      spawnBurst(rock.x, rock.y, "#ff6a8a", 24);
      playSound("powerup");
    } else if (rock.loot === "magnet") {
      spawnCollectible(rock.x, rock.y, "magnet");
      spawnBurst(rock.x, rock.y, "#b59cff", 18);
      playSound("powerup");
    } else if (rock.loot === "shield") {
      spawnCollectible(rock.x, rock.y, "shield");
      spawnBurst(rock.x, rock.y, "#7fe7ff", 18);
      playSound("powerup");
    }
  }

  function spawnIsland() {
    islands.push({ x: W + 200, y: rand(H * 0.5, H * 0.9), scale: rand(0.6, 1.2), bobPhase: 0 });
  }
  function spawnBird() {
    birds.push({ x: W + 60, y: rand(40, H * 0.5), flap: rand(0, Math.PI * 2) });
  }
  function spawnSkyrock() {
    skyrocks.push({ x: W + 120, y: rand(90, H - 120), r: 84, broken: false, loot: pickRockLoot() });
  }
  function spawnBurst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const ang = rand(0, Math.PI * 2);
      const spd = rand(60, 220);
      particles.push({ x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: rand(0.4, 0.9), age: 0, color, size: rand(2, 5) });
    }
  }
  function spawnExplosion(x, y, big) {
    particles.push({ x, y, explosion: true, age: 0, life: big ? 0.75 : 0.5, big });
    spawnBurst(x, y, "#ffb23d", big ? 30 : 18);
    spawnBurst(x, y, "#ff5c3d", big ? 18 : 10);
    shake = big ? 22 : 14;
  }

  function fireLaser() {
    hero.fireTimer = currentFireCooldown();
    shots.push({ x: hero.x + hero.r * 0.9, y: hero.y, vx: FIRE_SPEED, vy: 0, life: FIRE_LIFE });
    spawnBurst(hero.x + hero.r * 0.5, hero.y, "#ff8c2e", 6);
    playSound("fire");
  }

  function fireSonicBoom() {
    sonicCooldown = SONIC_COOLDOWN;
    sonicShots.push({ x: hero.x + hero.r, y: hero.y, vx: SONIC_SPEED, life: SONIC_LIFE, age: 0, hitEnemies: new Set() });
    shake = Math.max(shake, 16);
    spawnBurst(hero.x + hero.r, hero.y, "#fff487", 26);
    playSound("sonicBoom");
  }

  function handleFireInput(dt) {
    const chargeWrap = document.getElementById("chargeMeterWrap");
    const chargeFill = document.getElementById("chargeMeterFill");
    if (held.has("fire") && sonicCooldown <= 0) {
      fireCharging = true;
      fireCharge = Math.min(FIRE_CHARGE_TIME, fireCharge + dt);
      if (chargeWrap) chargeWrap.classList.add("show");
      if (chargeFill) chargeFill.style.width = (fireCharge / FIRE_CHARGE_TIME) * 100 + "%";
      return;
    }
    if (fireCharging) {
      fireCharging = false;
      if (chargeWrap) chargeWrap.classList.remove("show");
      if (chargeFill) chargeFill.style.width = "0%";
      if (fireCharge >= FIRE_CHARGE_TIME) fireSonicBoom();
      else if (hero.fireTimer <= 0) fireLaser();
      fireCharge = 0;
      return;
    }
    if (pressedOnce.has("fire") && hero.fireTimer <= 0) fireLaser();
  }

  function fireEnemyShotAt(x, y, tx, ty, color, fast) {
    const dx = tx - x, dy = ty - y;
    const d = Math.hypot(dx, dy) || 1;
    const spd = fast ? ENEMY_SHOT_SPEED * 2.1 : ENEMY_SHOT_SPEED;
    enemyShots.push({ x, y, vx: (dx / d) * spd, vy: (dy / d) * spd, life: 3, color: color || "#c07fff", fast: !!fast, trail: [] });
  }

  // ---------------------------------------------------------------------
  // Boss
  // ---------------------------------------------------------------------
  let bossImageCycle = 0;
  const bossImageKeys = ["boss1", "boss2"];

  function spawnBoss() {
    const b = level.boss;
    const imageKey = bossImageKeys[bossImageCycle % bossImageKeys.length];
    const boss3Image = images.boss3;
    const chosenImageKey = boss3Image && bossImageCycle % 3 === 0 ? "boss3" : imageKey;
    bossImageCycle += 1;
    boss = {
      name: b.name, color: b.color, patterns: b.patterns, intervalMul: b.intervalMul, canSummon: !!b.canSummon,
      x: W + 220, y: H / 2, homeX: W - 190, r: 78,
      hp: b.maxHP, maxHp: b.maxHP, spin: 0, hitFlash: 0, telegraph: 0,
      patternIdx: 0, patternTimer: rand(1.6, 2.2) * b.intervalMul, chargeTarget: H / 2,
      entering: true, imageKey: chosenImageKey, image: images[chosenImageKey],
    };
    document.getElementById("bossBar").classList.add("show");
    document.getElementById("bossName").textContent = b.name;
  }

  function startBossDeath() {
    if (!boss || boss.dying) return;
    boss.dying = true;
    boss.dyingTimer = BOSS_DEATH_DURATION;
    boss.dustSpawnAcc = 0;
    shake = Math.max(shake, 20);
    playSound("powerup");
    document.getElementById("bossFill").style.width = "0%";
  }

  function spawnDustPuff(cx, cy, radius) {
    const ang = rand(0, Math.PI * 2);
    const dist = rand(0, radius);
    const x = cx + Math.cos(ang) * dist;
    const y = cy + Math.sin(ang) * dist;
    particles.push({
      x, y,
      vx: Math.cos(ang) * rand(10, 40),
      vy: Math.sin(ang) * rand(10, 40) - 18,
      life: rand(0.6, 1.1), age: 0,
      color: choice(["#c9a877", "#8f7a5c", "#e8d9b8", "#6f6252"]),
      size: rand(3, 7),
    });
  }

  function updateBossDeath(dt) {
    boss.dyingTimer -= dt;
    boss.dustSpawnAcc += dt;
    const puffInterval = 0.02;
    while (boss.dustSpawnAcc > puffInterval) {
      boss.dustSpawnAcc -= puffInterval;
      for (let i = 0; i < 3; i++) spawnDustPuff(boss.x, boss.y, boss.r * 1.1);
    }
    if (boss.dyingTimer <= 0) {
      spawnExplosion(boss.x, boss.y, true);
      for (let i = 0; i < 24; i++) spawnDustPuff(boss.x, boss.y, boss.r * 1.4);
      finishBossDefeat();
    }
  }

  function bossPattern(dt) {
    boss.spin += dt * 0.6;
    boss.hitFlash = Math.max(0, boss.hitFlash - dt * 4);
    if (boss.dying) {
      updateBossDeath(dt);
      return;
    }
    if (boss.entering) {
      boss.x = lerp(boss.x, boss.homeX, Math.min(1, dt * 1.6));
      if (Math.abs(boss.x - boss.homeX) < 3) boss.entering = false;
      return;
    }
    // gentle hover
    boss.y += Math.sin(elapsed * 1.3) * 12 * dt;
    boss.y = clamp(boss.y, 90, H - 90);

    boss.patternTimer -= dt;
    const telegraphWindow = 0.45;
    boss.telegraph = boss.patternTimer < telegraphWindow ? 1 - boss.patternTimer / telegraphWindow : 0;

    if (boss.patternTimer <= 0) {
      const pat = boss.patterns[boss.patternIdx % boss.patterns.length];
      boss.patternIdx++;
      if (pat === "volley") {
        // Aim a real spread fan AT the hero (fixes shots firing away from the player)
        const n = 5;
        const baseAngle = Math.atan2(hero.y - boss.y, hero.x - boss.x);
        for (let i = 0; i < n; i++) {
          const spread = (i - (n - 1) / 2) * 0.16;
          const ang = baseAngle + spread;
          const tx = boss.x + Math.cos(ang) * 600;
          const ty = boss.y + Math.sin(ang) * 600;
          fireEnemyShotAt(boss.x, boss.y, tx, ty, boss.color);
        }
        playSound("fire");
      } else if (pat === "snipe") {
        // Predictive aimed shot — leads the hero's current motion a little, hits harder/faster
        const leadX = hero.x + (hero.targetX - hero.x) * 2;
        const leadY = hero.y + (hero.targetY - hero.y) * 2;
        fireEnemyShotAt(boss.x, boss.y, leadX, leadY, "#fff2a8", true);
        playSound("fire");
      } else if (pat === "spiral") {
        // Full-circle bullet spiral — always dodgeable but demands active movement
        const n = 10;
        const rot = elapsed * 1.4;
        for (let i = 0; i < n; i++) {
          const ang = rot + (i / n) * Math.PI * 2;
          const tx = boss.x + Math.cos(ang) * 500;
          const ty = boss.y + Math.sin(ang) * 500;
          fireEnemyShotAt(boss.x, boss.y, tx, ty, boss.color);
        }
        playSound("fire");
      } else if (pat === "charge") {
        boss.chargeTarget = hero.y;
      } else if (pat === "summon" && boss.canSummon) {
        for (let i = 0; i < 2; i++) {
          enemies.push({
            type: "interceptor", x: boss.x - 40, y: boss.y + (i ? 60 : -60), baseY: boss.y,
            r: ENEMY_TYPES.interceptor.r, hp: 1, maxHp: 1, speedMul: 1.5, hitFlash: 0,
            wobble: 0, wobbleSpeed: 1.6, wobbleAmp: 30, fireTimer: 2, rot: 0,
          });
        }
      }
      boss.patternTimer = rand(2.0, 3.0) * boss.intervalMul;
    }

    if (boss.chargeTarget !== undefined && Math.abs(boss.y - boss.chargeTarget) > 4) {
      boss.y = lerp(boss.y, boss.chargeTarget, Math.min(1, dt * 3.2));
    }
  }

  // ---------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------
  function updateCamera(dt, iv) {
    let targetZoom = 1.1;
    if (boostTimer > 0) targetZoom = 1.22;
    if (fireCharging) targetZoom = lerp(targetZoom, 1.02, fireCharge / FIRE_CHARGE_TIME);
    if (levelPhase === "boss") targetZoom = 0.94;
    cam.zoom = lerp(cam.zoom, targetZoom, Math.min(1, dt * 2.2));
    cam.rot = lerp(cam.rot, hero.tilt * 0.35, Math.min(1, dt * 5));
    cam.leadX = lerp(cam.leadX, 90 + iv.x * 30, Math.min(1, dt * 2.5));
    cam.leadY = lerp(cam.leadY, iv.y * 40, Math.min(1, dt * 2.5));
  }

  function update(dt) {
    elapsed += dt;
    const iv = inputVector();
    updateCamera(dt, iv);

    if (levelPhase === "running" && elapsed >= nextSpeedupAt) {
      scrollSpeed *= SPEEDUP_FACTOR;
      nextSpeedupAt += SPEEDUP_INTERVAL;
    }

    if (boostTimer > 0) { boostTimer -= dt; document.getElementById("boostBadge").classList.add("show"); }
    else document.getElementById("boostBadge").classList.remove("show");
    if (hero.fireTimer > 0) hero.fireTimer = Math.max(0, hero.fireTimer - dt);
    if (invulnTimer > 0) invulnTimer -= dt;
    if (magnetTimer > 0) magnetTimer = Math.max(0, magnetTimer - dt);
    if (shieldTimer > 0) shieldTimer = Math.max(0, shieldTimer - dt);
    if (hero.fireTimer <= 0) document.getElementById("fireBadge").classList.add("show");
    else document.getElementById("fireBadge").classList.remove("show");

    if (sonicCooldown > 0) sonicCooldown = Math.max(0, sonicCooldown - dt);
    if (shieldAbilityCooldown > 0) shieldAbilityCooldown = Math.max(0, shieldAbilityCooldown - dt);
    const shieldBadgeEl = document.getElementById("shieldBadge");
    if (shieldBadgeEl) shieldBadgeEl.classList.toggle("show", shieldAbilityCooldown <= 0 && shieldTimer <= 0);

    const effectiveSpeed = scrollSpeed * (boostTimer > 0 ? BOOST_MULT : 1);

    const HERO_SPEED = currentHeroSpeed();
    hero.targetX = clamp(hero.targetX + iv.x * HERO_SPEED * dt, 70, W * 0.72);
    hero.targetY = clamp(hero.targetY + iv.y * HERO_SPEED * dt, 50, H - 50);
    hero.x = lerp(hero.x, hero.targetX, Math.min(1, dt * 8));
    hero.y = lerp(hero.y, hero.targetY, Math.min(1, dt * 8));
    hero.tilt = clamp((hero.targetY - hero.y) * 0.02 + iv.x * 0.15, -0.5, 0.5);
    hero.bob += dt * 5;
    particles.push({
      x: hero.x - hero.r * 0.9, y: hero.y + Math.sin(hero.bob) * 4,
      vx: -80 - Math.abs(effectiveSpeed) * 0.12, vy: rand(-8, 8),
      life: rand(0.25, 0.45), age: 0,
      color: boostTimer > 0 ? "#fff487" : "#7fd4ff",
      size: rand(2, 4),
    });

    const scroll = (arr, mul = 1) => { for (const e of arr) e.x -= effectiveSpeed * mul * dt; };
    scroll(coins); scroll(crystals); scroll(islands, 0.5); scroll(birds, 0.7); scroll(skyrocks, 0.65); scroll(collectibles, 0.9);
    for (const m of motes) {
      m.x -= effectiveSpeed * m.depth * 0.4 * dt;
      m.phase += dt;
      if (m.x < -10) { m.x = W + 10; m.y = rand(0, H); }
    }

    for (const isl of islands) isl.bobPhase += dt;
    for (const b of birds) b.flap += dt * 6;
    for (const c of coins) { c.spin += dt * 3; c.wave += dt * 2; c.y += Math.sin(c.wave) * 12 * dt; }
    for (const c of crystals) c.spin += dt * 2.4;
    for (const c of collectibles) { c.spin += dt * 4; c.y += Math.sin(c.spin * 1.2) * 8 * dt; }
    if (magnetTimer > 0) {
      for (const c of coins) {
        const pull = 1 + magnetTimer / 5;
        const dx = hero.x - c.x;
        const dy = hero.y - c.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        c.x += (dx / dist) * 220 * pull * dt;
        c.y += (dy / dist) * 220 * pull * dt;
      }
    }

    // --- enemy behavior + scroll ---
    for (const e of enemies) {
      e.hitFlash = Math.max(0, e.hitFlash - dt * 5);
      const speed = effectiveSpeed * e.speedMul;
      if (e.type === "scout") {
        e.x -= speed * dt;
        e.wobble += e.wobbleSpeed * dt;
        e.y = e.baseY + Math.sin(e.wobble) * e.wobbleAmp;
      } else if (e.type === "interceptor") {
        e.x -= speed * dt;
        e.y = lerp(e.y, hero.y, Math.min(1, dt * 1.1));
        e.rot = Math.atan2(hero.y - e.y, -1) * 0.15;
      } else if (e.type === "tank") {
        e.x -= speed * dt;
      } else if (e.type === "turret") {
        e.x -= speed * dt;
        e.fireTimer -= dt;
        if (e.fireTimer <= 0 && levelPhase === "running") {
          fireEnemyShotAt(e.x, e.y, hero.x, hero.y, "#7fd4ff");
          e.fireTimer = rand(1.7, 2.5) / difficultyMul();
        }
      }
    }

    // --- spawning ---
    if (levelPhase === "running") {
      spawnTimers.enemy -= dt;
      if (spawnTimers.enemy <= 0) { spawnEnemy(); spawnTimers.enemy = clamp((rand(1.5, 2.4) - elapsed / 110) / difficultyMul(), 0.32, 3); }
    } else if (boss) {
      bossPattern(dt);
    }
    spawnTimers.coin -= dt;
    if (spawnTimers.coin <= 0) { spawnCoin(); spawnTimers.coin = rand(0.55, 1.15); }
    spawnTimers.crystal -= dt;
    if (spawnTimers.crystal <= 0) { spawnCrystal(); spawnTimers.crystal = rand(9, 15); }
    spawnTimers.island -= dt;
    if (spawnTimers.island <= 0) { spawnIsland(); spawnTimers.island = rand(3.5, 6); }
    spawnTimers.bird -= dt;
    if (spawnTimers.bird <= 0) { spawnBird(); spawnTimers.bird = rand(2, 4.5); }
    spawnTimers.skyrock -= dt;
    if (spawnTimers.skyrock <= 0) { spawnSkyrock(); spawnTimers.skyrock = rand(6.5, 10.5); }

    // --- player shots ---
    shots = shots.filter((s) => {
      s.x += s.vx * dt; s.life -= dt;
      return s.life > 0 && s.x < W + 60;
    });
    const shotDamage = currentShotDamage();
    shots = shots.filter((s) => {
      for (const e of enemies) {
        if (e.hp > 0 && circleHit(s.x, s.y, 12, e.x, e.y, e.r * 0.7)) {
          e.hp -= shotDamage; e.hitFlash = 1;
          if (e.hp <= 0) {
            score += ENEMY_TYPES[e.type].score;
            spawnExplosion(e.x, e.y);
            e.x = -9999;
          }
          return false;
        }
      }
      for (const rock of skyrocks) {
        if (!rock.broken && circleHit(s.x, s.y, 12, rock.x, rock.y, rock.r * 0.7)) {
          crackRock(rock);
          return false;
        }
      }
      if (boss && !boss.dying && circleHit(s.x, s.y, 12, boss.x, boss.y, boss.r * 0.75)) {
        boss.hp -= shotDamage; boss.hitFlash = 1;
        spawnBurst(boss.x, boss.y, boss.color, 6);
        playSound("bossHurt");
        if (boss.hp <= 0) startBossDeath();
        return false;
      }
      return true;
    });

    // --- sonic boom shots (piercing shockwave) ---
    const sonicDamage = currentShotDamage() * 4 + 4;
    sonicShots = sonicShots.filter((s) => {
      s.x += s.vx * dt; s.age += dt; s.life -= dt;
      if (s.life <= 0 || s.x > W + 120) return false;
      const radius = 40 + s.age * 260;
      for (const e of enemies) {
        if (e.hp > 0 && !s.hitEnemies.has(e) && circleHit(s.x, s.y, radius * 0.5, e.x, e.y, e.r)) {
          s.hitEnemies.add(e);
          e.hp -= sonicDamage; e.hitFlash = 1;
          if (e.hp <= 0) {
            score += ENEMY_TYPES[e.type].score;
            spawnExplosion(e.x, e.y);
            e.x = -9999;
          }
        }
      }
      for (const rock of skyrocks) {
        if (!rock.broken && circleHit(s.x, s.y, radius * 0.5, rock.x, rock.y, rock.r * 0.7)) {
          crackRock(rock);
        }
      }
      if (boss && !boss.dying && !s.hitEnemies.has(boss) && circleHit(s.x, s.y, radius * 0.5, boss.x, boss.y, boss.r * 0.75)) {
        s.hitEnemies.add(boss);
        boss.hp -= sonicDamage; boss.hitFlash = 1;
        spawnBurst(boss.x, boss.y, boss.color, 10);
        playSound("bossHurt");
        if (boss.hp <= 0) startBossDeath();
      }
      return true;
    });

    // --- enemy shots ---
    enemyShots = enemyShots.filter((s) => {
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= 0 || s.x < -60 || s.x > W + 60 || s.y < -60 || s.y > H + 60) return false;
      if (invulnTimer <= 0 && circleHit(hero.x, hero.y, hero.r * 0.55, s.x, s.y, 10)) {
        damageHero();
        return false;
      }
      return true;
    });

    enemies = enemies.filter((e) => e.x > -80 && e.hp > 0);
    coins = coins.filter((c) => c.x > -60);
    crystals = crystals.filter((c) => c.x > -60);
    islands = islands.filter((i) => i.x > -260);
    birds = birds.filter((b) => b.x > -80);
    skyrocks = skyrocks.filter((rock) => rock.x > -80);
    collectibles = collectibles.filter((c) => c.x > -80);

    coins = coins.filter((c) => {
      if (circleHit(hero.x, hero.y, hero.r * 0.7, c.x, c.y, c.r)) {
        score += 10; meta.coins += 5; saveMeta();
        spawnBurst(c.x, c.y, "#ffe873", 10); playSound("coin");
        return false;
      }
      return true;
    });
    crystals = crystals.filter((c) => {
      if (circleHit(hero.x, hero.y, hero.r * 0.7, c.x, c.y, c.r)) {
        score += 25; meta.coins += 8; saveMeta();
        boostTimer = BOOST_DURATION;
        spawnBurst(c.x, c.y, "#7ff4ff", 16); playSound("powerup");
        return false;
      }
      return true;
    });
    for (const rock of skyrocks) {
      if (!rock.broken && circleHit(hero.x, hero.y, hero.r * 0.8, rock.x, rock.y, rock.r * 0.9)) {
        crackRock(rock);
      }
    }
    collectibles = collectibles.filter((c) => {
      if (circleHit(hero.x, hero.y, hero.r * 0.7, c.x, c.y, c.r)) {
        if (c.type === "magnet") {
          magnetTimer = 5;
          spawnBurst(c.x, c.y, "#b59cff", 12);
          showPickupMessage("MAGNET!", "#b59cff");
        } else if (c.type === "shield") {
          shieldTimer = 5;
          spawnBurst(c.x, c.y, "#7fe7ff", 12);
          showPickupMessage("SHIELD!", "#7fe7ff");
        }
        playSound("powerup");
        return false;
      }
      return true;
    });
    if (invulnTimer <= 0 && shieldTimer <= 0) {
      for (const e of enemies) {
        if (circleHit(hero.x, hero.y, hero.r * 0.6, e.x, e.y, e.r * 0.75)) {
          damageHero();
          e.hp -= 99; e.x = -9999;
          spawnExplosion(e.x, e.y);
          break;
        }
      }
      if (boss && !boss.entering && !boss.dying && circleHit(hero.x, hero.y, hero.r * 0.6, boss.x, boss.y, boss.r * 0.7)) {
        damageHero();
      }
    }
    enemies = enemies.filter((e) => e.hp > 0 && e.x > -999);

    if (levelPhase === "running") {
      score += dt * 4 * (effectiveSpeed / level.scrollSpeedBase);
      if (score >= level.targetScore) {
        levelPhase = "boss";
        spawnBoss();
      }
    }

    particles = particles.filter((p) => {
      p.age += dt;
      if (p.explosion) return p.age < p.life;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
      return p.age < p.life;
    });

    if (shake > 0) shake = Math.max(0, shake - dt * 40);

    if (health <= 0) { onGameOver(); return; }

    updateHUD();
  }

  function showPickupMessage(text, color) {
    const el = document.getElementById("boostBadge");
    if (!el) return;
    el.textContent = text;
    el.style.background = color;
    el.classList.add("show");
    clearTimeout(showPickupMessage._timer);
    showPickupMessage._timer = setTimeout(() => {
      el.textContent = "BOOST";
      el.style.background = "#7fd4ff";
      el.classList.remove("show");
    }, 1200);
  }
  showPickupMessage._timer = 0;

  function damageHero() {
    if (shieldTimer > 0) {
      spawnBurst(hero.x, hero.y, "#7fe7ff", 4);
      return;
    }
    health -= 1;
    playSound("heroHit");
    invulnTimer = INVULN_DURATION;
    shake = Math.max(shake, 10);
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  function drawImgCentered(img, x, y, w, h, rot = 0, alpha = 1) {
    if (!imgOk(img)) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  function drawInterceptor(e) {
    ctx.save();
    ctx.translate(e.x, e.y); ctx.rotate(e.rot || 0);
    ctx.shadowColor = "#ff2e6d"; ctx.shadowBlur = 16;
    ctx.fillStyle = e.hitFlash > 0 ? "#ffffff" : "#ff2e6d";
    ctx.beginPath();
    ctx.moveTo(e.r, 0); ctx.lineTo(-e.r * 0.7, -e.r * 0.6); ctx.lineTo(-e.r * 0.25, 0); ctx.lineTo(-e.r * 0.7, e.r * 0.6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function drawTank(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.shadowColor = "#ffb23d"; ctx.shadowBlur = 14;
    ctx.fillStyle = e.hitFlash > 0 ? "#ffffff" : "#8a5a2e";
    roundRectPath(ctx, -e.r, -e.r * 0.68, e.r * 2, e.r * 1.36, 10);
    ctx.fill();
    ctx.fillStyle = "#3a2414";
    ctx.beginPath(); ctx.arc(0, 0, e.r * 0.32, 0, Math.PI * 2); ctx.fill();
    // hp pips
    for (let i = 0; i < e.maxHp; i++) {
      ctx.fillStyle = i < e.hp ? "#ffcf6a" : "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.arc(-e.r * 0.5 + i * 14, -e.r * 0.95, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  function drawTurret(e) {
    const telegraph = e.fireTimer < 0.35;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.shadowColor = "#7fd4ff"; ctx.shadowBlur = telegraph ? 26 : 12;
    ctx.fillStyle = e.hitFlash > 0 ? "#ffffff" : (telegraph ? "#eafcff" : "#3fb8e0");
    ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#0b3040";
    ctx.beginPath(); ctx.arc(0, 0, e.r * 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawBossTelegraph(b) {
    if (b.dying || b.telegraph <= 0.05 || !hero) return;
    ctx.save();
    ctx.globalAlpha = b.telegraph * 0.85;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 10]);
    ctx.lineDashOffset = -elapsed * 60;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(hero.x, hero.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = b.telegraph;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * (1.15 + b.telegraph * 0.35), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawBoss(b) {
    if (b.dying) {
      const t = clamp(1 - b.dyingTimer / BOSS_DEATH_DURATION, 0, 1);
      const bossImg = b.image || (b.imageKey ? images[b.imageKey] : null);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.globalAlpha = 1 - t;
      ctx.filter = `blur(${t * 6}px) saturate(${1 - t * 0.7})`;
      const size = b.r * 2.7 * (1 + t * 0.25);
      if (imgOk(bossImg)) {
        ctx.drawImage(bossImg, -size / 2, -size / 2, size, size);
      } else {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      return;
    }
    const bossImg = b.image || (b.imageKey ? images[b.imageKey] : null);
    if (imgOk(bossImg)) {
      ctx.save();
      ctx.translate(b.x, b.y);
      const size = b.r * 2.7;
      ctx.drawImage(bossImg, -size / 2, -size / 2, size, size);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.spin);
    ctx.shadowColor = b.color; ctx.shadowBlur = 20 + b.telegraph * 26;
    ctx.strokeStyle = b.color; ctx.lineWidth = 6;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = Math.cos(a) * b.r, py = Math.sin(a) * b.r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(-b.spin * 1.6);
    ctx.fillStyle = b.hitFlash > 0.4 ? "#ffffff" : b.color;
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(0, 0, b.r * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = "#0b1b2b";
    ctx.beginPath(); ctx.arc(0, 0, b.r * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  let bgScrollX = 0;

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();

    if (shake > 0) ctx.translate(rand(-shake, shake) * 0.3, rand(-shake, shake) * 0.3);

    // cinematic camera transform
    const focusX = hero ? hero.x + cam.leadX : W / 2;
    const focusY = hero ? hero.y + cam.leadY : H / 2;
    ctx.translate(W / 2, H / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.rotate(cam.rot);
    ctx.translate(-focusX, -focusY);
    ctx.translate(W / 2 - W / 2, H / 2 - H / 2); // no-op, keeps focus math explicit
    ctx.translate(0, 0);
    // recentre so focus point lands at screen center
    ctx.translate(focusX - W / 2, focusY - H / 2);

    // sky (level-tinted gradient)
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, level.sky[0]);
    grad.addColorStop(1, level.sky[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(-400, -400, W + 800, H + 800);

    bgScrollX -= (state === STATE.PLAYING ? scrollSpeed * 0.15 : 6) * (1 / 60);
    const bgImg = imgOk(images[activeBackgroundKey]) ? images[activeBackgroundKey] : images.sky;
    if (bgImg) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      const iw = W * 1.15, ih = H;
      let sx = bgScrollX % iw;
      if (sx > 0) sx -= iw;
      for (let x = sx; x < W; x += iw) ctx.drawImage(bgImg, x, 0, iw, ih);
      ctx.restore();
    }

    const moteColor = level.boss.color;
    for (const m of motes) {
      ctx.save();
      ctx.globalAlpha = (0.25 + Math.sin(m.phase * 1.4) * 0.15) * m.depth * 1.4;
      ctx.shadowColor = moteColor; ctx.shadowBlur = 8;
      ctx.fillStyle = moteColor;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    for (const isl of islands) {
      const w = 260 * isl.scale, h = 180 * isl.scale;
      const bob = Math.sin(isl.bobPhase * 1.2) * 6;
      drawImgCentered(images.island, isl.x, isl.y + bob, w, h);
    }
    for (const b of birds) {
      const flap = Math.sin(b.flap) * 0.15;
      drawImgCentered(images.bird, b.x, b.y, 60, 40, flap);
    }
    for (const c of crystals) {
      const pulse = 1 + Math.sin(c.spin * 2) * 0.08;
      ctx.save(); ctx.shadowColor = "#7ff4ff"; ctx.shadowBlur = 18;
      drawImgCentered(images.crystal, c.x, c.y, c.r * 2.6 * pulse, c.r * 3.1 * pulse, Math.sin(c.spin) * 0.15);
      ctx.restore();
    }
    for (const c of coins) {
      const squash = Math.abs(Math.cos(c.spin));
      ctx.save(); ctx.shadowColor = "#ffe873"; ctx.shadowBlur = 14;
      drawImgCentered(images.coin, c.x, c.y, c.r * 2 * Math.max(0.25, squash), c.r * 2);
      ctx.restore();
    }
    for (const c of collectibles) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.spin);
      if (c.type === "magnet") {
        ctx.shadowColor = "#b59cff"; ctx.shadowBlur = 16;
        ctx.fillStyle = "#8c6dff";
        ctx.beginPath(); ctx.arc(0, 0, c.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(-8, -2, 16, 4);
        ctx.fillRect(-2, -8, 4, 16);
      } else {
        ctx.shadowColor = "#7fe7ff"; ctx.shadowBlur = 16;
        ctx.fillStyle = "#4fdcff";
        ctx.beginPath(); ctx.arc(0, 0, c.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(0, 0, c.r * 0.55, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    for (const e of enemies) {
      if (e.type === "scout") drawImgCentered(images.drone, e.x, e.y, e.r * 2.6, e.r * 2.1);
      else if (e.type === "interceptor") drawInterceptor(e);
      else if (e.type === "tank") drawTank(e);
      else if (e.type === "turret") {
        const canonImg = images.canon;
        if (imgOk(canonImg)) drawImgCentered(canonImg, e.x, e.y, e.r * 2.6, e.r * 2.1);
        else drawTurret(e);
      }
    }
    for (const rock of skyrocks) {
      if (!rock.broken && rock.loot && rock.loot !== "none") {
        const lootColor = rock.loot === "coin" ? "#ffe873" : rock.loot === "crystal" ? "#7ff4ff" : "#ff6a8a";
        const pulse = 0.55 + Math.sin(elapsed * 4 + rock.x * 0.01) * 0.25;
        ctx.save();
        ctx.globalAlpha = pulse * 0.5;
        ctx.shadowColor = lootColor; ctx.shadowBlur = 30;
        ctx.fillStyle = lootColor;
        ctx.beginPath(); ctx.arc(rock.x, rock.y, rock.r * 0.85, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      const img = rock.broken ? images.rockBroken : images.rockWhole;
      drawImgCentered(img, rock.x, rock.y, rock.r * 2.2, rock.r * 2.2);
    }
    if (boss) { drawBossTelegraph(boss); drawBoss(boss); }

    for (const s of enemyShots) {
      if (s.fast) {
        const d = Math.hypot(s.vx, s.vy) || 1;
        const ux = s.vx / d, uy = s.vy / d;
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 5;
        ctx.shadowColor = s.color; ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(s.x - ux * 55, s.y - uy * 55);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha = clamp(s.life / 3, 0.4, 1);
      ctx.shadowColor = s.color; ctx.shadowBlur = s.fast ? 26 : 18;
      ctx.fillStyle = s.fast ? "#ffffff" : s.color;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.fast ? 7 : 9, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    for (const s of shots) {
      ctx.save();
      ctx.globalAlpha = clamp(s.life / FIRE_LIFE, 0.35, 1);
      ctx.shadowColor = "#ff8c2e"; ctx.shadowBlur = 18;
      const beamLen = 46;
      const grad = ctx.createLinearGradient(s.x - beamLen, s.y, s.x + 8, s.y);
      grad.addColorStop(0, "rgba(255,140,46,0)");
      grad.addColorStop(0.6, "#ff8c2e");
      grad.addColorStop(1, "#fff2c2");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(s.x - beamLen, s.y);
      ctx.lineTo(s.x + 8, s.y);
      ctx.stroke();
      ctx.fillStyle = "#fff2c2";
      ctx.beginPath(); ctx.arc(s.x + 6, s.y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    for (const s of sonicShots) {
      const radius = 40 + s.age * 260;
      ctx.save();
      ctx.globalAlpha = clamp(s.life / SONIC_LIFE, 0.15, 0.8);
      ctx.strokeStyle = "#fff487";
      ctx.shadowColor = "#fff487"; ctx.shadowBlur = 24;
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(s.x, s.y, radius * 0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha *= 0.5;
      ctx.lineWidth = 10;
      ctx.beginPath(); ctx.arc(s.x, s.y, radius * 0.35, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    for (const p of particles) {
      if (p.explosion) continue;
      ctx.globalAlpha = clamp(1 - p.age / p.life, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (hero) {
      const flashHit = invulnTimer > 0 && Math.floor(invulnTimer * 12) % 2 === 0;
      const heroImg = state === STATE.MENU ? images.heroIdle : images.heroFly;
      const bobY = Math.sin(hero.bob) * 4;
      if (shieldTimer > 0) {
        const pulse = 0.85 + Math.sin(elapsed * 10) * 0.08;
        ctx.save();
        ctx.globalAlpha = clamp(shieldTimer / SHIELD_ABILITY_DURATION, 0.35, 0.9);
        ctx.strokeStyle = "#7fe7ff";
        ctx.shadowColor = "#7fe7ff"; ctx.shadowBlur = 20;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(hero.x, hero.y + bobY, hero.r * 1.35 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (boostTimer > 0) {
        ctx.save();
        for (let i = 0; i < 3; i++) {
          ctx.globalAlpha = 0.5 - i * 0.15;
          ctx.strokeStyle = "#fff487";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(hero.x - 90 - i * 24, hero.y + bobY - 14 + i * 12);
          ctx.lineTo(hero.x - 40 - i * 24, hero.y + bobY - 14 + i * 12);
          ctx.stroke();
        }
        ctx.restore();
        ctx.save();
        ctx.shadowColor = "#fff487"; ctx.shadowBlur = 26;
        drawImgCentered(images.lightning, hero.x - 55, hero.y + bobY, 60, 84, 0, 0.85);
        ctx.restore();
      }
      drawImgCentered(heroImg, hero.x, hero.y + bobY, hero.r * 3.4, hero.r * 2.7, hero.tilt, flashHit ? 0.35 : 1);
    }

    for (const p of particles) {
      if (!p.explosion) continue;
      const t = p.age / p.life;
      const base = p.big ? 220 : 140;
      drawImgCentered(images.explosion, p.x, p.y, base * (0.6 + t), base * (0.6 + t), 0, 1 - t);
    }

    ctx.restore();

    // screen-space vignette (stronger when low on health)
    const dangerT = health <= 1 ? 0.4 + Math.sin(elapsed * 8) * 0.15 : 0.18;
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, health <= 1 ? `rgba(120,0,10,${dangerT})` : `rgba(5,10,25,${dangerT})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  // ---------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------
  function buildHealthBar() {
    const el = document.getElementById("healthBar");
    el.innerHTML = "";
    const maxH = currentMaxHealth();
    for (let i = 0; i < maxH; i++) {
      const img = document.createElement("img");
      img.src = ASSET_LIST.heart;
      img.dataset.idx = i;
      el.appendChild(img);
    }
  }
  function updateHUD() {
    document.getElementById("scoreValue").textContent = Math.floor(score);
    document.getElementById("coinValue").textContent = Math.floor(meta.coins);
    document.getElementById("levelIndicator").textContent = gameMode === "survival"
      ? `SURVIVAL · ${formatTime(elapsed)}`
      : `LV ${levelIndex + 1} · ${level.name}`;
    const hearts = document.querySelectorAll("#healthBar img");
    hearts.forEach((h, i) => h.classList.toggle("lost", i >= health));
    if (boss) {
      document.getElementById("bossFill").style.width = clamp(boss.hp / boss.maxHp, 0, 1) * 100 + "%";
    }
  }

  // ---------------------------------------------------------------------
  // Screens / state transitions
  // ---------------------------------------------------------------------
  const OVERLAYS = ["menuScreen", "pauseScreen", "gameOverScreen", "victoryScreen", "levelIntroScreen", "levelCompleteScreen", "shopScreen", "settingsScreen", "creditsScreen"];
  function showOverlay(id) {
    OVERLAYS.forEach((s) => document.getElementById(s).classList.toggle("hidden", s !== id));
  }
  function hideAllOverlays() {
    OVERLAYS.forEach((s) => document.getElementById(s).classList.add("hidden"));
  }

  function openSettings() {
    document.getElementById("musicVolRange").value = musicVolume;
    document.getElementById("sfxVolRange").value = sfxVolume;
    showOverlay("settingsScreen");
  }

  function startNewRun() {
    runScore = 0;
    showLevelIntro(0);
  }

  function startSurvival() {
    resetSurvival();
    state = STATE.PLAYING;
    hideAllOverlays();
    updateHUD();
    playBgm();
    playSound("start");
  }

  function showLevelIntro(idx) {
    state = STATE.LEVEL_INTRO;
    resetLevel(idx, true);
    document.getElementById("bossBar").classList.remove("show");
    document.getElementById("levelIntroName").textContent = `Level ${idx + 1} · ${level.name}`;
    document.getElementById("levelIntroSubtitle").textContent = level.subtitle;
    document.getElementById("levelIntroObjective").textContent = level.objective;
    showOverlay("levelIntroScreen");
  }

  function beginLevel() {
    state = STATE.PLAYING;
    hideAllOverlays();
    updateHUD();
    playBgm();
    playSound("start");
  }

  function togglePause() {
    if (state === STATE.PLAYING) { state = STATE.PAUSED; showOverlay("pauseScreen"); }
    else if (state === STATE.PAUSED) { state = STATE.PLAYING; hideAllOverlays(); }
  }

  function onGameOver() {
    state = STATE.GAMEOVER;
    document.getElementById("bossBar").classList.remove("show");
    document.getElementById("chargeMeterWrap").classList.remove("show");
    document.getElementById("shieldBadge").classList.remove("show");
    document.getElementById("finalScore").textContent = Math.floor(score);
    document.getElementById("finalTime").textContent = Math.floor(elapsed) + "s";
    document.getElementById("finalLevelName").textContent = level.name;
    if (gameMode === "survival") {
      if (Math.floor(score) > bestSurvivalScore) {
        bestSurvivalScore = Math.floor(score);
        try { localStorage.setItem("skyguardian_survival_best_v1", String(bestSurvivalScore)); } catch (e) {}
      }
      document.getElementById("bestScore").textContent = bestSurvivalScore;
    } else {
      document.getElementById("bestScore").textContent = bestRunScore;
    }
    playSound("over");
    showOverlay("gameOverScreen");
  }

  function retryLevel() {
    if (gameMode === "survival") resetSurvival();
    else resetLevel(levelIndex, true);
    state = STATE.PLAYING;
    hideAllOverlays();
    playSound("start");
  }

  function finishBossDefeat() {
    const earned = level.rewardCoins;
    meta.coins += earned;
    saveMeta();
    runScore += Math.floor(score);
    boss = null;
    document.getElementById("bossBar").classList.remove("show");

    if (levelIndex === LEVELS.length - 1) {
      if (runScore > bestRunScore) {
        bestRunScore = runScore;
        try { localStorage.setItem("skyguardian_best_v2", String(bestRunScore)); } catch (e) {}
      }
      state = STATE.VICTORY;
      document.getElementById("victoryScore").textContent = runScore;
      document.getElementById("victoryCoins").textContent = meta.coins;
      showOverlay("victoryScreen");
    } else {
      state = STATE.LEVEL_COMPLETE;
      document.getElementById("levelCompleteName").textContent = level.name;
      document.getElementById("levelCompleteScore").textContent = Math.floor(score);
      document.getElementById("levelCompleteCoins").textContent = earned;
      showOverlay("levelCompleteScreen");
    }
  }

  function openShop() {
    state = STATE.SHOP;
    renderShop();
    showOverlay("shopScreen");
  }
  function renderShop() {
    document.getElementById("shopCoins").textContent = Math.floor(meta.coins);
    const list = document.getElementById("shopList");
    list.innerHTML = "";
    for (const def of UPGRADES) {
      const lvl = meta.upg[def.key];
      const maxed = lvl >= def.max;
      const cost = maxed ? null : upgradeCost(def, lvl);
      const row = document.createElement("div");
      row.className = "shopRow";
      const pips = Array.from({ length: def.max }, (_, i) => `<span class="pip ${i < lvl ? "on" : ""}"></span>`).join("");
      row.innerHTML = `
        <div class="shopIcon">${def.icon}</div>
        <div class="shopInfo">
          <div class="shopName">${def.name}</div>
          <div class="shopDesc">${def.desc}</div>
          <div class="shopPips">${pips}</div>
        </div>
        <button class="btn shopBuyBtn" ${maxed || meta.coins < cost ? "disabled" : ""}>
          ${maxed ? "MAX" : `${cost} 🪙`}
        </button>
      `;
      if (!maxed) {
        row.querySelector(".shopBuyBtn").addEventListener("click", () => {
          if (meta.coins >= cost && meta.upg[def.key] < def.max) {
            meta.coins -= cost;
            meta.upg[def.key] += 1;
            saveMeta();
            renderShop();
          }
        });
      }
      list.appendChild(row);
    }
  }

  function goToMenu() {
    state = STATE.MENU;
    document.getElementById("bossBar").classList.remove("show");
    document.getElementById("chargeMeterWrap").classList.remove("show");
    document.getElementById("shieldBadge").classList.remove("show");
    showOverlay("menuScreen");
  }

  // ---------------------------------------------------------------------
  // Wire up UI buttons
  // ---------------------------------------------------------------------
  document.getElementById("campaignBtn").addEventListener("click", () => { requestFullscreenLandscape(); startNewRun(); });
  document.getElementById("survivalBtn").addEventListener("click", () => { requestFullscreenLandscape(); startSurvival(); });
  document.getElementById("settingsBtn").addEventListener("click", openSettings);
  document.getElementById("creditsBtn").addEventListener("click", () => showOverlay("creditsScreen"));
  document.getElementById("settingsBackBtn").addEventListener("click", goToMenu);
  document.getElementById("creditsBackBtn").addEventListener("click", goToMenu);
  document.getElementById("fullscreenBtn").addEventListener("click", requestFullscreenLandscape);
  document.getElementById("musicVolRange").addEventListener("input", (e) => {
    musicVolume = Number(e.target.value);
    localStorage.setItem("skyguardian_music_vol", String(musicVolume));
    if (sounds.bgm) sounds.bgm.volume = musicVolume;
  });
  document.getElementById("sfxVolRange").addEventListener("input", (e) => {
    sfxVolume = Number(e.target.value);
    localStorage.setItem("skyguardian_sfx_vol", String(sfxVolume));
  });
  document.getElementById("campaignBtn").addEventListener("click", () => { requestFullscreenLandscape(); startNewRun(); });
  document.getElementById("survivalBtn").addEventListener("click", () => { requestFullscreenLandscape(); startSurvival(); });
  document.getElementById("settingsBtn").addEventListener("click", openSettings);
  document.getElementById("creditsBtn").addEventListener("click", () => showOverlay("creditsScreen"));
  document.getElementById("settingsBackBtn").addEventListener("click", goToMenu);
  document.getElementById("creditsBackBtn").addEventListener("click", goToMenu);
  document.getElementById("fullscreenBtn").addEventListener("click", requestFullscreenLandscape);
  document.getElementById("levelIntroBtn").addEventListener("click", beginLevel);
  document.getElementById("retryBtn").addEventListener("click", retryLevel);
  document.getElementById("menuFromGameOverBtn").addEventListener("click", goToMenu);
  document.getElementById("levelCompleteBtn").addEventListener("click", openShop);
  document.getElementById("shopContinueBtn").addEventListener("click", () => showLevelIntro(levelIndex + 1));
  document.getElementById("victoryRetryBtn").addEventListener("click", startNewRun);
  document.getElementById("menuFromVictoryBtn").addEventListener("click", goToMenu);
  document.getElementById("resumeBtn").addEventListener("click", togglePause);
  document.getElementById("pauseBtn").addEventListener("click", () => {
    if (state === STATE.PLAYING || state === STATE.PAUSED) togglePause();
  });
  document.getElementById("menuFromPauseBtn").addEventListener("click", goToMenu);

  // ---------------------------------------------------------------------
  // Main loop — fixed timestep simulation, render interpolated
  // ---------------------------------------------------------------------
  const STEP = 1000 / 60;
  let acc = 0, last = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);
    let dtMs = now - last;
    last = now;
    if (dtMs > 250) dtMs = 250;
    acc += dtMs;

    if (pressedOnce.has("pause") && (state === STATE.PLAYING || state === STATE.PAUSED)) togglePause();
    if (pressedOnce.has("confirm")) {
      if (state === STATE.LEVEL_INTRO) beginLevel();
      else if (state === STATE.GAMEOVER) retryLevel();
    }

    while (acc >= STEP) {
      if (state === STATE.PLAYING) {
        update(STEP / 1000);
        if (hero) handleFireInput(STEP / 1000);
        if (pressedOnce.has("shield") && shieldAbilityCooldown <= 0 && shieldTimer <= 0) {
          shieldTimer = SHIELD_ABILITY_DURATION;
          shieldAbilityCooldown = SHIELD_ABILITY_COOLDOWN;
          spawnBurst(hero.x, hero.y, "#7fe7ff", 20);
          playSound("powerup");
        }
      }
      acc -= STEP;
    }
    pressedOnce.clear();
    if (state === STATE.PLAYING || state === STATE.PAUSED || state === STATE.LEVEL_INTRO) render();
  }

  window.addEventListener("blur", () => { if (state === STATE.PLAYING) togglePause(); });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  resetLevel(0, true);
  loadAssets(() => {
    playBgm();
    requestAnimationFrame(frame);
  });
})();
