/**
 * Word Quest local persistence.
 *
 * IndexedDB is preferred in a browser. If opening or using IndexedDB fails,
 * the same repository API transparently falls back to one JSON document in
 * localStorage. Node and privacy-restricted browsers get an in-memory version
 * of that document, which keeps this module importable and testable without a
 * DOM.
 */

export const STORAGE_SCHEMA_VERSION = 1;
export const SINGLE_USER_ID = "local-player";
export const APP_SETTINGS_ID = "app-settings";

export const STORE_NAMES = Object.freeze({
  profiles: "profiles",
  settings: "settings",
  sessions: "sessions",
  attempts: "attempts",
  mastery: "mastery",
  dailySummaries: "dailySummaries",
});

const ALL_STORES = Object.freeze(Object.values(STORE_NAMES));
const DEFAULT_DB_NAME = "word-quest";
const DEFAULT_LOCAL_KEY = "word-quest:data:v1";
let generatedIdCounter = 0;

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function asIso(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value ?? fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback).toISOString() : date.toISOString();
}

export function toLocalDateKey(value = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("A valid date is required");
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function finiteNumber(value, fallback = 0, minimum = -Infinity) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, number) : fallback;
}

function makeId(prefix = "record") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  generatedIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${generatedIdCounter.toString(36)}`;
}

function masteryId(contentType, contentId, profileId = SINGLE_USER_ID) {
  if (!contentType || contentId === undefined || contentId === null) {
    throw new TypeError("contentType and contentId are required");
  }
  return `${profileId}:${String(contentType)}:${String(contentId)}`;
}

function dailySummaryId(date, profileId = SINGLE_USER_ID) {
  return `${profileId}:${toLocalDateKey(date)}`;
}

function defaultProfile(now) {
  return {
    id: SINGLE_USER_ID,
    nickname: "Player",
    selectedGrades: ["junior_1"],
    createdAt: now,
    updatedAt: now,
  };
}

function defaultSettings(now) {
  return {
    id: APP_SETTINGS_ID,
    profileId: SINGLE_USER_ID,
    dailyGoalMinutes: 5,
    notificationEnabled: false,
    notificationTime: "19:00",
    bgmVolume: 0.55,
    effectsVolume: 0.8,
    speechVolume: 1,
    vibrationEnabled: true,
    reducedMotion: false,
    effectIntensity: "normal",
    theme: "system",
    updatedAt: now,
  };
}

function emptyDocument() {
  return Object.fromEntries(ALL_STORES.map((storeName) => [storeName, {}]));
}

class MemoryKeyValueStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function usableLocalStorage(candidate) {
  if (!candidate) return null;
  const probe = `${DEFAULT_LOCAL_KEY}:probe`;
  try {
    candidate.setItem(probe, "1");
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return null;
  }
}

function browserLocalStorage() {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function validateStoreName(storeName) {
  if (!ALL_STORES.includes(storeName)) throw new TypeError(`Unknown store: ${storeName}`);
}

function normalizeDocument(value) {
  const result = emptyDocument();
  if (!value || typeof value !== "object") return result;
  for (const storeName of ALL_STORES) {
    const source = value[storeName];
    if (source && typeof source === "object" && !Array.isArray(source)) {
      result[storeName] = source;
    }
  }
  return result;
}

class JsonDocumentBackend {
  constructor(storage, key, type) {
    this.storage = storage;
    this.key = key;
    this.type = type;
    this.queue = Promise.resolve();
  }

  async open() {
    this.readDocument();
    return this;
  }

  readDocument() {
    const raw = this.storage.getItem(this.key);
    if (!raw) return emptyDocument();
    try {
      return normalizeDocument(JSON.parse(raw));
    } catch {
      // Keep a damaged payload available for manual recovery when possible.
      try {
        this.storage.setItem(`${this.key}:corrupt:${Date.now()}`, raw);
      } catch {
        // A quota/security error here must not prevent the fresh fallback.
      }
      return emptyDocument();
    }
  }

  writeDocument(document) {
    this.storage.setItem(this.key, JSON.stringify(normalizeDocument(document)));
  }

  mutate(mutator) {
    const operation = this.queue.then(() => {
      const document = this.readDocument();
      const result = mutator(document);
      this.writeDocument(document);
      return clone(result);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async get(storeName, key) {
    validateStoreName(storeName);
    await this.queue;
    return clone(this.readDocument()[storeName][String(key)]);
  }

  async getAll(storeName) {
    validateStoreName(storeName);
    await this.queue;
    return clone(Object.values(this.readDocument()[storeName]));
  }

  put(storeName, value) {
    validateStoreName(storeName);
    if (!value || value.id === undefined || value.id === null) {
      return Promise.reject(new TypeError(`Records in ${storeName} require an id`));
    }
    return this.mutate((document) => {
      document[storeName][String(value.id)] = clone(value);
      return value;
    });
  }

  putMany(storeName, values) {
    validateStoreName(storeName);
    return this.mutate((document) => {
      for (const value of values) {
        if (!value || value.id === undefined || value.id === null) {
          throw new TypeError(`Records in ${storeName} require an id`);
        }
        document[storeName][String(value.id)] = clone(value);
      }
      return values;
    });
  }

  delete(storeName, key) {
    validateStoreName(storeName);
    return this.mutate((document) => {
      delete document[storeName][String(key)];
    });
  }

  clear(storeName) {
    validateStoreName(storeName);
    return this.mutate((document) => {
      document[storeName] = {};
    });
  }

  clearAll() {
    return this.mutate((document) => {
      for (const storeName of ALL_STORES) document[storeName] = {};
    });
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

const STORE_INDEXES = Object.freeze({
  profiles: [],
  settings: [["profileId", "profileId"]],
  sessions: [["profileId", "profileId"], ["date", "date"]],
  attempts: [["profileId", "profileId"], ["sessionId", "sessionId"], ["date", "date"], ["contentKey", "contentKey"]],
  mastery: [["profileId", "profileId"], ["contentKey", "contentKey"], ["nextReviewAt", "nextReviewAt"]],
  dailySummaries: [["profileId", "profileId"], ["date", "date"]],
});

class IndexedDbBackend {
  constructor(indexedDB, name) {
    this.indexedDB = indexedDB;
    this.name = name;
    this.type = "indexedDB";
    this.db = null;
  }

  open() {
    if (this.db) return Promise.resolve(this);
    return new Promise((resolve, reject) => {
      let request;
      try {
        request = this.indexedDB.open(this.name, STORAGE_SCHEMA_VERSION);
      } catch (error) {
        reject(error);
        return;
      }

      request.onupgradeneeded = () => {
        const database = request.result;
        for (const storeName of ALL_STORES) {
          const store = database.objectStoreNames.contains(storeName)
            ? request.transaction.objectStore(storeName)
            : database.createObjectStore(storeName, { keyPath: "id" });
          for (const [indexName, keyPath] of STORE_INDEXES[storeName]) {
            if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath, { unique: false });
          }
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        this.db.onversionchange = () => this.db?.close();
        resolve(this);
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to open IndexedDB"));
      request.onblocked = () => reject(new Error("IndexedDB upgrade was blocked"));
    });
  }

  store(storeName, mode = "readonly") {
    validateStoreName(storeName);
    if (!this.db) throw new Error("IndexedDB is not open");
    const transaction = this.db.transaction(storeName, mode);
    return { transaction, store: transaction.objectStore(storeName) };
  }

  async get(storeName, key) {
    const { store } = this.store(storeName);
    return clone(await requestResult(store.get(key)));
  }

  async getAll(storeName) {
    const { store } = this.store(storeName);
    if (typeof store.getAll === "function") return clone(await requestResult(store.getAll()));
    return new Promise((resolve, reject) => {
      const values = [];
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(clone(values));
          return;
        }
        values.push(cursor.value);
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to read IndexedDB cursor"));
    });
  }

  async put(storeName, value) {
    const { transaction, store } = this.store(storeName, "readwrite");
    store.put(clone(value));
    await transactionDone(transaction);
    return clone(value);
  }

  async putMany(storeName, values) {
    const { transaction, store } = this.store(storeName, "readwrite");
    for (const value of values) store.put(clone(value));
    await transactionDone(transaction);
    return clone(values);
  }

  async delete(storeName, key) {
    const { transaction, store } = this.store(storeName, "readwrite");
    store.delete(key);
    await transactionDone(transaction);
  }

  async clear(storeName) {
    const { transaction, store } = this.store(storeName, "readwrite");
    store.clear();
    await transactionDone(transaction);
  }

  async clearAll() {
    if (!this.db) throw new Error("IndexedDB is not open");
    const transaction = this.db.transaction(ALL_STORES, "readwrite");
    for (const storeName of ALL_STORES) transaction.objectStore(storeName).clear();
    await transactionDone(transaction);
  }
}

function recordContentType(record) {
  return record.contentType ?? record.content_type ?? record.category ?? "word";
}

function recordContentId(record) {
  return record.contentId ?? record.content_id ?? record.questionId ?? record.question_id;
}

function sortNewest(records, field) {
  return records.sort((left, right) => String(right[field] ?? "").localeCompare(String(left[field] ?? "")));
}

function inDateRange(record, from, to) {
  const date = record.date ?? toLocalDateKey(record.answeredAt ?? record.startedAt ?? record.updatedAt);
  return (!from || date >= from) && (!to || date <= to);
}

function importArray(source, key) {
  const value = source?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object").map((item) => clone(item));
}

export class WordQuestStorage {
  constructor(options = {}) {
    this.options = options;
    this.clock = typeof options.clock === "function" ? options.clock : () => new Date();
    this.dbName = options.dbName ?? DEFAULT_DB_NAME;
    this.localKey = options.localKey ?? DEFAULT_LOCAL_KEY;
    this.indexedDB = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
    // Node 26 exposes an experimental global localStorage getter that warns
    // when read without --localstorage-file. Only inspect window in browsers.
    this.localStorage = options.localStorage === undefined ? browserLocalStorage() : options.localStorage;
    this.backend = null;
    this.initializing = null;
    this.fallbackReason = null;
  }

  get backendType() {
    return this.backend?.type ?? "uninitialized";
  }

  nowIso() {
    return asIso(this.clock());
  }

  makeFallbackBackend() {
    const local = usableLocalStorage(this.localStorage);
    return new JsonDocumentBackend(local ?? new MemoryKeyValueStorage(), this.localKey, local ? "localStorage" : "memory");
  }

  async initialize() {
    if (this.backend) return this;
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      if (this.indexedDB?.open) {
        try {
          this.backend = await new IndexedDbBackend(this.indexedDB, this.dbName).open();
        } catch (error) {
          this.fallbackReason = error;
        }
      }
      if (!this.backend) this.backend = await this.makeFallbackBackend().open();
      await this.ensureDefaultsDirect();
      return this;
    })();
    try {
      return await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  async ready() {
    return this.initialize();
  }

  async ensureDefaultsDirect() {
    const now = this.nowIso();
    if (!(await this.backend.get(STORE_NAMES.profiles, SINGLE_USER_ID))) {
      await this.backend.put(STORE_NAMES.profiles, defaultProfile(now));
    }
    if (!(await this.backend.get(STORE_NAMES.settings, APP_SETTINGS_ID))) {
      await this.backend.put(STORE_NAMES.settings, defaultSettings(now));
    }
  }

  async switchToFallback(error) {
    this.fallbackReason = error;
    this.backend = await this.makeFallbackBackend().open();
    await this.ensureDefaultsDirect();
  }

  async call(method, ...args) {
    await this.initialize();
    try {
      return await this.backend[method](...args);
    } catch (error) {
      if (this.backend.type !== "indexedDB") throw error;
      await this.switchToFallback(error);
      return this.backend[method](...args);
    }
  }

  async getProfile() {
    return this.call("get", STORE_NAMES.profiles, SINGLE_USER_ID);
  }

  async saveProfile(patch = {}) {
    const current = (await this.getProfile()) ?? defaultProfile(this.nowIso());
    const record = {
      ...current,
      ...clone(patch),
      id: SINGLE_USER_ID,
      createdAt: current.createdAt ?? this.nowIso(),
      updatedAt: this.nowIso(),
    };
    return this.call("put", STORE_NAMES.profiles, record);
  }

  updateProfile(patch) {
    return this.saveProfile(patch);
  }

  async getSettings() {
    return this.call("get", STORE_NAMES.settings, APP_SETTINGS_ID);
  }

  async saveSettings(patch = {}) {
    const current = (await this.getSettings()) ?? defaultSettings(this.nowIso());
    const record = {
      ...current,
      ...clone(patch),
      id: APP_SETTINGS_ID,
      profileId: SINGLE_USER_ID,
      updatedAt: this.nowIso(),
    };
    return this.call("put", STORE_NAMES.settings, record);
  }

  updateSettings(patch) {
    return this.saveSettings(patch);
  }

  async createSession(input = {}) {
    const startedAt = asIso(input.startedAt, this.clock());
    const record = {
      ...clone(input),
      id: input.id ?? makeId("session"),
      profileId: SINGLE_USER_ID,
      mode: input.mode ?? "daily",
      startedAt,
      date: input.date ?? toLocalDateKey(startedAt),
      status: input.status ?? "active",
      score: finiteNumber(input.score),
      questionCount: finiteNumber(input.questionCount, 0, 0),
      correctCount: finiteNumber(input.correctCount, 0, 0),
      incorrectCount: finiteNumber(input.incorrectCount, 0, 0),
      maxCombo: finiteNumber(input.maxCombo, 0, 0),
    };
    return this.call("put", STORE_NAMES.sessions, record);
  }

  startSession(input) {
    return this.createSession(input);
  }

  async getSession(id) {
    return this.call("get", STORE_NAMES.sessions, id);
  }

  async updateSession(id, patch = {}) {
    const current = await this.getSession(id);
    if (!current) throw new Error(`Session not found: ${id}`);
    const record = { ...current, ...clone(patch), id, profileId: SINGLE_USER_ID };
    return this.call("put", STORE_NAMES.sessions, record);
  }

  async finishSession(id, summary = {}) {
    const current = await this.getSession(id);
    if (!current) throw new Error(`Session not found: ${id}`);
    const endedAt = asIso(summary.endedAt, this.clock());
    const elapsed = Math.max(0, new Date(endedAt).getTime() - new Date(current.startedAt).getTime());
    const durationSeconds = finiteNumber(summary.durationSeconds, Math.round(elapsed / 1000), 0);
    const record = {
      ...current,
      ...clone(summary),
      id,
      profileId: SINGLE_USER_ID,
      endedAt,
      durationSeconds,
      status: summary.status ?? "completed",
    };
    if (!current.dailyAppliedAt) {
      await this.incrementDailySummary(record.date ?? toLocalDateKey(endedAt), {
        studySeconds: durationSeconds,
        sessionCount: 1,
        highScore: finiteNumber(record.score, 0, 0),
      });
      record.dailyAppliedAt = this.nowIso();
    }
    return this.call("put", STORE_NAMES.sessions, record);
  }

  completeSession(id, summary) {
    return this.finishSession(id, summary);
  }

  async listSessions(options = {}) {
    let records = await this.call("getAll", STORE_NAMES.sessions);
    records = records.filter((record) => record.profileId === SINGLE_USER_ID && inDateRange(record, options.from, options.to));
    sortNewest(records, "startedAt");
    return options.limit ? records.slice(0, Math.max(0, options.limit)) : records;
  }

  async recordAttempt(input = {}) {
    const answeredAt = asIso(input.answeredAt, this.clock());
    const contentType = recordContentType(input);
    const contentId = recordContentId(input);
    const record = {
      ...clone(input),
      id: input.id ?? makeId("attempt"),
      profileId: SINGLE_USER_ID,
      answeredAt,
      date: input.date ?? toLocalDateKey(answeredAt),
      isCorrect: Boolean(input.isCorrect ?? input.is_correct),
      responseTimeMs: finiteNumber(input.responseTimeMs ?? input.response_time_ms, 0, 0),
      score: finiteNumber(input.score, 0, 0),
      combo: finiteNumber(input.combo, 0, 0),
      contentType,
      contentId,
      contentKey: contentId === undefined ? undefined : `${contentType}:${String(contentId)}`,
    };
    await this.call("put", STORE_NAMES.attempts, record);
    await this.incrementDailySummary(record.date, {
      questionCount: 1,
      correctCount: record.isCorrect ? 1 : 0,
      incorrectCount: record.isCorrect ? 0 : 1,
      score: record.score,
      maxCombo: record.combo,
      activeAnswerMs: record.responseTimeMs,
    });
    return record;
  }

  async getAttempt(id) {
    return this.call("get", STORE_NAMES.attempts, id);
  }

  async listAttempts(options = {}) {
    let records = await this.call("getAll", STORE_NAMES.attempts);
    records = records.filter((record) => {
      if (record.profileId !== SINGLE_USER_ID || !inDateRange(record, options.from, options.to)) return false;
      if (options.sessionId && record.sessionId !== options.sessionId) return false;
      if (options.contentType && record.contentType !== options.contentType) return false;
      if (options.contentId !== undefined && String(record.contentId) !== String(options.contentId)) return false;
      return true;
    });
    sortNewest(records, "answeredAt");
    return options.limit ? records.slice(0, Math.max(0, options.limit)) : records;
  }

  async getMastery(contentType, contentId) {
    return this.call("get", STORE_NAMES.mastery, masteryId(contentType, contentId));
  }

  async saveMastery(input = {}) {
    const contentType = recordContentType(input);
    const contentId = recordContentId(input);
    const id = masteryId(contentType, contentId);
    const current = (await this.call("get", STORE_NAMES.mastery, id)) ?? {};
    const record = {
      ...current,
      ...clone(input),
      id,
      profileId: SINGLE_USER_ID,
      contentType,
      contentId,
      contentKey: `${contentType}:${String(contentId)}`,
      updatedAt: this.nowIso(),
    };
    return this.call("put", STORE_NAMES.mastery, record);
  }

  putMastery(input) {
    return this.saveMastery(input);
  }

  async listMastery(options = {}) {
    let records = await this.call("getAll", STORE_NAMES.mastery);
    records = records.filter((record) => {
      if (record.profileId !== SINGLE_USER_ID) return false;
      if (options.contentType && record.contentType !== options.contentType) return false;
      if (options.dueBefore && record.nextReviewAt && record.nextReviewAt > asIso(options.dueBefore)) return false;
      return true;
    });
    return records.sort((left, right) => String(left.nextReviewAt ?? "").localeCompare(String(right.nextReviewAt ?? "")));
  }

  async getDailySummary(date = this.clock()) {
    return this.call("get", STORE_NAMES.dailySummaries, dailySummaryId(date));
  }

  async saveDailySummary(date, patch = {}) {
    const key = toLocalDateKey(date);
    const id = dailySummaryId(key);
    const current = (await this.call("get", STORE_NAMES.dailySummaries, id)) ?? {
      id,
      profileId: SINGLE_USER_ID,
      date: key,
      studySeconds: 0,
      sessionCount: 0,
      questionCount: 0,
      correctCount: 0,
      incorrectCount: 0,
      score: 0,
      highScore: 0,
      maxCombo: 0,
      activeAnswerMs: 0,
    };
    const record = { ...current, ...clone(patch), id, profileId: SINGLE_USER_ID, date: key, updatedAt: this.nowIso() };
    return this.call("put", STORE_NAMES.dailySummaries, record);
  }

  putDailySummary(date, patch) {
    return this.saveDailySummary(date, patch);
  }

  async incrementDailySummary(date, increments = {}) {
    const current = (await this.getDailySummary(date)) ?? {};
    const additiveFields = [
      "studySeconds",
      "sessionCount",
      "questionCount",
      "correctCount",
      "incorrectCount",
      "score",
      "activeAnswerMs",
      "learnedWordCount",
      "learnedPhraseCount",
      "grammarQuestionCount",
      "bossDefeatCount",
    ];
    const patch = {};
    for (const field of additiveFields) {
      patch[field] = finiteNumber(current[field], 0, 0) + finiteNumber(increments[field], 0, 0);
    }
    patch.maxCombo = Math.max(finiteNumber(current.maxCombo, 0, 0), finiteNumber(increments.maxCombo, 0, 0));
    patch.highScore = Math.max(finiteNumber(current.highScore, 0, 0), finiteNumber(increments.highScore, 0, 0));
    return this.saveDailySummary(date, patch);
  }

  async listDailySummaries(options = {}) {
    let records = await this.call("getAll", STORE_NAMES.dailySummaries);
    records = records.filter((record) => record.profileId === SINGLE_USER_ID && inDateRange(record, options.from, options.to));
    records.sort((left, right) => right.date.localeCompare(left.date));
    return options.limit ? records.slice(0, Math.max(0, options.limit)) : records;
  }

  async exportData() {
    await this.initialize();
    const data = {};
    for (const storeName of ALL_STORES) data[storeName] = await this.call("getAll", storeName);
    return {
      format: "word-quest-backup",
      schemaVersion: STORAGE_SCHEMA_VERSION,
      exportedAt: this.nowIso(),
      profileId: SINGLE_USER_ID,
      data,
    };
  }

  exportAllData() {
    return this.exportData();
  }

  async importData(payload, options = {}) {
    const source = payload?.data ?? payload;
    if (!source || typeof source !== "object") throw new TypeError("Invalid Word Quest backup");
    const mode = options.mode ?? "replace";
    if (!new Set(["replace", "merge"]).has(mode)) throw new TypeError(`Unsupported import mode: ${mode}`);
    if (mode === "replace") await this.call("clearAll");

    const collections = {
      profiles: importArray(source, STORE_NAMES.profiles).slice(0, 1).map((record) => ({ ...record, id: SINGLE_USER_ID })),
      settings: importArray(source, STORE_NAMES.settings).slice(0, 1).map((record) => ({ ...record, id: APP_SETTINGS_ID, profileId: SINGLE_USER_ID })),
      sessions: importArray(source, STORE_NAMES.sessions).map((record) => ({ ...record, profileId: SINGLE_USER_ID })),
      attempts: importArray(source, STORE_NAMES.attempts).map((record) => ({ ...record, profileId: SINGLE_USER_ID })),
      mastery: importArray(source, STORE_NAMES.mastery).map((record) => {
        const contentType = recordContentType(record);
        const contentId = recordContentId(record);
        return { ...record, id: masteryId(contentType, contentId), profileId: SINGLE_USER_ID, contentType, contentId };
      }),
      dailySummaries: importArray(source, STORE_NAMES.dailySummaries).map((record) => {
        const date = toLocalDateKey(record.date);
        return { ...record, id: dailySummaryId(date), profileId: SINGLE_USER_ID, date };
      }),
    };

    for (const storeName of ALL_STORES) {
      const values = collections[storeName];
      if (values.length) await this.call("putMany", storeName, values);
    }
    await this.ensureDefaultsDirect();
    return Object.fromEntries(ALL_STORES.map((storeName) => [storeName, collections[storeName].length]));
  }

  importAllData(payload, options) {
    return this.importData(payload, options);
  }

  async resetData(options = {}) {
    const profile = options.preserveProfile ? await this.getProfile() : null;
    const settings = options.preserveSettings ? await this.getSettings() : null;
    await this.call("clearAll");
    await this.ensureDefaultsDirect();
    if (profile) await this.saveProfile(profile);
    if (settings) await this.saveSettings(settings);
    return this.exportData();
  }

  resetAllData(options) {
    return this.resetData(options);
  }
}

export function createStorage(options = {}) {
  return new WordQuestStorage(options);
}

export const storage = createStorage();

export default storage;
