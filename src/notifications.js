const SETTINGS_KEY = "wordQuest.notification.settings.v1";
const NATIVE_NOTIFICATION_ID = 71001;
const TEST_NOTIFICATION_ID = 71002;

export const DEFAULT_NOTIFICATION_SETTINGS = Object.freeze({
  enabled: false,
  time: "19:00",
  quietHoursEnabled: true,
  quietStart: "21:00",
  quietEnd: "07:00",
  schoolHoursEnabled: true,
  schoolStart: "08:00",
  schoolEnd: "16:00",
  title: "WORD QUEST",
  message: "今日も3分だけ、英語クエストに挑戦しよう！",
  lastReminderLocalDate: "",
});

let settings = loadSettings();
let reminderTimer = null;
let capacitorPluginOverride = null;

function appUrl(path = "") {
  const base = globalThis.document?.baseURI ?? globalThis.location?.href ?? "http://localhost/";
  return new URL(path, new URL("./", base)).href;
}

function canUseStorage() {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function isTime(value) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function sanitizeText(value, fallback, maximumLength) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximumLength)
    : fallback;
}

function sanitizeSettings(candidate = {}) {
  return {
    enabled: candidate.enabled === true,
    time: isTime(candidate.time) ? candidate.time : DEFAULT_NOTIFICATION_SETTINGS.time,
    quietHoursEnabled: candidate.quietHoursEnabled !== false,
    quietStart: isTime(candidate.quietStart)
      ? candidate.quietStart
      : DEFAULT_NOTIFICATION_SETTINGS.quietStart,
    quietEnd: isTime(candidate.quietEnd)
      ? candidate.quietEnd
      : DEFAULT_NOTIFICATION_SETTINGS.quietEnd,
    schoolHoursEnabled: candidate.schoolHoursEnabled !== false,
    schoolStart: isTime(candidate.schoolStart)
      ? candidate.schoolStart
      : DEFAULT_NOTIFICATION_SETTINGS.schoolStart,
    schoolEnd: isTime(candidate.schoolEnd)
      ? candidate.schoolEnd
      : DEFAULT_NOTIFICATION_SETTINGS.schoolEnd,
    title: sanitizeText(candidate.title, DEFAULT_NOTIFICATION_SETTINGS.title, 48),
    message: sanitizeText(candidate.message, DEFAULT_NOTIFICATION_SETTINGS.message, 160),
    lastReminderLocalDate:
      typeof candidate.lastReminderLocalDate === "string"
        ? candidate.lastReminderLocalDate
        : "",
  };
}

function loadSettings() {
  if (!canUseStorage()) return { ...DEFAULT_NOTIFICATION_SETTINGS };
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
  } catch {
    return { ...DEFAULT_NOTIFICATION_SETTINGS };
  }
}

function persistSettings() {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Reminders continue for the current page lifetime when storage is unavailable.
  }
}

function emitSettingsChange() {
  if (typeof globalThis.dispatchEvent !== "function" || typeof CustomEvent === "undefined") return;
  globalThis.dispatchEvent(
    new CustomEvent("wordquest:notification-settings", {
      detail: getNotificationSettings(),
    }),
  );
}

function getCapacitorLocalNotifications() {
  return (
    capacitorPluginOverride ||
    globalThis.Capacitor?.Plugins?.LocalNotifications ||
    globalThis.capacitorLocalNotifications?.LocalNotifications ||
    globalThis.LocalNotifications ||
    null
  );
}

// A future native bootstrap may inject the official plugin after importing it.
// Keeping the import out of this module lets the browser build work without it.
export function registerCapacitorLocalNotifications(plugin) {
  capacitorPluginOverride = plugin?.schedule ? plugin : null;
  return Boolean(capacitorPluginOverride);
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function isWithinRange(minutes, start, end) {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  if (startMinutes === endMinutes) return true;
  if (startMinutes < endMinutes) {
    return minutes >= startMinutes && minutes < endMinutes;
  }
  return minutes >= startMinutes || minutes < endMinutes;
}

function isBlockedTime(minutes, candidate = settings) {
  if (
    candidate.quietHoursEnabled &&
    isWithinRange(minutes, candidate.quietStart, candidate.quietEnd)
  ) {
    return true;
  }
  return (
    candidate.schoolHoursEnabled &&
    isWithinRange(minutes, candidate.schoolStart, candidate.schoolEnd)
  );
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getNotificationSettings() {
  return { ...settings };
}

export function setNotificationSettings(patch = {}) {
  settings = sanitizeSettings({ ...settings, ...patch });
  persistSettings();
  if (!settings.enabled) stopInAppReminderWatcher();
  emitSettingsChange();
  return getNotificationSettings();
}

export function resetNotificationSettings() {
  settings = { ...DEFAULT_NOTIFICATION_SETTINGS };
  persistSettings();
  emitSettingsChange();
  return getNotificationSettings();
}

export function getNotificationCapability() {
  if (getCapacitorLocalNotifications()) {
    return { supported: true, channel: "capacitor", permission: "unknown" };
  }
  if (typeof Notification !== "undefined") {
    return { supported: true, channel: "web", permission: Notification.permission };
  }
  return { supported: false, channel: "in-app", permission: "unsupported" };
}

export async function requestNotificationPermission() {
  const plugin = getCapacitorLocalNotifications();
  if (plugin) {
    try {
      const current = await plugin.checkPermissions();
      let permission = current.display || current.notifications || "prompt";
      if (permission !== "granted") {
        const requested = await plugin.requestPermissions();
        permission = requested.display || requested.notifications || "denied";
      }
      return { supported: true, channel: "capacitor", permission };
    } catch {
      return { supported: false, channel: "capacitor", permission: "error" };
    }
  }

  if (typeof Notification === "undefined") {
    return { supported: false, channel: "in-app", permission: "unsupported" };
  }
  try {
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    return { supported: true, channel: "web", permission };
  } catch {
    return { supported: true, channel: "web", permission: "denied" };
  }
}

async function showWebNotification(title, options) {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.showNotification(title, options);
        return true;
      }
    } catch {
      // Fall through to a page-owned notification.
    }
  }
  try {
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

export async function showTestNotification(options = {}) {
  const title = options.title || settings.title;
  const body = options.body || "通知の準備ができました。明日も冒険を続けよう！";
  const permission = await requestNotificationPermission();
  if (permission.permission !== "granted") {
    return { shown: false, ...permission };
  }

  const plugin = getCapacitorLocalNotifications();
  if (plugin) {
    try {
      await plugin.schedule({
        notifications: [
          {
            id: TEST_NOTIFICATION_ID,
            title,
            body,
            schedule: { at: new Date(Date.now() + 750) },
            extra: { url: appUrl(), source: "word-quest-test" },
          },
        ],
      });
      return { shown: true, channel: "capacitor", permission: "granted" };
    } catch {
      return { shown: false, channel: "capacitor", permission: "error" };
    }
  }

  const shown = await showWebNotification(title, {
    body,
    icon: appUrl("icon-192.png"),
    badge: appUrl("icon-192.png"),
    tag: "word-quest-test",
    renotify: true,
    data: { url: appUrl() },
  });
  return { shown, channel: "web", permission: "granted" };
}

export function validateReminderTime(candidate = settings) {
  const normalized = sanitizeSettings({ ...settings, ...candidate });
  const reminderMinutes = timeToMinutes(normalized.time);
  if (isBlockedTime(reminderMinutes, normalized)) {
    return {
      valid: false,
      reason: "blocked-time",
      message: "通知時刻が学校時間または通知しない時間帯に含まれています。",
    };
  }
  return { valid: true, reason: "ok", message: "" };
}

export function checkInAppReminder(now = new Date(), { markAsShown = false } = {}) {
  if (!settings.enabled || !(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < timeToMinutes(settings.time) || isBlockedTime(minutes)) return null;

  const today = localDateKey(now);
  if (settings.lastReminderLocalDate === today) return null;
  const reminder = {
    id: `daily-${today}`,
    title: settings.title,
    message: settings.message,
    dueAt: settings.time,
    localDate: today,
  };
  if (markAsShown) markInAppReminderShown(now);
  return reminder;
}

export function markInAppReminderShown(now = new Date()) {
  settings = sanitizeSettings({
    ...settings,
    lastReminderLocalDate: localDateKey(now),
  });
  persistSettings();
  return settings.lastReminderLocalDate;
}

export function startInAppReminderWatcher(
  onReminder,
  { intervalMs = 30_000, fireImmediately = true } = {},
) {
  stopInAppReminderWatcher();
  const check = () => {
    const reminder = checkInAppReminder(new Date(), { markAsShown: false });
    if (!reminder) return;
    markInAppReminderShown(new Date());
    if (typeof onReminder === "function") onReminder(reminder);
    if (typeof globalThis.dispatchEvent === "function" && typeof CustomEvent !== "undefined") {
      globalThis.dispatchEvent(
        new CustomEvent("wordquest:reminder", { detail: reminder }),
      );
    }
  };
  if (fireImmediately) check();
  reminderTimer = globalThis.setInterval(check, Math.max(10_000, intervalMs));
  return stopInAppReminderWatcher;
}

export function stopInAppReminderWatcher() {
  if (reminderTimer !== null) {
    globalThis.clearInterval(reminderTimer);
    reminderTimer = null;
  }
}

export async function scheduleDailyReminder(patch) {
  if (patch) setNotificationSettings(patch);
  if (!settings.enabled) {
    await cancelDailyReminder();
    return { scheduled: false, channel: "none", reason: "disabled" };
  }

  const validation = validateReminderTime(settings);
  if (!validation.valid) {
    return { scheduled: false, channel: "none", reason: validation.reason };
  }

  const plugin = getCapacitorLocalNotifications();
  if (!plugin) {
    startInAppReminderWatcher();
    return {
      scheduled: true,
      channel: "in-app",
      reason: "Browser reminders run while WORD QUEST is open.",
    };
  }

  const permission = await requestNotificationPermission();
  if (permission.permission !== "granted") {
    return { scheduled: false, channel: "capacitor", reason: "permission-denied" };
  }

  const [hour, minute] = settings.time.split(":").map(Number);
  try {
    await plugin.cancel({ notifications: [{ id: NATIVE_NOTIFICATION_ID }] });
  } catch {
    // It is safe to continue when no previous notification exists.
  }
  try {
    await plugin.schedule({
      notifications: [
        {
          id: NATIVE_NOTIFICATION_ID,
          title: settings.title,
          body: settings.message,
          schedule: {
            on: { hour, minute },
            repeats: true,
            allowWhileIdle: true,
          },
          extra: { url: appUrl(), source: "word-quest-daily" },
        },
      ],
    });
    return { scheduled: true, channel: "capacitor", reason: "ok" };
  } catch {
    return { scheduled: false, channel: "capacitor", reason: "schedule-error" };
  }
}

export async function cancelDailyReminder() {
  stopInAppReminderWatcher();
  const plugin = getCapacitorLocalNotifications();
  if (!plugin) return { cancelled: true, channel: "in-app" };
  try {
    await plugin.cancel({ notifications: [{ id: NATIVE_NOTIFICATION_ID }] });
    return { cancelled: true, channel: "capacitor" };
  } catch {
    return { cancelled: false, channel: "capacitor" };
  }
}

export async function initializeNotifications({ onInAppReminder } = {}) {
  if (!settings.enabled) return { initialized: true, channel: "none" };
  const plugin = getCapacitorLocalNotifications();
  if (plugin) {
    let permission = "unknown";
    try {
      const result = await plugin.checkPermissions();
      permission = result.display || result.notifications || "prompt";
      if (permission === "granted") await scheduleDailyReminder();
    } catch {
      permission = "error";
    }
    return { initialized: true, channel: "capacitor", permission };
  }
  startInAppReminderWatcher(onInAppReminder);
  return { initialized: true, channel: "in-app" };
}
