/* ============================================================
   GHOST HUNTER — game.js
   Full arcade game engine: canvas, input, objects, audio, UI
   ============================================================ */

"use strict";

// ─── CONSTANTS ───────────────────────────────────────────────
const GRAVITY = 1200;  // px/s² → peak at 75% screen in ~1s, total 2s arc
const MAX_MISSES = 3;
const BOSS_INTERVAL = 30000;  // ms
const SLOWMO_DURATION = 5000;   // ms
const SLOWMO_SCALE = 0.30;
const BASE_SPAWN_INTERVAL = 900; // ms
const HIT_PAUSE_MS = 50;

// ─── STATE ───────────────────────────────────────────────────
const State = {
  scene: 'menu',      // menu | playing | paused | gameover
  score: 0,
  hi: { easy: 0, regular: 0, hard: 0 },
  misses: 0,
  combo: 0,
  lastComboTime: 0,
  timeScale: 1,
  slowMoTimer: 0,
  bossTimer: 0,
  bossActive: false,
  bossObj: null,
  bossSlices: 0,
  diffTimer: 0,
  diffLevel: 0,
  spawnTimer: 0,
  spawnInterval: BASE_SPAWN_INTERVAL,
  hitPauseTimer: 0,
  frameTime: 0,
  lastFrameTime: 0,
  goReason: '',
  difficulty: 'regular', // easy | regular | hard
};

// ─── SETTINGS ────────────────────────────────────────────────
const Settings = {
  sliceColor: '#ffffff',
  musicOn: true,
  sfxOn: true,
  musicVol: 0.6,
  sfxVol: 0.8,
};

// ─── OBJECTS ─────────────────────────────────────────────────
let objects = [];   // active game objects
let particles = [];   // active particles
let trailPts = [];   // slice trail points [{x,y,t}]
let floatTexts = [];  // floating text DOM nodes (handled via DOM)

// ─── CANVAS ──────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let W, H;

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ─── AUDIO ENGINE ────────────────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new AudioCtx();
    // Browser Autoplay: Resume on first real interaction
    const unlock = () => {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      window.removeEventListener('mousedown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('mousedown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Master SFX gain node — all SFX route through this
let sfxMaster = null;
function getSfxMaster() {
  const ac = getAudioCtx();
  if (!sfxMaster) {
    sfxMaster = ac.createGain();
    sfxMaster.gain.value = Settings.sfxOn ? Settings.sfxVol : 0;
    sfxMaster.connect(ac.destination);
  }
  return sfxMaster;
}

function updateSfxVol() {
  if (sfxMaster) sfxMaster.gain.setTargetAtTime(
    Settings.sfxOn ? Settings.sfxVol : 0, getAudioCtx().currentTime, 0.02);
}

// ── White noise buffer (reused)
let _noiseBuffer = null;
function getNoiseBuffer() {
  const ac = getAudioCtx();
  if (_noiseBuffer) return _noiseBuffer;
  const len = ac.sampleRate * 0.5;
  _noiseBuffer = ac.createBuffer(1, len, ac.sampleRate);
  const d = _noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return _noiseBuffer;
}

// ── COLOR AUDIO PROFILES (Thematic SFX based on Essence)
function getBladeAudioProfile() {
  const color = Settings.sliceColor.toLowerCase();
  switch (color) {
    case '#ffffff': return { type: 'classic', pitch: 1.0, power: 1.0, Q: 8.0, osc: 'triangle', sfx: 'ring' }; 
    case '#00ffff': return { type: 'cyber',   pitch: 1.4, power: 0.9, Q: 18.0, osc: 'square', sfx: 'digital' }; 
    case '#ff4488': return { type: 'sharp',   pitch: 1.2, power: 1.1, Q: 10.0, osc: 'sawtooth', sfx: 'electric' }; 
    case '#ff6600': return { type: 'fire',    pitch: 0.75, power: 1.6, Q: 5.0,  osc: 'sawtooth', sfx: 'flame' }; 
    case '#aa44ff': return { type: 'mystic',  pitch: 0.9, power: 1.3, Q: 7.0,  osc: 'sine', sfx: 'vibrato' }; 
    case '#44ff88': return { type: 'ecto',    pitch: 1.05, power: 1.0, Q: 12.0, osc: 'triangle', sfx: 'ghost' }; 
    default: return { type: 'classic', pitch: 1.0, power: 1.0, Q: 8.0, osc: 'triangle', sfx: 'ring' };
  }
}

// ── BLADE LOOP — realistic sword swing sound on mouse drag
let _bladeLoopSource = null;
let _bladeLoopGain = null;
let _bladeLoopFilter = null;
let _bladeOsc = null;
let _bladeOscGain = null;
let _bladeOsc2 = null;
let _bladeOscGain2 = null;

function updateBladeLoop(speed) {
  if (!Settings.sfxOn) return;
  try {
    const ac = getAudioCtx();
    const master = getSfxMaster();
    if (!_bladeLoopSource) {
      _bladeLoopGain = ac.createGain();
      _bladeLoopGain.gain.value = 0;
      _bladeLoopGain.connect(master);

      // Resonant Metallic "shimmer" (Ringing air)
      _bladeLoopFilter = ac.createBiquadFilter();
      _bladeLoopFilter.type = 'bandpass';
      _bladeLoopFilter.Q.value = 8.0; // High resonance
      _bladeLoopFilter.frequency.value = 800;
      _bladeLoopFilter.connect(_bladeLoopGain);

      _bladeLoopSource = ac.createBufferSource();
      _bladeLoopSource.buffer = getNoiseBuffer();
      _bladeLoopSource.loop = true;
      _bladeLoopSource.connect(_bladeLoopFilter);
      _bladeLoopSource.start();

      // Primary metallic ring (Triangle for rich overtones)
      _bladeOscGain = ac.createGain();
      _bladeOscGain.gain.value = 0;
      _bladeOscGain.connect(_bladeLoopGain);
      _bladeOsc = ac.createOscillator();
      _bladeOsc.type = 'triangle';
      _bladeOsc.frequency.value = 440;
      _bladeOsc.connect(_bladeOscGain);
      _bladeOsc.start();

      // Inharmonic overtone (Secondary ring for "metal" texture)
      _bladeOscGain2 = ac.createGain();
      _bladeOscGain2.gain.value = 0;
      _bladeOscGain2.connect(_bladeLoopGain);
      _bladeOsc2 = ac.createOscillator();
      _bladeOsc2.type = 'sine';
      _bladeOsc2.frequency.value = 440 * 1.414;
      _bladeOsc2.connect(_bladeOscGain2);
      _bladeOsc2.start();
    }

    // Normalize speed (typical fast drag is 80+ px per frame)
    let norm = speed / 80.0; 
    if (norm > 1) norm = 1;

    // Shifted quadratic curve for gain so it's weighted towards fast swings
    const gainScale = norm * norm; 

    // Professional Metallic Audio Mapping with Color Essence
    const profile = getBladeAudioProfile();
    
    // Filter sweep (Heavier body)
    const targetFreq = (600 + norm * 1600) * profile.pitch; 
    const targetGain = gainScale * 0.35 * profile.power; 
    
    // Oscillators sweep (Metallic body)
    const basePitch = (350 + norm * 850) * profile.pitch; 
    const oscPitch1 = basePitch;
    const oscPitch2 = basePitch * 1.414; 
    
    const oscGainVal = Math.pow(norm, 2.5) * 0.14 * profile.power; 

    const t = ac.currentTime;
    const ramp = 0.015; // Fast response

    // Update oscillator types on the fly
    _bladeOsc.type = profile.osc;
    _bladeOsc2.type = 'sine';
    if (profile.type === 'cyber') _bladeOsc2.type = 'square';
    if (profile.type === 'fire') _bladeOsc2.type = 'sawtooth';

    _bladeLoopGain.gain.cancelScheduledValues(t);
    _bladeLoopGain.gain.setTargetAtTime(targetGain, t, ramp);
    _bladeLoopGain.gain.setTargetAtTime(0, t + 0.08, 0.05);

    _bladeLoopFilter.frequency.cancelScheduledValues(t);
    _bladeLoopFilter.frequency.setTargetAtTime(targetFreq, t, ramp);
    _bladeLoopFilter.Q.setTargetAtTime(profile.Q, t, ramp);

    _bladeOsc.frequency.cancelScheduledValues(t);
    _bladeOsc.frequency.setTargetAtTime(oscPitch1, t, ramp);
    _bladeOscGain.gain.cancelScheduledValues(t);
    _bladeOscGain.gain.setTargetAtTime(oscGainVal, t, ramp);

    _bladeOsc2.frequency.cancelScheduledValues(t);
    _bladeOsc2.frequency.setTargetAtTime(oscPitch2, t, ramp);
    _bladeOscGain2.gain.cancelScheduledValues(t);
    _bladeOscGain2.gain.setTargetAtTime(oscGainVal * 0.6, t, ramp);
    
    // Mystic Vibrato
    if (profile.sfx === 'vibrato') {
      _bladeOsc.frequency.setTargetAtTime(oscPitch1 + Math.sin(t * 25) * 40, t, 0.08);
    }
  } catch (e) { }
}

function stopBladeLoop() {
  if (_bladeLoopGain) {
    const t = getAudioCtx().currentTime;
    _bladeLoopGain.gain.cancelScheduledValues(t);
    _bladeLoopGain.gain.setTargetAtTime(0, t, 0.05);
  }
}

// ── GHOST SLICE — ethereal slash (blade through smoke/ectoplasm)
function playSlice() {
  if (!Settings.sfxOn) return;
  try {
    const ac = getAudioCtx();
    const master = getSfxMaster();
    const t = ac.currentTime;

    // Ethereal sigh / wail (sine wave that slides up and fades out)
    const sg = ac.createGain();
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(0.4, t + 0.05);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    sg.connect(master);
    // Normal ghost slice with essence scaling
    const profile = getBladeAudioProfile();
    const sOsc = ac.createOscillator();
    sOsc.type = profile.osc;
    sOsc.frequency.setValueAtTime(600 * profile.pitch, t);
    
    // Mystic Slide
    const slideEnd = (profile.type === 'mystic') ? 400 * profile.pitch : 1200 * profile.pitch;
    sOsc.frequency.exponentialRampToValueAtTime(slideEnd, t + 0.3); 
    
    // Add "resonance" for cyber/mystic
    if (profile.type === 'cyber' || profile.type === 'mystic') {
      const g = ac.createGain();
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      g.connect(master);
      sOsc.connect(g);
    }

    sOsc.connect(sg);
    sOsc.start(t); sOsc.stop(t + 0.5);

    // Ectoplasmic poof (lowpass filtered noise)
    const noise = ac.createBufferSource();
    noise.buffer = getNoiseBuffer();
    const lp = ac.createBiquadFilter();
    lp.type = (profile.type === 'fire') ? 'bandpass' : 'lowpass'; 
    lp.frequency.value = (profile.type === 'fire') ? 800 : 1500;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.8, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + (profile.type === 'mystic' ? 0.6 : 0.25));
    noise.connect(lp); lp.connect(ng); ng.connect(master);
    noise.start(t); noise.stop(t + 0.6);
    
    // Sharp slicing tear (essense based shaping)
    const sliceNoise = ac.createBufferSource();
    sliceNoise.buffer = getNoiseBuffer();
    const bp = ac.createBiquadFilter();
    bp.type = (profile.type === 'ecto') ? 'bandpass' : 'highpass'; 
    bp.frequency.value = (profile.type === 'fire') ? 2000 : 4000 * profile.pitch;
    const sNg = ac.createGain();
    sNg.gain.setValueAtTime(1.0 * profile.power, t);
    sNg.gain.exponentialRampToValueAtTime(0.001, t + 0.12); 
    sliceNoise.connect(bp); bp.connect(sNg); sNg.connect(master);
    sliceNoise.start(t); sliceNoise.stop(t + 0.15);
  } catch (e) { }
}

// ── BOSS HIT — Heavy ectoplasmic tear + demonic roar
function playBossHit() {
  if (!Settings.sfxOn) return;
  try {
    const ac = getAudioCtx();
    const master = getSfxMaster();
    const t = ac.currentTime;

    // Demonic groan (detuned sawtooth waves sweeping downward)
    [150, 180, 220].forEach((freq, i) => {
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      
      // Add slight lowpass to make it sound muffled/ghostly, not buzzy
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 800;
      lp.connect(master);
      g.connect(lp);

      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.4, t + 0.4); // drops pitch heavily
      osc.connect(g);
      
      osc.start(t); osc.stop(t + 0.6);
    });

    // Massive ghostly tear (slowly dropping bandpass noise)
    const noise = ac.createBufferSource();
    noise.buffer = getNoiseBuffer();
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1000, t);
    bp.frequency.exponentialRampToValueAtTime(200, t + 0.4);
    bp.Q.value = 1.2;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(1.0, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    noise.connect(bp); bp.connect(ng); ng.connect(master);
    noise.start(t); noise.stop(t + 0.5);
    
    // The physical slice (blade sound going through)
    const sliceNoise = ac.createBufferSource();
    sliceNoise.buffer = getNoiseBuffer();
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3500;
    const sNg = ac.createGain();
    sNg.gain.setValueAtTime(0.8, t);
    sNg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    sliceNoise.connect(hp); hp.connect(sNg); sNg.connect(master);
    sliceNoise.start(t); sliceNoise.stop(t + 0.15);
  } catch (e) { }
}

// ── BOSS DEATH — Big Balloon Blast / Huge Pop
function playBossDeath() {
  if (!Settings.sfxOn) return;
  try {
    const ac = getAudioCtx();
    const master = getSfxMaster();
    const t = ac.currentTime;

    // The massive explosive BANG (loud unfiltered white noise)
    const noise = ac.createBufferSource();
    noise.buffer = getNoiseBuffer();
    
    // Add a slight peak EQ to make the "pop" more resonant and sharp
    const peq = ac.createBiquadFilter();
    peq.type = 'peaking';
    peq.frequency.value = 800;
    peq.gain.value = 10;
    peq.Q.value = 0.5;

    const ng = ac.createGain();
    // Instantly loud, then drops off very fast (like an explosion)
    ng.gain.setValueAtTime(2.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    noise.connect(peq); peq.connect(ng); ng.connect(master);
    noise.start(t); noise.stop(t + 0.4);

    // The deep 'thump' of the air blast shockwave
    const sub = ac.createOscillator();
    sub.type = 'square'; // square gives it a punchy low end
    sub.frequency.setValueAtTime(150, t);
    sub.frequency.exponentialRampToValueAtTime(40, t + 0.1); // pitch drops instantly
    
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 200; // only keep the sub-bass

    const sg = ac.createGain();
    sg.gain.setValueAtTime(3.0, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

    sub.connect(lp); lp.connect(sg); sg.connect(master);
    sub.start(t); sub.stop(t + 0.4);
  } catch (e) { }
}

// ── UI HOVER — subtle high-mid blip
function playHover() {
  if (!Settings.sfxOn) return;
  try {
    const ac = getAudioCtx();
    const t = ac.currentTime;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    g.connect(getSfxMaster());
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1400, t);
    o.connect(g);
    o.start(t); o.stop(t + 0.1);
  } catch (e) { }
}

// ── UI CLICK — punchy resonant click
function playClick() {
  if (!Settings.sfxOn) return;
  try {
    const ac = getAudioCtx();
    const t = ac.currentTime;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    g.connect(getSfxMaster());
    const o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(800, t);
    o.frequency.exponentialRampToValueAtTime(200, t + 0.12);
    o.connect(g);
    o.start(t); o.stop(t + 0.15);
  } catch (e) { }
}

// ── HUMAN HIT — Fatal slash (very sharp, long reverberating metallic ring + fast slice)
function playHurt() {
  if (!Settings.sfxOn) return;
  try {
    const ac = getAudioCtx();
    const master = getSfxMaster();
    const t = ac.currentTime;

    // Brutal slice noise
    const noise = ac.createBufferSource();
    noise.buffer = getNoiseBuffer();
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3000;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(1.0, t + 0.01);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    noise.connect(hp); hp.connect(ng); ng.connect(master);
    noise.start(t); noise.stop(t + 0.2);

    // High pitched horrific metallic screech (blade sliding on bone)
    [3500, 4200, 5800].forEach((freq, i) => {
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      g.connect(master);
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq - 500, t + 0.5);
      osc.connect(g);
      osc.start(t); osc.stop(t + 0.7);
    });

    // Low hit sub drop for impact
    const sg = ac.createGain();
    sg.gain.setValueAtTime(0.8, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    sg.connect(master);
    const sOsc = ac.createOscillator();
    sOsc.type = 'sine';
    sOsc.frequency.setValueAtTime(150, t);
    sOsc.frequency.exponentialRampToValueAtTime(30, t + 0.3);
    sOsc.connect(sg);
    sOsc.start(t); sOsc.stop(t + 0.4);

  } catch (e) { }
}

// ─── BACKGROUND MUSIC ────────────────────────────────────────
// Spooky ghost-hunter theme: eerie pad + driving pulse + melody
let musicNode = null;
let musicGain = null;

function startMusic() {
  if (!Settings.musicOn) return;
  if (musicNode) return;
  try {
    const ac = getAudioCtx();
    musicGain = ac.createGain();
    musicGain.gain.value = Settings.musicVol * 0.22;
    musicGain.connect(ac.destination);

    // Spooky minor scale melody notes (A minor pentatonic)
    const melody = [220, 261, 293, 349, 392, 440, 523, 392, 349, 293, 261, 220];
    const melRhythm = [0.5, 0.25, 0.25, 0.5, 0.25, 0.25, 0.5, 0.25, 0.25, 0.5, 0.25, 0.5];
    // Bass pulse pattern
    const bass = [110, 110, 147, 110, 98, 110, 110, 147];
    const bassRhythm = new Array(8).fill(0.5);

    let schedTime = ac.currentTime + 0.1;
    let melIdx = 0;
    let bassIdx = 0;
    let barCount = 0;

    const schedule = () => {
      if (!musicNode) return;
      const lookAhead = 2.5;
      while (schedTime < ac.currentTime + lookAhead) {

        // ── KICK DRUM every beat (0.5s)
        const kg = ac.createGain();
        kg.gain.setValueAtTime(Settings.musicVol * 0.55, schedTime);
        kg.gain.exponentialRampToValueAtTime(0.001, schedTime + 0.22);
        kg.connect(musicGain);
        const ko = ac.createOscillator();
        ko.frequency.setValueAtTime(140, schedTime);
        ko.frequency.exponentialRampToValueAtTime(38, schedTime + 0.18);
        ko.connect(kg); ko.start(schedTime); ko.stop(schedTime + 0.22);

        // ── SNARE on beats 2 & 4 (every 1.0s offset 0.5s)
        if (barCount % 2 === 1) {
          const sn = ac.createBufferSource();
          sn.buffer = getNoiseBuffer();
          const sbp = ac.createBiquadFilter();
          sbp.type = 'bandpass'; sbp.frequency.value = 2200; sbp.Q.value = 0.9;
          const sg = ac.createGain();
          sg.gain.setValueAtTime(Settings.musicVol * 0.38, schedTime);
          sg.gain.exponentialRampToValueAtTime(0.001, schedTime + 0.14);
          sn.connect(sbp); sbp.connect(sg); sg.connect(musicGain);
          sn.start(schedTime); sn.stop(schedTime + 0.14);
          // Snare tone body
          const stg = ac.createGain();
          stg.gain.setValueAtTime(Settings.musicVol * 0.22, schedTime);
          stg.gain.exponentialRampToValueAtTime(0.001, schedTime + 0.12);
          stg.connect(musicGain);
          const sto = ac.createOscillator();
          sto.type = 'triangle'; sto.frequency.value = 180;
          sto.connect(stg); sto.start(schedTime); sto.stop(schedTime + 0.12);
        }

        // ── HI-HAT every 8th note (every 0.25s)
        if (barCount % 1 === 0) {
          const hh = ac.createBufferSource();
          hh.buffer = getNoiseBuffer();
          const hhf = ac.createBiquadFilter();
          hhf.type = 'highpass'; hhf.frequency.value = 9000;
          const hhg = ac.createGain();
          const hhVol = (barCount % 4 === 0) ? 0.14 : 0.06;
          hhg.gain.setValueAtTime(Settings.musicVol * hhVol, schedTime + 0.245);
          hhg.gain.exponentialRampToValueAtTime(0.001, schedTime + 0.32);
          hh.connect(hhf); hhf.connect(hhg); hhg.connect(musicGain);
          hh.start(schedTime + 0.245); hh.stop(schedTime + 0.33);
        }

        // ── BASS SYNTH — pulsing low sine
        const bFreq = bass[bassIdx % bass.length];
        const bg = ac.createGain();
        bg.gain.setValueAtTime(0, schedTime);
        bg.gain.linearRampToValueAtTime(Settings.musicVol * 0.50, schedTime + 0.02);
        bg.gain.exponentialRampToValueAtTime(0.001, schedTime + bassRhythm[bassIdx % bassRhythm.length]);
        bg.connect(musicGain);
        const bo1 = ac.createOscillator(); bo1.type = 'sine'; bo1.frequency.value = bFreq;
        const bo2 = ac.createOscillator(); bo2.type = 'square'; bo2.frequency.value = bFreq;
        const bmix = ac.createGain(); bmix.gain.value = 0.15;
        bo1.connect(bg); bo2.connect(bmix); bmix.connect(bg);
        bo1.start(schedTime); bo1.stop(schedTime + 0.48);
        bo2.start(schedTime); bo2.stop(schedTime + 0.48);
        bassIdx++;

        // ── SPOOKY MELODY — eerie triangle wave
        const mFreq = melody[melIdx % melody.length];
        const mg = ac.createGain();
        const mDur = melRhythm[melIdx % melRhythm.length];
        mg.gain.setValueAtTime(0, schedTime);
        mg.gain.linearRampToValueAtTime(Settings.musicVol * 0.28, schedTime + 0.03);
        mg.gain.exponentialRampToValueAtTime(0.001, schedTime + mDur * 0.85);
        mg.connect(musicGain);
        const mo = ac.createOscillator();
        mo.type = 'triangle';
        mo.frequency.setValueAtTime(mFreq, schedTime);
        // Slight vibrato
        const lfo = ac.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5.5;
        const lfoG = ac.createGain(); lfoG.gain.value = 3;
        lfo.connect(lfoG); lfoG.connect(mo.frequency);
        mo.connect(mg);
        mo.start(schedTime); mo.stop(schedTime + mDur * 0.88);
        lfo.start(schedTime); lfo.stop(schedTime + mDur * 0.88);
        melIdx++;

        // ── EERIE PAD — sustained chord drone (every 4 beats)
        if (barCount % 8 === 0) {
          [220, 277, 330, 415].forEach((pf, pi) => {
            const pg = ac.createGain();
            pg.gain.setValueAtTime(0, schedTime);
            pg.gain.linearRampToValueAtTime(Settings.musicVol * 0.08, schedTime + 0.4);
            pg.gain.setValueAtTime(Settings.musicVol * 0.08, schedTime + 3.5);
            pg.gain.linearRampToValueAtTime(0, schedTime + 4.0);
            pg.connect(musicGain);
            const po = ac.createOscillator();
            po.type = 'sine';
            po.frequency.value = pf + (pi * 0.8); // slight detune
            po.connect(pg);
            po.start(schedTime); po.stop(schedTime + 4.1);
          });
        }

        schedTime += 0.5; // advance by one beat
        barCount++;
      }
      musicNode._raf = requestAnimationFrame(schedule);
    };

    musicNode = {
      _raf: null,
      stop() {
        if (this._raf) cancelAnimationFrame(this._raf);
        if (musicGain) {
          musicGain.gain.setTargetAtTime(0, getAudioCtx().currentTime, 0.1);
          setTimeout(() => { try { musicGain.disconnect(); } catch (e) { } musicGain = null; }, 300);
        }
      }
    };
    schedule();
  } catch (e) { console.warn('Music error', e); }
}

function stopMusic() {
  if (musicNode) {
    musicNode.stop();
    musicNode = null;
  }
}

function updateMusicVol(v) {
  if (musicGain) {
    musicGain.gain.setTargetAtTime(Settings.musicOn ? v * 0.22 : 0, getAudioCtx().currentTime, 0.05);
  }
}

// ─── SPAWN OBJECTS ───────────────────────────────────────────
function spawnObject(type) {
  const peakFrac = 0.20 + Math.random() * 0.05;      // 20–25% from top
  const travelUp = H * (1 - peakFrac);                // distance from bottom to peak
  const x = W * (0.15 + Math.random() * 0.70); // 15% to 85% of screen
  const vy = -Math.sqrt(2 * GRAVITY * travelUp); // launch velocity
  const t_peak = Math.abs(vy) / GRAVITY; // time from launch to peak

  // Horizontal drift: ensure they always launch TOWARDS the center
  const maxVxDrift = 140 + State.diffLevel * 5;
  const drift = Math.random() * maxVxDrift;
  const vx = (x < W / 2) ? drift : -drift;

  let size, color, label, points;
  switch (type) {
    case 'ghost':
      size = 30 + Math.random() * 10;
      color = '#88ccff';
      label = '👻';
      points = 10;
      break;
    case 'boss':
      size = 55;
      color = '#ff44cc';
      label = '👿';
      points = 0;
      break;
    case 'human':
      size = 36 + Math.random() * 6;
      color = '#ffcc44';
      label = '🧍';
      points = 0;
      break;
  }

  return {
    type, x, y: H + size, vx, vy, size, color, label, points,
    sliced: false, alive: true, rotation: 0, rotSpeed: (Math.random() - 0.5) * 2.5
  };
}

function spawnRandom() {
  const diff = State.diffLevel;
  const humanChance = Math.min(0.04 + diff * 0.012, 0.22);
  const r = Math.random();
  if (r < humanChance) return spawnObject('human');
  return spawnObject('ghost');
}

const BOSS_MAX_HP = 100; // boss health — each hit deals 5 damage

function triggerBoss() {
  if (State.bossActive) return;
  State.bossActive = true;
  State.bossSlices = 0;
  const boss = spawnObject('boss');
  const bossTravel = H * 0.68;
  boss.vy = -Math.sqrt(2 * GRAVITY * bossTravel);
  const bossDrift = 50 + Math.random() * 80;
  boss.vx = (boss.x < W / 2) ? bossDrift : -bossDrift;
  boss.hp = BOSS_MAX_HP;   // boss needs multiple hits
  boss.maxHp = BOSS_MAX_HP;
  boss.hitFlash = 0;        // flash timer on hit
  boss.sliced = false;      // never mark sliced on hits — only on death
  boss.alive = true;
  State.bossObj = boss;
  objects.push(boss);
  activateSlowMo();         // slow-mo starts immediately when boss appears
  showBossBar();
}

// ─── INPUT / SLICING ─────────────────────────────────────────
let isSlicing = false;
let lastSlicePos = null;

function getPos(e) {
  if (e.touches) {
    const t = e.touches[0] || e.changedTouches[0];
    return { x: t.clientX, y: t.clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

canvas.addEventListener('mousedown', e => startSlice(getPos(e)));
canvas.addEventListener('mousemove', e => moveSlice(getPos(e)));
canvas.addEventListener('mouseup', () => endSlice());
canvas.addEventListener('touchstart', e => { e.preventDefault(); startSlice(getPos(e)); }, { passive: false });
canvas.addEventListener('touchmove', e => { e.preventDefault(); moveSlice(getPos(e)); }, { passive: false });
canvas.addEventListener('touchend', e => { e.preventDefault(); endSlice(); }, { passive: false });

function startSlice(pos) {
  if (State.scene !== 'playing') return;
  isSlicing = true;
  lastSlicePos = pos;
  trailPts.push({ x: pos.x, y: pos.y, t: Date.now() });
}

function moveSlice(pos) {
  if (!isSlicing || State.scene !== 'playing') return;
  if (lastSlicePos) {
    // Continuous loop sound updated by drag speed
    const dx = pos.x - lastSlicePos.x, dy = pos.y - lastSlicePos.y;
    const speed = Math.sqrt(dx * dx + dy * dy);
    updateBladeLoop(speed);
    checkSliceSegment(lastSlicePos, pos);
  }
  lastSlicePos = pos;
  trailPts.push({ x: pos.x, y: pos.y, t: Date.now() });
  if (trailPts.length > 24) trailPts.shift();
}

function endSlice() {
  isSlicing = false;
  lastSlicePos = null;
  stopBladeLoop();
}

function checkSliceSegment(a, b) {
  for (const obj of objects) {
    if (!obj.alive || obj.sliced) continue;
    if (lineCircleIntersect(a, b, obj)) {
      sliceObject(obj, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
  }
}

function lineCircleIntersect(a, b, obj) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const fx = a.x - obj.x, fy = a.y - obj.y;
  const A = dx * dx + dy * dy;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - obj.size * obj.size;
  let disc = B * B - 4 * A * C;
  if (disc < 0) return false;
  disc = Math.sqrt(disc);
  const t1 = (-B - disc) / (2 * A);
  const t2 = (-B + disc) / (2 * A);
  return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1) || (t1 < 0 && t2 > 1);
}

function sliceObject(obj, pos) {
  // Boss: never kill on single hit — handle separately
  if (obj.type === 'boss') {
    handleBossSlice(obj, pos);
    return;
  }

  // All other objects: mark dead
  obj.sliced = true;
  obj.alive = false;

  // Hit pause
  State.hitPauseTimer = HIT_PAUSE_MS;

  // Screen shake
  document.body.classList.remove('shake');
  void document.body.offsetWidth;
  document.body.classList.add('shake');

  if (obj.type === 'human') {
    playHurt();
    triggerGameOver('You sliced a human!');
    return;
  }

  // Normal ghost
  playSlice();
  State.score += 10;
  State.combo++;
  State.lastComboTime = Date.now();

  spawnParticles(obj.x, obj.y, obj.color, 12);

  // Procedural Praise (Tiers based on Soul Essence and combo strength)
  if (State.combo >= 3) {
    let label, cls;
    // LOWER TIER (Pink) - Hits 3 to 6
    if (State.combo <= 6) {
      const pool = ['NICE!', 'GREAT!', 'COOL!', 'SWEET!', 'FANTASTIC!', 'COOL!'];
      label = pool[(State.combo - 3) % pool.length];
      cls = 'pink';
    } 
    // HIGHER TIER (Yellow/Boss) - Hit 7+
    else {
      const pool = ['GODLIKE!', 'SPECTRAL!', 'DESTRUCTIVE!', 'SUPREME!', 'INSANE!', 'UNSTOPPABLE!', 'LEGENDARY!', 'IMPOSSIBLE!', 'CELESTIAL!', 'SPECTRE-LORD!'];
      label = pool[Math.floor(Math.random() * pool.length)]; // keep it changing randomly at top tier
      cls = 'boss';
    }
    showFloat(pos.x, pos.y, label, cls);
  }

  updateHUD();
}

function handleBossSlice(boss, pos) {
  if (!State.bossActive || !boss.alive) return;

  // Cooldown: can only register a hit every 150ms so one swipe = one hit
  const now = Date.now();
  if (boss._lastHitTime && now - boss._lastHitTime < 150) return;
  boss._lastHitTime = now;

  playBossHit();
  boss.hp = Math.max(0, boss.hp - 5);  // 5 damage per hit
  boss.hitFlash = 0.3;      // flash white for 0.3s
  State.bossSlices++;

  // Score per hit, increasing with each slice
  const pts = 25 + State.bossSlices * 10;
  State.score += pts;

  // Hit pause & shake
  State.hitPauseTimer = HIT_PAUSE_MS;
  document.body.classList.remove('shake');
  void document.body.offsetWidth;
  document.body.classList.add('shake');

  spawnParticles(pos.x, pos.y, '#ff44cc', 16);

  // Escalating label every 2 hits
  const labels = ['FRENZY!', 'FRENZY!', 'INSANE!', 'INSANE!', 'GODLIKE!', 'GODLIKE!', 'UNSTOPPABLE!', 'LEGENDARY!'];
  const label = labels[Math.min(State.bossSlices - 1, labels.length - 1)];
  showFloat(pos.x, pos.y, label, 'boss');

  // Boss-specific tilted combo counter on the side
  if (State.bossSlices > 1) {
    showFloat(80, H * 0.45, State.bossSlices + ' HIT COMBO!', 'boss-combo');
  }

  // Update boss bar
  updateBossBar(boss.hp / boss.maxHp);

  // Boss dead?
  if (boss.hp <= 0) {
    boss.alive = false;
    boss.sliced = true;
    playBossDeath();
    spawnParticles(boss.x, boss.y, '#ff44cc', 60);
    showFloat(boss.x, boss.y - 40, 'BOSS DEFEATED!', 'boss');
    deactivateSlowMo();   // end slow-mo, resume normal game
  }

  updateHUD();
}

// ─── PARTICLES ───────────────────────────────────────────────
function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const speed = 120 + Math.random() * 300;  // px/s
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      life: 1,
      decay: 0.025 + Math.random() * 0.04,
      size: 3 + Math.random() * 5,
      color,
    });
  }
}

// ─── FLOATING TEXT ───────────────────────────────────────────
function showFloat(x, y, text, cls = '') {
  let layer = document.getElementById('floatTextLayer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'floatTextLayer';
    document.body.appendChild(layer);
  }
  
  // Clear the layer to prevent text clumping (Instant transition to next state)
  layer.innerHTML = ''; 

  const el = document.createElement('div');
  
  // Use the provided class (pink, boss, boss-combo, etc.) 
  // and default to the standard cyan/blue float if none is provided.
  const finalCls = cls;

  el.className = 'float-text ' + finalCls;
  el.textContent = text;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  layer.appendChild(el);
  
  // Simple fade & removal logic
  setTimeout(() => { if (el.parentNode) el.remove(); }, 1200);
}

// ─── BOSS BAR ────────────────────────────────────────────────
const hudBossBar = document.getElementById('hudBossBar');
const bossBarFill = document.getElementById('bossBarFill');

function showBossBar() { hudBossBar.style.display = 'flex'; bossBarFill.style.width = '100%'; }
function hideBossBar() { hudBossBar.style.display = 'none'; }

function updateBossBar(fraction) {
  bossBarFill.style.width = (fraction * 100) + '%';
}

// ─── SLOW MOTION ─────────────────────────────────────────────
const slowMoOverlay = (() => {
  const el = document.createElement('div');
  el.id = 'slowMoOverlay';
  document.body.appendChild(el);
  return el;
})();

function activateSlowMo() {
  State.timeScale = SLOWMO_SCALE;
  State.slowMoTimer = SLOWMO_DURATION;
  slowMoOverlay.classList.add('active');
}

function deactivateSlowMo() {
  State.timeScale = 1;
  State.slowMoTimer = 0;
  slowMoOverlay.classList.remove('active');
  State.bossActive = false;
  State.bossObj = null;
  hideBossBar();
}

// ─── HUD UPDATE ──────────────────────────────────────────────
const hudScore = document.getElementById('hudScore');
const hudHi = document.getElementById('hudHi');
const hudMisses = document.getElementById('hudMisses');

function updateHUD() {
  hudScore.textContent = State.score;
  hudHi.textContent = 'HI: ' + State.hi[State.difficulty];

  if (State.difficulty === 'easy') {
    hudMisses.style.display = 'none';
  } else {
    hudMisses.style.display = 'flex';
    const icons = hudMisses.querySelectorAll('.miss-icon');
    icons.forEach((el, i) => {
      if (State.difficulty === 'hard') {
        el.style.display = i === 0 ? 'inline-block' : 'none';
        el.classList.toggle('lost', i < State.misses);
      } else {
        el.style.display = 'inline-block';
        el.classList.toggle('lost', i < State.misses);
      }
    });
  }
}

// ─── SCENES ──────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('active', s.id === id);
    s.classList.toggle('hidden', s.id !== id);
  });
}

function showHUD(v) {
  document.getElementById('hud').classList.toggle('hidden', !v);
  document.getElementById('btnPause').style.display = v ? '' : 'none';
}

// ─── GAME START / OVER ───────────────────────────────────────
function startGame() {
  getAudioCtx(); // unlock audio
  objects = [];
  particles = [];
  trailPts = [];

  State.score = 0;
  State.misses = 0;
  State.combo = 0;
  State.lastComboTime = 0;
  State.timeScale = 1;
  State.slowMoTimer = 0;
  State.bossTimer = 0;
  State.bossActive = false;
  State.bossObj = null;
  State.bossSlices = 0;
  State.diffTimer = 0;
  State.diffLevel = 0;
  State.spawnTimer = 0;
  State.spawnInterval = BASE_SPAWN_INTERVAL;
  State.hitPauseTimer = 0;
  State.scene = 'playing';

  deactivateSlowMo();
  hideBossBar();
  updateHUD();
  endSlice();               // Reset slicing state (isSlicing = false, stopBladeLoop)
  showScreen('__none__');  // hide all
  showHUD(true);
  startMusic();

  if (!State.lastFrameTime) State.lastFrameTime = performance.now();
}

function triggerGameOver(reason) {
  State.scene = 'gameover';
  State.goReason = reason;

  const currentDiff = State.difficulty;
  if (State.score > State.hi[currentDiff]) {
    State.hi[currentDiff] = State.score;
    Persist.save();
    syncDifficultyUI();
  }
  stopMusic();
  showHUD(false);
  deactivateSlowMo();

  document.getElementById('goScore').textContent = State.score;
  document.getElementById('goHi').textContent = State.hi[State.difficulty];
  document.getElementById('goReason').textContent = reason || '';
  showScreen('gameOver');
}

function pauseGame() {
  if (State.scene !== 'playing') return;
  State.scene = 'paused';
  showScreen('pauseMenu');
}

function resumeGame() {
  State.scene = 'playing';
  State.lastFrameTime = performance.now();
  showScreen('__none__');
}

// ─── DRAWING ─────────────────────────────────────────────────
function drawBackground() {
  ctx.fillStyle = '#050810';
  ctx.fillRect(0, 0, W, H);

  // Subtle grid
  ctx.strokeStyle = 'rgba(0,255,255,0.025)';
  ctx.lineWidth = 1;
  const gridSize = 60;
  for (let x = 0; x < W; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Bottom glow
  const grd = ctx.createLinearGradient(0, H - 100, 0, H);
  grd.addColorStop(0, 'rgba(0,200,255,0)');
  grd.addColorStop(1, 'rgba(0,200,255,0.04)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, H - 100, W, 100);
}

function drawObject(obj) {
  if (!obj.alive) return;
  ctx.save();
  ctx.translate(obj.x, obj.y);
  ctx.rotate(obj.rotation);

  const r = obj.size;

  if (obj.type === 'boss') {
    const t = Date.now() * 0.005;
    const glow = 10 + Math.sin(t) * 6;
    const flash = obj.hitFlash > 0;

    // ── BOSS AURA (Ethereal Dark Fire)
    const aura = ctx.createRadialGradient(0, -r * 0.2, r * 0.2, 0, 0, r * 2.2);
    aura.addColorStop(0, flash ? 'rgba(255,255,255,0.8)' : 'rgba(255, 20, 80, 0.6)'); // bloody red core
    aura.addColorStop(0.5, flash ? 'rgba(255,100,100,0.4)' : 'rgba(100, 0, 50, 0.3)');
    aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.2, 0, Math.PI * 2);
    ctx.fill();

    // ── BOSS BODY (Massive Demonic Phantom)
    ctx.shadowColor = flash ? '#ffffff' : '#ff0033';
    ctx.shadowBlur = flash ? r * 1.5 : r * 0.8 + glow * 2;
    
    const bodyGrad = ctx.createLinearGradient(0, -r * 1.5, 0, r * 2.5);
    bodyGrad.addColorStop(0, flash ? '#ffffff' : 'rgba(40, 0, 20, 0.95)'); // dark crown
    bodyGrad.addColorStop(0.3, flash ? '#ffaaaa' : 'rgba(180, 10, 50, 0.9)'); // crimson mid
    bodyGrad.addColorStop(0.7, flash ? '#ff5555' : 'rgba(80, 0, 30, 0.6)'); // fading tentacles
    bodyGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    
    // Massive Head
    ctx.arc(0, -r * 0.2, r * 1.1, Math.PI, 0, false);
    
    // Multi-tentacle ragged bottom
    const w0 = Math.sin(t * 1.5) * r * 0.3;
    const w1 = Math.cos(t * 2.1) * r * 0.4;
    const w2 = Math.sin(t * 1.8 + 1) * r * 0.5;
    const w3 = Math.cos(t * 1.4 + 2) * r * 0.4;

    // Rightmost trailing edge
    ctx.bezierCurveTo(
      r * 1.1, r * 0.7,
      r * 0.8 + w0, r * 1.8,
      r * 0.9 + w1, r * 2.4 // Right Tentacle Tip
    );
    // Up to first gap
    ctx.quadraticCurveTo(r * 0.5 + w1, r * 1.4, r * 0.3 + w1 * 0.5, r * 1.5);
    // Down to middle tentacle
    ctx.quadraticCurveTo(r * 0.1, r * 2.0, w2, r * 2.8); // Center Tentacle Tip
    // Up to second gap
    ctx.quadraticCurveTo(-r * 0.2 + w2, r * 1.6, -r * 0.4 + w3 * 0.5, r * 1.5);
    // Down to left tentacle
    ctx.quadraticCurveTo(-r * 0.7, r * 1.9, -r * 0.8 + w3, r * 2.5); // Left Tentacle Tip
    // Leftmost trailing edge back up
    ctx.bezierCurveTo(
      -r * 0.9 + w3, r * 1.5,
      -r * 1.1, r * 0.7,
      -r * 1.1, -r * 0.2
    );
    ctx.closePath();
    ctx.fill();

    // ── DEMONIC HOLLOW EYES (Slitted, Angry)
    const eyeY = -r * 0.4;
    const eyeX = r * 0.45;
    
    ctx.fillStyle = flash ? '#000' : 'rgba(10, 0, 0, 0.9)'; // Pitch black voids
    ctx.shadowColor = flash ? '#000' : '#ffaa00'; // Hellfire orange/yellow glow
    ctx.shadowBlur = r * 0.5;
    
    // Left Eye (angled sharply inwards)
    ctx.beginPath();
    ctx.moveTo(-eyeX - r * 0.2, eyeY - r * 0.2); // Outer top
    ctx.lineTo(-eyeX + r * 0.3, eyeY + r * 0.1); // Inner bottom (sharp)
    ctx.lineTo(-eyeX - r * 0.1, eyeY + r * 0.3); // Outer bottom
    ctx.closePath();
    ctx.fill();

    // Right Eye
    ctx.beginPath();
    ctx.moveTo(eyeX + r * 0.2, eyeY - r * 0.2);
    ctx.lineTo(eyeX - r * 0.3, eyeY + r * 0.1);
    ctx.lineTo(eyeX + r * 0.1, eyeY + r * 0.3);
    ctx.closePath();
    ctx.fill();

    // Inner fiery pupils
    ctx.shadowBlur = flash ? 0 : r * 0.3;
    ctx.fillStyle = flash ? '#fff' : 'rgba(255, 255, 100, 0.9)';
    ctx.beginPath();
    ctx.arc(-eyeX + r * 0.15, eyeY + r * 0.05, r * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(eyeX - r * 0.15, eyeY + r * 0.05, r * 0.08, 0, Math.PI * 2);
    ctx.fill();

    // ── MONSTROUS JAGGED MAW
    ctx.fillStyle = flash ? '#000' : 'rgba(15, 0, 5, 0.9)';
    ctx.shadowColor = flash ? '#000' : '#ff0000';
    ctx.shadowBlur = r * 0.4;
    
    // Mouth opens/shakes more aggressively when moving
    const mouthOpen = r * 0.4 + Math.abs(Math.sin(t * 6)) * r * 0.15;
    
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, r * 0.3); // Left edge of mouth
    // Top lip zig-zag
    ctx.lineTo(-r * 0.2, r * 0.1);
    ctx.lineTo(0, r * 0.2);
    ctx.lineTo(r * 0.2, r * 0.1);
    ctx.lineTo(r * 0.5, r * 0.3); // Right edge of mouth
    // Bottom lip gaping down
    ctx.quadraticCurveTo(0, r * 0.3 + mouthOpen * 2, -r * 0.5, r * 0.3);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;

    // HP bar drawn directly above boss
    if (obj.hp !== undefined) {
      const barW = r * 2.4;
      const barH = 7;
      const barX = -barW / 2;
      const barY = -r - 18;
      const hpFrac = Math.max(0, obj.hp / obj.maxHp);
      ctx.shadowBlur = 0;
      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath(); ctx.roundRect(barX - 1, barY - 1, barW + 2, barH + 2, 3); ctx.fill();
      // Fill
      const hpColor = hpFrac > 0.5 ? '#ff44cc' : hpFrac > 0.25 ? '#ff8800' : '#ff2200';
      ctx.fillStyle = hpColor;
      ctx.shadowColor = hpColor; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.roundRect(barX, barY, barW * hpFrac, barH, 2); ctx.fill();
      ctx.shadowBlur = 0;
      // HP text
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(r * 0.38)}px "Orbitron", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`HP ${obj.hp}/${obj.maxHp}`, 0, barY - 6);
    }

  } else if (obj.type === 'ghost') {
    const t = Date.now() * 0.003 + obj.x * 0.01;
    
    // ── GHOST AURA (Ethereal Glow)
    const aura = ctx.createRadialGradient(0, -r * 0.2, r * 0.1, 0, 0, r * 1.8);
    aura.addColorStop(0, 'rgba(50, 255, 200, 0.4)'); // spectral teal/cyan core
    aura.addColorStop(0.4, 'rgba(20, 100, 200, 0.15)');
    aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2);
    ctx.fill();

    // ── GHOST BODY (Classic Flowing Phantom)
    ctx.shadowColor = '#44ffff';
    ctx.shadowBlur = r * 0.6;
    
    // Tail waving effect based on time
    const wave1 = Math.sin(t) * r * 0.4;
    const wave2 = Math.cos(t * 1.3) * r * 0.6;
    
    const bodyGrad = ctx.createLinearGradient(0, -r, 0, r * 2.5);
    bodyGrad.addColorStop(0, 'rgba(230, 255, 250, 0.95)'); // bright head
    bodyGrad.addColorStop(0.3, 'rgba(150, 230, 240, 0.85)'); // fading mid
    bodyGrad.addColorStop(0.7, 'rgba(50, 150, 200, 0.4)'); // translucent tail
    bodyGrad.addColorStop(1, 'rgba(0, 50, 100, 0)');
    
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    
    // Head (smooth semi-circle at top)
    ctx.arc(0, -r * 0.2, r * 0.85, Math.PI, 0, false);
    
    // Right side flowing down to a wispy sharp tail point
    ctx.bezierCurveTo(
      r * 0.8, r * 0.6,
      r * 0.3 + wave1, r * 1.5,
      wave2, r * 2.2 // tail tip smoothly sweeps back and forth
    );
    
    // Left side flowing back up
    ctx.bezierCurveTo(
      -r * 0.3 + wave1, r * 1.5,
      -r * 0.8, r * 0.6,
      -r * 0.85, -r * 0.2
    );
    ctx.closePath();
    ctx.fill();

    // ── INNER HIGHLIGHT (Glassy phantom core)
    ctx.shadowBlur = 0;
    const innerGrad = ctx.createLinearGradient(0, -r * 0.8, 0, r * 0.5);
    innerGrad.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
    innerGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = innerGrad;
    
    ctx.beginPath();
    ctx.arc(0, -r * 0.2, r * 0.6, Math.PI, 0, false);
    ctx.bezierCurveTo(r * 0.5, r * 0.4, r * 0.1 + wave1 * 0.5, r * 1.2, wave2 * 0.5, r * 1.6);
    ctx.bezierCurveTo(-r * 0.1 + wave1 * 0.5, r * 1.2, -r * 0.5, r * 0.4, -r * 0.6, -r * 0.2);
    ctx.fill();

    // ── SPOOKY EMPTY HOLLOW EYES
    // The eyes are tilted slightly inwards to look angry/spooky
    const eyeY = -r * 0.35;
    const eyeX = r * 0.35;
    
    ctx.fillStyle = 'rgba(0, 20, 30, 0.9)'; // Void-like dark blue/black
    ctx.shadowColor = '#00ffff'; // Eerie cyan neon glow from inside the void
    ctx.shadowBlur = r * 0.3;
    
    // Left Eye
    ctx.beginPath();
    ctx.ellipse(-eyeX, eyeY, r * 0.22, r * 0.3, Math.PI / 8, 0, Math.PI * 2);
    ctx.fill();
    // Inner glowing speck
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(100, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(-eyeX + r * 0.05, eyeY - r * 0.05, r * 0.06, 0, Math.PI * 2);
    ctx.fill();

    // Right Eye
    ctx.fillStyle = 'rgba(0, 20, 30, 0.9)';
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = r * 0.3;
    ctx.beginPath();
    ctx.ellipse(eyeX, eyeY, r * 0.22, r * 0.3, -Math.PI / 8, 0, Math.PI * 2);
    ctx.fill();
    // Inner glowing speck
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(100, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(eyeX - r * 0.05, eyeY - r * 0.05, r * 0.06, 0, Math.PI * 2);
    ctx.fill();

    // ── GAPING GHOST MOUTH (Silent wail)
    ctx.fillStyle = 'rgba(0, 15, 25, 0.85)';
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = r * 0.2;
    ctx.beginPath();
    // Oval gaping mouth, varying size slightly
    ctx.ellipse(0, r * 0.1, r * 0.15, r * 0.35 + Math.sin(t * 2) * r * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
  } else if (obj.type === 'human') {

    const t = Date.now() * 0.005 + obj.x * 0.01;
    ctx.shadowBlur = 0;

    // ── SHADOW ON GROUND
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.95, r * 0.38, r * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();

    // SCRAMBLING LEGS (Animated based on time)
    const legSwing = Math.sin(t * 3) * r * 0.4;
    
    // BACK LEG
    ctx.fillStyle = '#1e3055'; // Dark blue jeans
    ctx.beginPath();
    ctx.roundRect(-r * 0.2 + legSwing, r * 0.1, r * 0.15, r * 0.8, r * 0.05);
    ctx.fill();
    
    // BACK SHOE
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.ellipse(-r * 0.12 + legSwing, r * 0.9, r * 0.15, r * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();

    // TORSO
    ctx.fillStyle = '#3a7bd5'; // Blue shirt
    ctx.beginPath();
    ctx.roundRect(-r * 0.35, -r * 0.3, r * 0.7, r * 0.6, r * 0.1);
    ctx.fill();
    // Torso shading
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.beginPath();
    ctx.roundRect(0, -r * 0.3, r * 0.35, r * 0.6, r * 0.1);
    ctx.fill();

    // FRONT LEG
    ctx.fillStyle = '#2a4a75'; // Blue jeans
    ctx.beginPath();
    ctx.roundRect(-r * 0.1 - legSwing, r * 0.1, r * 0.15, r * 0.8, r * 0.05);
    ctx.fill();
    
    // FRONT SHOE
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.ellipse(-r * 0.02 - legSwing, r * 0.9, r * 0.15, r * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // FLAILING ARMS
    const armSwing = Math.cos(t * 3) * r * 0.4;
    
    // LEFT ARM (Flailing up in panic)
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.15;
    ctx.strokeStyle = '#f8c898';
    
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, -r * 0.2); // Shoulder
    ctx.quadraticCurveTo(-r * 0.7 - armSwing, -r * 0.4, -r * 0.5 - armSwing, -r * 0.8); // Hand up
    ctx.stroke();

    // RIGHT ARM (Flailing up in panic)
    ctx.beginPath();
    ctx.moveTo(r * 0.3, -r * 0.2);
    ctx.quadraticCurveTo(r * 0.7 + armSwing, -r * 0.4, r * 0.5 + armSwing, -r * 0.8);
    ctx.stroke();
    
    // HEAD
    ctx.fillStyle = '#fde0b8'; // Skin tone
    ctx.beginPath();
    ctx.arc(0, -r * 0.6, r * 0.4, 0, Math.PI * 2);
    ctx.fill();

    // HAIR (Messy brown panic hair)
    ctx.fillStyle = '#4a3018';
    ctx.beginPath();
    ctx.arc(0, -r * 0.7, r * 0.42, Math.PI, 0, false);
    ctx.quadraticCurveTo(r * 0.2, -r * 0.5, r * 0.35, -r * 0.5);
    ctx.lineTo(r * 0.4, -r * 0.3);
    ctx.quadraticCurveTo(r * 0.2, -r * 0.5, -r * 0.4, -r * 0.3);
    ctx.closePath();
    ctx.fill();

    // TERRIFIED EYES
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-r * 0.15, -r * 0.6, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r * 0.15, -r * 0.6, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = '#000'; // tiny terrified pupils
    ctx.beginPath();
    ctx.arc(-r * 0.15, -r * 0.6, r * 0.03, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r * 0.15, -r * 0.6, r * 0.03, 0, Math.PI * 2);
    ctx.fill();

    // YELLING MOUTH
    ctx.fillStyle = '#600';
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.35, r * 0.08, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();


  }

  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawTrail() {
  if (trailPts.length < 2) return;
  const now = Date.now();
  const recent = trailPts.filter(p => now - p.t < 180);
  if (recent.length < 2) return;

  ctx.save();
  ctx.strokeStyle = Settings.sliceColor;
  ctx.shadowColor = Settings.sliceColor;

  for (let i = 1; i < recent.length; i++) {
    const age = (now - recent[i].t) / 180;
    const alpha = Math.max(0, 1 - age);
    const width = (1 - age) * 4 + 1;
    ctx.globalAlpha = alpha * 0.9;
    ctx.lineWidth = width;
    ctx.shadowBlur = width * 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(recent[i - 1].x, recent[i - 1].y);
    ctx.lineTo(recent[i].x, recent[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

// ─── GAME LOOP ───────────────────────────────────────────────
function gameLoop(timestamp) {
  requestAnimationFrame(gameLoop);

  const rawDt = Math.min(timestamp - (State.lastFrameTime || timestamp), 50);
  State.lastFrameTime = timestamp;

  if (State.scene !== 'playing') {
    // Draw background even when paused/menu so canvas isn't blank
    if (State.scene === 'paused') {
      drawBackground();
      for (const obj of objects) drawObject(obj);
    }
    return;
  }

  // Hit pause
  if (State.hitPauseTimer > 0) {
    State.hitPauseTimer -= rawDt;
    return;
  }

  const dt = rawDt * State.timeScale;

  // ── Update difficulty
  State.diffTimer += rawDt;
  if (State.diffTimer > 10000) {
    State.diffTimer = 0;
    State.diffLevel = Math.min(State.diffLevel + 1, 12);
    State.spawnInterval = Math.max(400, BASE_SPAWN_INTERVAL - State.diffLevel * 42);
  }

  // ── Boss timer
  if (!State.bossActive) {
    State.bossTimer += rawDt;
    if (State.bossTimer >= BOSS_INTERVAL) {
      State.bossTimer = 0;
      triggerBoss();
    }
  }

  // ── Slow mo timer
  if (State.slowMoTimer > 0) {
    State.slowMoTimer -= rawDt;
    // Boss bar is driven by HP (updated in handleBossSlice), not slow-mo timer
    if (State.slowMoTimer <= 0) deactivateSlowMo();
  }

  // ── Spawn
  if (!State.bossActive) {
    State.spawnTimer += rawDt;
    if (State.spawnTimer >= State.spawnInterval) {
      State.spawnTimer = 0;
      objects.push(spawnRandom());
    }
  }

  // ── Update objects — dt is already scaled by timeScale, convert ms→seconds
  const dtSec = dt / 1000;
  for (const obj of objects) {
    if (!obj.alive) continue;
    obj.vy += GRAVITY * dtSec;   // px/s² * s = px/s
    obj.x += obj.vx * dtSec;   // px/s  * s = px
    obj.y += obj.vy * dtSec;
    obj.rotation += obj.rotSpeed * dtSec;
    if (obj.hitFlash > 0) obj.hitFlash -= dtSec;


    // Off screen
    if (obj.y > H + obj.size * 2) {
      obj.alive = false;
      if (obj.type === 'ghost' && !obj.sliced) {
        if (State.difficulty === 'hard') {
          triggerGameOver('You missed a ghost! (Hard Mode)');
        } else if (State.difficulty === 'regular') {
          State.misses++;
          State.combo = 0;
          updateHUD();
          if (State.misses >= MAX_MISSES) triggerGameOver('Too many ghosts escaped!');
        } else {
          // Easy mode: just reset combo, no miss penalty
          State.combo = 0;
        }
      }
      if (obj.type === 'boss' && State.bossActive) {
        // Boss fell off without being killed — end boss phase
        deactivateSlowMo();
      }
    }
  }

  // Clean up dead objects
  objects = objects.filter(o => o.alive || !o.sliced && o.y < H + 100);

  // ── Update particles
  for (const p of particles) {
    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;
    p.vy += 300 * dtSec;        // particle gravity in px/s²
    p.life -= p.decay * dtSec;
  }
  particles = particles.filter(p => p.life > 0);

  // ── Combo decay
  if (State.combo > 0 && Date.now() - State.lastComboTime > 2500) {
    State.combo = 0;
  }

  // ── Clean trail
  const now = Date.now();
  trailPts = trailPts.filter(p => now - p.t < 200);

  // ── RENDER
  drawBackground();
  drawTrail();
  for (const obj of objects) drawObject(obj);
  drawParticles();
}

// ─── MENU BG GHOSTS ──────────────────────────────────────────
function spawnMenuGhosts() {
  const container = document.getElementById('menuBgGhosts');
  if (!container) return;
  const ghosts = ['👻', '👻', '👻', '💀', '👿'];
  for (let i = 0; i < 10; i++) {
    const el = document.createElement('div');
    el.className = 'bg-ghost';
    el.textContent = ghosts[Math.floor(Math.random() * ghosts.length)];
    el.style.left = Math.random() * 100 + 'vw';
    el.style.fontSize = (1.5 + Math.random() * 2.5) + 'rem';
    const dur = 10 + Math.random() * 18;
    el.style.animationDuration = dur + 's';
    el.style.animationDelay = -(Math.random() * dur) + 's';
    container.appendChild(el);
  }
}

// ─── PERSISTENCE ─────────────────────────────────────────────
const Persist = {
  KEY: 'ghostHunter_v1',
  save() {
    localStorage.setItem(this.KEY, JSON.stringify({
      hi: State.hi,
      sliceColor: Settings.sliceColor,
      musicOn: Settings.musicOn,
      sfxOn: Settings.sfxOn,
      musicVol: Settings.musicVol,
      sfxVol: Settings.sfxVol,
    }));
  },
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(this.KEY) || '{}');
      
      // Migrate old single high score
      if (typeof d.hi === 'number') {
        State.hi.regular = d.hi;
      } else if (d.hi && typeof d.hi === 'object') {
        State.hi = { ...State.hi, ...d.hi };
      }

      if (d.sliceColor) Settings.sliceColor = d.sliceColor;
      if (d.musicOn !== undefined) Settings.musicOn = d.musicOn;
      if (d.sfxOn !== undefined) Settings.sfxOn = d.sfxOn;
      if (d.musicVol !== undefined) Settings.musicVol = d.musicVol;
      if (d.sfxVol !== undefined) Settings.sfxVol = d.sfxVol;
    } catch (e) { }
  },
  isFirstTime() {
    return !localStorage.getItem(this.KEY);
  },
};

function syncDifficultyUI() {
  const be = document.getElementById('bestEasy');
  const br = document.getElementById('bestRegular');
  const bh = document.getElementById('bestHard');
  if (be) be.textContent = 'BEST: ' + State.hi.easy;
  if (br) br.textContent = 'BEST: ' + State.hi.regular;
  if (bh) bh.textContent = 'BEST: ' + State.hi.hard;
}

// ─── SETTINGS UI SYNC ────────────────────────────────────────
function syncSettingsUI() {
  document.getElementById('musicToggle').checked = Settings.musicOn;
  document.getElementById('sfxToggle').checked = Settings.sfxOn;
  document.getElementById('musicVol').value = Math.round(Settings.musicVol * 100);
  document.getElementById('sfxVol').value = Math.round(Settings.sfxVol * 100);
  document.getElementById('musicVolVal').textContent = Math.round(Settings.musicVol * 100) + '%';
  document.getElementById('sfxVolVal').textContent = Math.round(Settings.sfxVol * 100) + '%';

  document.querySelectorAll('.color-card').forEach(card => {
    card.classList.toggle('active', card.dataset.color === Settings.sliceColor);
  });
  // Sync audio UI state (toggles + pause buttons)
  if (typeof syncAudioUI === 'function') syncAudioUI();
}

// ─── UI BINDINGS ─────────────────────────────────────────────
document.getElementById('btnPlay').addEventListener('click', () => {
  getAudioCtx();
  showScreen('difficultyMenu');
});

document.getElementById('btnDiffEasy').addEventListener('click', () => {
  State.difficulty = 'easy';
  if (Persist.isFirstTime()) showScreen('tutorialOverlay');
  else startGame();
});

document.getElementById('btnDiffRegular').addEventListener('click', () => {
  State.difficulty = 'regular';
  if (Persist.isFirstTime()) showScreen('tutorialOverlay');
  else startGame();
});

document.getElementById('btnDiffHard').addEventListener('click', () => {
  State.difficulty = 'hard';
  if (Persist.isFirstTime()) showScreen('tutorialOverlay');
  else startGame();
});

document.getElementById('btnDiffBack').addEventListener('click', () => {
  showScreen('mainMenu');
});

document.getElementById('btnTutOk').addEventListener('click', () => {
  Persist.save();
  startGame();
});

document.getElementById('btnTutBack').addEventListener('click', () => {
  showScreen('mainMenu');
});

document.getElementById('btnSettings').addEventListener('click', () => {
  syncSettingsUI();
  showScreen('settingsMenu');
});

document.getElementById('btnSettingsBack').addEventListener('click', () => {
  Persist.save();
  showScreen('mainMenu');
});

document.getElementById('btnSpectrumMenu').addEventListener('click', () => {
  syncSettingsUI();
  showScreen('spectrumMenu');
});

document.getElementById('btnSpectrumBack').addEventListener('click', () => {
  Persist.save();
  showScreen('mainMenu');
});

document.getElementById('btnHowToPlay').addEventListener('click', () => {
  showScreen('tutorialOverlay');
});

// Color cards (Premium Grid)
document.getElementById('premiumColorGrid').addEventListener('click', e => {
  const card = e.target.closest('.color-card');
  if (!card) return;
  Settings.sliceColor = card.dataset.color;
  document.querySelectorAll('.color-card').forEach(s => s.classList.toggle('active', s === card));
  
  // Visual feedback: brief flash
  card.style.transform = 'scale(0.95)';
  setTimeout(() => card.style.transform = '', 100);
  
  Persist.save();
});

// ── Shared helper: sync all music/sfx UI elements to current Settings state
function syncAudioUI() {
  // Settings page toggles
  const mt = document.getElementById('musicToggle');
  const st = document.getElementById('sfxToggle');
  if (mt) mt.checked = Settings.musicOn;
  if (st) st.checked = Settings.sfxOn;

  // Pause menu buttons
  const pmm = document.getElementById('btnPauseMuteMusic');
  const pms = document.getElementById('btnPauseMuteSFX');
  if (pmm) pmm.textContent = Settings.musicOn ? '🎵 MUTE MUSIC' : '🎵 UNMUTE MUSIC';
  if (pms) pms.textContent = Settings.sfxOn ? '🔊 MUTE SFX' : '🔊 UNMUTE SFX';
}

// Music toggle (settings page)
document.getElementById('musicToggle').addEventListener('change', e => {
  Settings.musicOn = e.target.checked;
  if (Settings.musicOn) {
    startMusic();
  } else {
    stopMusic();
  }
  updateMusicVol(Settings.musicVol); // apply immediately
  syncAudioUI();
  Persist.save();
});

// SFX toggle (settings page)
document.getElementById('sfxToggle').addEventListener('change', e => {
  Settings.sfxOn = e.target.checked;
  updateSfxVol(); // applies to master gain instantly
  syncAudioUI();
  Persist.save();
});

// Music volume slider
document.getElementById('musicVol').addEventListener('input', e => {
  Settings.musicVol = e.target.value / 100;
  document.getElementById('musicVolVal').textContent = e.target.value + '%';
  updateMusicVol(Settings.musicVol);
  Persist.save();
});

// SFX volume slider
document.getElementById('sfxVol').addEventListener('input', e => {
  Settings.sfxVol = e.target.value / 100;
  document.getElementById('sfxVolVal').textContent = e.target.value + '%';
  updateSfxVol();
  Persist.save();
});

// Pause
document.getElementById('btnPause').addEventListener('click', pauseGame);
document.getElementById('btnResume').addEventListener('click', resumeGame);

// Pause menu — mute music
document.getElementById('btnPauseMuteMusic').addEventListener('click', () => {
  Settings.musicOn = !Settings.musicOn;
  if (Settings.musicOn) {
    startMusic();
  } else {
    stopMusic();
  }
  updateMusicVol(Settings.musicVol);
  syncAudioUI();
  Persist.save();
});

// Pause menu — mute SFX
document.getElementById('btnPauseMuteSFX').addEventListener('click', () => {
  Settings.sfxOn = !Settings.sfxOn;
  updateSfxVol();
  syncAudioUI();
  Persist.save();
});

document.getElementById('btnPauseExit').addEventListener('click', () => {
  State.scene = 'menu';
  stopMusic();
  showHUD(false);
  deactivateSlowMo();
  showScreen('mainMenu');
});

// Game over buttons
document.getElementById('btnRestart').addEventListener('click', startGame);
document.getElementById('btnGoMenu').addEventListener('click', () => {
  State.scene = 'menu';
  showScreen('mainMenu');
});

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    if (State.scene === 'playing') pauseGame();
    else if (State.scene === 'paused') resumeGame();
  }
});

// ─── MENU INTERACTIVITY ──────────────────────────────────────
const mainMenuElem = document.getElementById('mainMenu');
const menuCursorGlow = document.getElementById('menuCursorGlow');
const menuTitleWrap = document.getElementById('menuTitleWrap');

mainMenuElem.addEventListener('mousemove', e => {
  if (!mainMenuElem.classList.contains('active')) return;
  
  // Update mouse glow cursor
  menuCursorGlow.style.opacity = '1';
  menuCursorGlow.style.left = e.clientX + 'px';
  menuCursorGlow.style.top = e.clientY + 'px';

  // 3D Title Parallax Tilt
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const dx = (e.clientX - cx) / cx;
  const dy = (e.clientY - cy) / cy;
  
  const tiltX = dy * -8; // subtle 8 degree max
  const tiltY = dx * 8;
  
  menuTitleWrap.style.transform = `rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
});

mainMenuElem.addEventListener('mouseleave', () => {
  menuCursorGlow.style.opacity = '0';
  if (menuTitleWrap) menuTitleWrap.style.transform = `rotateX(0) rotateY(0)`;
});

// Global UI Sound Delegation
document.addEventListener('mouseover', e => {
  const target = e.target.closest('.btn, .diff-card, .pause-btn, .color-card');
  if (!target) return;
  
  // Avoid re-triggering if we move between children of the same button/card
  if (e.relatedTarget && target.contains(e.relatedTarget)) return;

  playHover();
});
document.addEventListener('mousedown', e => {
  const target = e.target.closest('.btn, .diff-card, .pause-btn, .color-card');
  if (target) playClick();
});

// ─── BOOT ────────────────────────────────────────────────────
Persist.load();
syncDifficultyUI();
syncSettingsUI();
spawnMenuGhosts();
showScreen('mainMenu');
requestAnimationFrame(gameLoop);