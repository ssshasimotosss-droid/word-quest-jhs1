const SETTINGS_KEY = "wordQuest.audio.settings.v1";

export const DEFAULT_AUDIO_SETTINGS = Object.freeze({
  bgmEnabled: true,
  sfxEnabled: true,
  speechEnabled: true,
  bgmVolume: 0.18,
  sfxVolume: 0.55,
  speechVolume: 1,
  speechRate: 0.88,
  speechPitch: 1,
  speechLang: "en-US",
  preferredVoice: "",
});

const BGM_THEMES = {
  home: {
    bpm: 104,
    type: "triangle",
    notes: [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23],
  },
  battle: {
    bpm: 132,
    type: "square",
    notes: [220, 261.63, 329.63, 293.66, 220, 329.63, 392, 329.63],
  },
  boss: {
    bpm: 148,
    type: "sawtooth",
    notes: [164.81, 196, 207.65, 246.94, 164.81, 233.08, 207.65, 196],
  },
  timeAttack: {
    bpm: 164,
    type: "square",
    notes: [329.63, 392, 493.88, 392, 349.23, 440, 523.25, 440],
  },
  result: {
    bpm: 92,
    type: "sine",
    notes: [261.63, 329.63, 392, 523.25, 392, 329.63, 293.66, 392],
  },
};

const SFX_PATTERNS = {
  click: [[520, 0, 0.045, "sine", 0.36]],
  correct: [
    [523.25, 0, 0.09, "triangle", 0.7],
    [659.25, 0.07, 0.1, "triangle", 0.66],
    [783.99, 0.15, 0.16, "triangle", 0.62],
  ],
  wrong: [
    [246.94, 0, 0.11, "sine", 0.52],
    [220, 0.1, 0.16, "sine", 0.4],
  ],
  combo: [
    [659.25, 0, 0.08, "square", 0.38],
    [783.99, 0.06, 0.08, "square", 0.35],
    [987.77, 0.12, 0.18, "triangle", 0.6],
  ],
  attack: [
    [180, 0, 0.08, "sawtooth", 0.45],
    [420, 0.035, 0.1, "sawtooth", 0.42],
  ],
  bossDefeat: [
    [261.63, 0, 0.12, "triangle", 0.62],
    [329.63, 0.09, 0.12, "triangle", 0.62],
    [392, 0.18, 0.12, "triangle", 0.62],
    [523.25, 0.27, 0.34, "triangle", 0.7],
  ],
  item: [
    [880, 0, 0.08, "sine", 0.48],
    [1174.66, 0.07, 0.16, "sine", 0.52],
  ],
  highScore: [
    [523.25, 0, 0.1, "triangle", 0.64],
    [659.25, 0.08, 0.1, "triangle", 0.64],
    [783.99, 0.16, 0.1, "triangle", 0.64],
    [1046.5, 0.24, 0.38, "triangle", 0.72],
  ],
  levelUp: [
    [392, 0, 0.1, "triangle", 0.55],
    [523.25, 0.08, 0.1, "triangle", 0.6],
    [659.25, 0.16, 0.1, "triangle", 0.64],
    [783.99, 0.24, 0.26, "triangle", 0.7],
  ],
};

let settings = loadSettings();
let audioContext = null;
let bgmMaster = null;
let sfxMaster = null;
let bgmTimer = null;
let bgmTheme = null;
let bgmStep = 0;
const activeBgmNodes = new Set();

function clamp(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
}

function canUseStorage() {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function sanitizeSettings(candidate = {}) {
  return {
    bgmEnabled: candidate.bgmEnabled !== false,
    sfxEnabled: candidate.sfxEnabled !== false,
    speechEnabled: candidate.speechEnabled !== false,
    bgmVolume: clamp(candidate.bgmVolume ?? DEFAULT_AUDIO_SETTINGS.bgmVolume, 0, 1),
    sfxVolume: clamp(candidate.sfxVolume ?? DEFAULT_AUDIO_SETTINGS.sfxVolume, 0, 1),
    speechVolume: clamp(candidate.speechVolume ?? DEFAULT_AUDIO_SETTINGS.speechVolume, 0, 1),
    speechRate: clamp(candidate.speechRate ?? DEFAULT_AUDIO_SETTINGS.speechRate, 0.5, 1.5),
    speechPitch: clamp(candidate.speechPitch ?? DEFAULT_AUDIO_SETTINGS.speechPitch, 0.5, 1.5),
    speechLang: typeof candidate.speechLang === "string" ? candidate.speechLang : "en-US",
    preferredVoice:
      typeof candidate.preferredVoice === "string" ? candidate.preferredVoice : "",
  };
}

function loadSettings() {
  if (!canUseStorage()) return { ...DEFAULT_AUDIO_SETTINGS };
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

function persistSettings() {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Audio remains usable even when storage is unavailable or full.
  }
}

function emitSettingsChange() {
  if (typeof globalThis.dispatchEvent !== "function" || typeof CustomEvent === "undefined") return;
  globalThis.dispatchEvent(
    new CustomEvent("wordquest:audio-settings", { detail: getAudioSettings() }),
  );
}

function updateMasterVolumes() {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  bgmMaster?.gain.setTargetAtTime(settings.bgmEnabled ? settings.bgmVolume : 0, now, 0.02);
  sfxMaster?.gain.setTargetAtTime(settings.sfxEnabled ? settings.sfxVolume : 0, now, 0.01);
}

export function getAudioSettings() {
  return { ...settings };
}

export function setAudioSettings(patch = {}) {
  settings = sanitizeSettings({ ...settings, ...patch });
  persistSettings();
  updateMasterVolumes();
  if (!settings.bgmEnabled) stopBgm();
  if (!settings.speechEnabled) stopSpeech();
  emitSettingsChange();
  return getAudioSettings();
}

export function resetAudioSettings() {
  settings = { ...DEFAULT_AUDIO_SETTINGS };
  persistSettings();
  updateMasterVolumes();
  emitSettingsChange();
  return getAudioSettings();
}

async function ensureAudioContext() {
  if (audioContext) return audioContext;
  const AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextConstructor) return null;

  audioContext = new AudioContextConstructor();
  bgmMaster = audioContext.createGain();
  sfxMaster = audioContext.createGain();
  bgmMaster.connect(audioContext.destination);
  sfxMaster.connect(audioContext.destination);
  updateMasterVolumes();
  return audioContext;
}

export async function unlockAudio() {
  const context = await ensureAudioContext();
  if (!context) return false;
  if (context.state === "suspended") {
    try {
      await context.resume();
    } catch {
      return false;
    }
  }
  return context.state === "running";
}

function scheduleTone(
  destination,
  frequency,
  startOffset,
  duration,
  type = "sine",
  level = 0.5,
  registry = null,
) {
  if (!audioContext || !destination) return;
  const startAt = audioContext.currentTime + Math.max(0, startOffset);
  const stopAt = startAt + Math.max(0.025, duration);
  const oscillator = audioContext.createOscillator();
  const envelope = audioContext.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(40, frequency), startAt);
  envelope.gain.setValueAtTime(0.0001, startAt);
  envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), startAt + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, stopAt);
  oscillator.connect(envelope);
  envelope.connect(destination);

  if (registry) registry.add(oscillator);
  oscillator.addEventListener("ended", () => {
    registry?.delete(oscillator);
    oscillator.disconnect();
    envelope.disconnect();
  });
  oscillator.start(startAt);
  oscillator.stop(stopAt + 0.02);
}

function scheduleBgmStep(theme) {
  if (!audioContext || !bgmMaster || !settings.bgmEnabled) return;
  const note = theme.notes[bgmStep % theme.notes.length];
  const beatSeconds = 60 / theme.bpm;
  scheduleTone(
    bgmMaster,
    note,
    0,
    beatSeconds * 0.72,
    theme.type,
    theme.type === "sawtooth" ? 0.08 : 0.12,
    activeBgmNodes,
  );
  if (bgmStep % 4 === 0) {
    scheduleTone(
      bgmMaster,
      note / 2,
      0,
      beatSeconds * 1.35,
      "sine",
      0.08,
      activeBgmNodes,
    );
  }
  bgmStep += 1;
}

export async function startBgm(themeName = "home") {
  if (!settings.bgmEnabled) return false;
  const ready = await unlockAudio();
  if (!ready) return false;

  const theme = BGM_THEMES[themeName] || BGM_THEMES.home;
  stopBgm();
  bgmTheme = themeName in BGM_THEMES ? themeName : "home";
  bgmStep = 0;
  scheduleBgmStep(theme);
  const beatMilliseconds = Math.round((60 / theme.bpm) * 1000);
  bgmTimer = globalThis.setInterval(() => scheduleBgmStep(theme), beatMilliseconds);
  return true;
}

export function stopBgm() {
  if (bgmTimer !== null) {
    globalThis.clearInterval(bgmTimer);
    bgmTimer = null;
  }
  activeBgmNodes.forEach((oscillator) => {
    try {
      oscillator.stop();
    } catch {
      // The oscillator may already have stopped naturally.
    }
  });
  activeBgmNodes.clear();
  bgmTheme = null;
}

export function getCurrentBgmTheme() {
  return bgmTheme;
}

export async function playSfx(name = "click") {
  if (!settings.sfxEnabled) return false;
  const ready = await unlockAudio();
  if (!ready || !sfxMaster) return false;
  const pattern = SFX_PATTERNS[name] || SFX_PATTERNS.click;
  pattern.forEach(([frequency, offset, duration, type, level]) => {
    scheduleTone(sfxMaster, frequency, offset, duration, type, level);
  });
  return true;
}

export function getAvailableSfx() {
  return Object.keys(SFX_PATTERNS);
}

export function getAvailableBgmThemes() {
  return Object.keys(BGM_THEMES);
}

function waitForVoices(synth, timeoutMs = 900) {
  const initial = synth.getVoices?.() ?? [];
  if (initial.length || typeof synth.addEventListener !== "function") return Promise.resolve(initial);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      synth.removeEventListener?.("voiceschanged", finish);
      resolve(synth.getVoices?.() ?? []);
    };
    const timer = globalThis.setTimeout(finish, timeoutMs);
    synth.addEventListener("voiceschanged", finish, { once: true });
  });
}

function duckBgm(ducked) {
  if (!audioContext || !bgmMaster) return;
  const target = !settings.bgmEnabled ? 0 : ducked ? Math.min(0.025, settings.bgmVolume * 0.12) : settings.bgmVolume;
  bgmMaster.gain.setTargetAtTime(target, audioContext.currentTime, ducked ? 0.025 : 0.08);
}

export async function speak(text, options = {}) {
  const synth = globalThis.speechSynthesis;
  const SpeechSynthesisUtteranceConstructor = globalThis.SpeechSynthesisUtterance;
  if (
    !settings.speechEnabled ||
    !synth ||
    !SpeechSynthesisUtteranceConstructor ||
    typeof text !== "string" ||
    !text.trim()
  ) {
    return Promise.resolve(false);
  }

  if (options.cancelExisting !== false) synth.cancel();
  const utterance = new SpeechSynthesisUtteranceConstructor(text.trim());
  utterance.lang = options.lang || settings.speechLang;
  utterance.rate = clamp(options.rate ?? settings.speechRate, 0.5, 1.5);
  utterance.pitch = clamp(options.pitch ?? settings.speechPitch, 0.5, 1.5);
  utterance.volume = clamp(options.volume ?? settings.speechVolume, 0, 1);

  const voices = await waitForVoices(synth, options.voiceTimeoutMs ?? 900);
  const preferredVoice = options.voice || settings.preferredVoice;
  utterance.voice =
    voices.find((voice) => preferredVoice && voice.name === preferredVoice) ||
    voices.find((voice) => String(voice.lang).toLowerCase() === utterance.lang.toLowerCase()) ||
    voices.find((voice) => String(voice.lang).toLowerCase().startsWith("en-us")) ||
    voices.find((voice) => String(voice.lang).toLowerCase().startsWith("en")) ||
    null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      duckBgm(false);
      resolve(result);
    };
    utterance.addEventListener("end", () => finish(true), { once: true });
    utterance.addEventListener("error", () => finish(false), { once: true });
    const timeout = globalThis.setTimeout(
      () => finish(false),
      Math.min(30_000, Math.max(8_000, utterance.text.length * 180)),
    );
    duckBgm(true);
    try {
      synth.speak(utterance);
    } catch {
      finish(false);
    }
  });
}

export function stopSpeech() {
  globalThis.speechSynthesis?.cancel();
}

export function stopAllAudio() {
  stopBgm();
  stopSpeech();
}

// Friendly aliases for UI code that uses “music” and “sound” terminology.
export const playBgm = startBgm;
export const playSound = playSfx;

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!audioContext || !bgmMaster) return;
    const volume = document.hidden || !settings.bgmEnabled ? 0 : settings.bgmVolume;
    bgmMaster.gain.setTargetAtTime(volume, audioContext.currentTime, 0.03);
  });
}
