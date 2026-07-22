import "./styles.css";

import storage from "./storage.js";
import {
  GameEngine,
  aggregateStats,
  calculateScore,
  checkAnswer,
  questionContentId,
  questionContentType,
  questionType,
  seededShuffle,
  updateMastery,
  weaknessScore,
} from "./game-engine.js";
import { resolveQuestionAudioText } from "./question-audio.js";
import {
  DAILY_CATEGORY_LABELS,
  buildCategorizedDailyQueue,
  filterQuestionsByCategory,
  questionMatchesCategory,
} from "./question-categories.js";
import {
  getAudioSettings,
  getCurrentBgmTheme,
  playSfx,
  setAudioSettings,
  speak,
  startBgm,
  stopAllAudio,
  stopBgm,
  unlockAudio,
} from "./audio.js";
import {
  getNotificationCapability,
  getNotificationSettings,
  initializeNotifications,
  scheduleDailyReminder,
  setNotificationSettings,
  showTestNotification,
} from "./notifications.js";

const app = document.querySelector("#app");
const topbar = document.querySelector("#topbar");
const bottomNav = document.querySelector("#bottom-nav");
const toastRegion = document.querySelector("#toast-region");
const effectsLayer = document.querySelector("#effects-layer");
const APP_BASE_URL = import.meta.env.BASE_URL;

const engine = new GameEngine({ seed: "word-quest-mvp" });
const MODE_NAMES = {
  daily: "今日のクエスト",
  time: "タイムアタック",
  weak: "苦手ダンジョン",
  stage: "ステージ練習",
  boss: "ミニボス戦",
};
const QUESTION_TYPE_LABELS = {
  en_to_ja_choice: "英語 → 日本語",
  ja_to_en_choice: "日本語 → 英語",
  spelling: "スペル入力",
  fill_blank: "空欄補充",
  word_order: "語順並べ替え",
  conversation_choice: "会話チャレンジ",
  listening_choice: "リスニング",
};
const GRADE_LABELS = {
  elementary: "小学校復習",
  jhs1: "中学1年",
  junior_1: "中学1年",
};
const DAILY_LIMITS = { 3: 8, 5: 12, 10: 20, 15: 30 };

const state = {
  content: null,
  contentMaps: null,
  profile: null,
  settings: null,
  stats: aggregateStats({}),
  today: null,
  sessions: [],
  mastery: [],
  attempts: [],
  screen: "loading",
  formGrades: new Set(["elementary", "jhs1"]),
  session: null,
  result: null,
  parentUnlocked: false,
  pinFailures: 0,
  pinLockedUntil: 0,
  installPrompt: null,
  audioUnlocked: false,
  timerId: null,
  online: navigator.onLine,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function formatNumber(value) {
  return new Intl.NumberFormat("ja-JP").format(Math.round(Number(value) || 0));
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return `${total}秒`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${minutes}分${rest}秒` : `${minutes}分`;
}

function localDateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function getLastDates(count) {
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (count - offset - 1));
    return localDateKey(date);
  });
}

function normalizeGrades(grades) {
  const values = Array.isArray(grades) ? grades : [];
  const normalized = values.map((grade) => (grade === "junior_1" ? "jhs1" : grade));
  return [...new Set(normalized.filter((grade) => ["elementary", "jhs1"].includes(grade)))];
}

function createContentMaps(content) {
  return {
    word: new Map(content.words.map((item) => [item.id, item])),
    phrase: new Map(content.phrases.map((item) => [item.id, item])),
    grammar: new Map(content.grammarUnits.map((item) => [item.id, item])),
  };
}

function contentForQuestion(question) {
  return state.contentMaps?.[questionContentType(question)]?.get(questionContentId(question)) ?? null;
}

function questionGrade(question) {
  return contentForQuestion(question)?.grade ?? "jhs1";
}

function activeQuestions() {
  const grades = new Set(normalizeGrades(state.profile?.selectedGrades));
  if (!grades.size) grades.add("jhs1");
  return state.content.questions.filter((question) => grades.has(questionGrade(question)));
}

function labelForContent(type, id) {
  const item = state.contentMaps?.[type]?.get(id);
  if (!item) return id;
  return item.displayForm ?? item.lemma ?? item.expression ?? item.title ?? id;
}

function questionSpeechText(question) {
  return resolveQuestionAudioText(question, contentForQuestion(question));
}

function sessionDisplayName(session) {
  if (!session) return "クエスト";
  const category = DAILY_CATEGORY_LABELS[session.selectedCategory];
  if (session.mode === "daily" && category) return `今日のクエスト・${category.replace(/^\S+\s*/u, "")}`;
  if (session.mode === "stage" && category) return `ステージ練習・${category.replace(/^\S+\s*/u, "")}`;
  return MODE_NAMES[session.mode] ?? session.mode;
}

function applyVisualSettings() {
  const settings = state.settings ?? {};
  const systemDark = matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? true;
  const isLight = settings.theme === "light" || (settings.theme === "system" && !systemDark);
  document.body.classList.toggle("light-mode", isLight);
  document.body.classList.toggle("reduce-motion", Boolean(settings.reducedMotion));
  document.documentElement.style.setProperty("--text-scale", String(clamp(settings.textScale ?? 1, 0.9, 1.25)));
  setAudioSettings({
    bgmEnabled: Number(settings.bgmVolume ?? 0.55) > 0,
    sfxEnabled: Number(settings.effectsVolume ?? 0.8) > 0,
    speechEnabled: Number(settings.speechVolume ?? 1) > 0,
    bgmVolume: clamp(settings.bgmVolume ?? 0.55, 0, 1),
    sfxVolume: clamp(settings.effectsVolume ?? 0.8, 0, 1),
    speechVolume: clamp(settings.speechVolume ?? 1, 0, 1),
  });
}

async function refreshRecords() {
  const [sessions, attempts, mastery, summaries, today] = await Promise.all([
    storage.listSessions(),
    storage.listAttempts(),
    storage.listMastery(),
    storage.listDailySummaries(),
    storage.getDailySummary(new Date()),
  ]);
  state.sessions = sessions;
  state.attempts = attempts;
  state.mastery = mastery;
  state.today = today ?? {
    date: localDateKey(),
    studySeconds: 0,
    questionCount: 0,
    correctCount: 0,
    score: 0,
  };
  state.stats = aggregateStats({ sessions, attempts, mastery, dailySummaries: summaries });
}

function getTodayAccuracy() {
  const total = Number(state.today?.questionCount) || 0;
  return total ? Math.round(((Number(state.today?.correctCount) || 0) / total) * 100) : 0;
}

function profileLevel() {
  return Math.max(1, Math.floor((Number(state.profile?.xp) || 0) / 500) + 1);
}

function showToast(message, timeout = 2600) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toastRegion.replaceChildren(toast);
  window.setTimeout(() => {
    if (toast.isConnected) toast.remove();
  }, timeout);
}

function renderTopbar() {
  if (["loading", "onboarding"].includes(state.screen)) {
    topbar.classList.add("hidden");
    return;
  }
  topbar.classList.remove("hidden");
  const nickname = state.profile?.nickname || "勇者";
  topbar.innerHTML = `
    <div class="brand-lockup">
      <span class="brand-gem" aria-hidden="true">💎</span>
      <span class="brand-copy">
        <span class="brand-word">WORD QUEST</span>
        <span class="brand-sub">${escapeHtml(nickname)} ・ Lv.${profileLevel()}</span>
      </span>
    </div>
    <div class="top-stats" aria-label="ゲームステータス">
      <span class="mini-stat" title="コイン">🪙 ${formatNumber(state.profile?.coins)}</span>
      <span class="mini-stat" title="連続学習">🔥 ${formatNumber(state.stats.currentStreak)}</span>
    </div>`;
}

function renderNav() {
  if (["loading", "onboarding", "game", "result"].includes(state.screen)) {
    bottomNav.classList.add("hidden");
    return;
  }
  bottomNav.classList.remove("hidden");
  const items = [
    ["home", "✦", "ホーム"],
    ["learn", "⚔️", "クエスト"],
    ["history", "📊", "きろく"],
    ["settings", "⚙️", "設定"],
  ];
  bottomNav.innerHTML = items.map(([screen, icon, label]) => `
    <button class="nav-button" type="button" data-action="navigate" data-screen="${screen}"
      ${state.screen === screen ? 'aria-current="page"' : ""}>
      <span class="nav-icon" aria-hidden="true">${icon}</span>
      <span class="nav-label">${label}</span>
    </button>`).join("");
}

function render() {
  renderTopbar();
  renderNav();
  const renderers = {
    loading: renderLoading,
    onboarding: renderOnboarding,
    home: renderHome,
    learn: renderLearn,
    history: renderHistory,
    settings: renderSettings,
    parent: renderParent,
    game: renderGame,
    result: renderResult,
    error: renderError,
  };
  (renderers[state.screen] ?? renderHome)();
  requestAnimationFrame(() => app.focus({ preventScroll: true }));
}

function renderLoading() {
  app.innerHTML = `
    <section class="onboarding screen" aria-busy="true">
      <div class="onboarding-panel glass-card">
        <div class="onboarding-crest" aria-hidden="true">✦</div>
        <p class="eyebrow">Loading Adventure</p>
        <h1 class="screen-title">WORD QUEST</h1>
        <p class="screen-lead">冒険の準備中…</p>
      </div>
    </section>`;
}

function renderError() {
  app.innerHTML = `
    <section class="onboarding screen">
      <div class="onboarding-panel glass-card">
        <div class="onboarding-crest" aria-hidden="true">🛠️</div>
        <h1 class="screen-title">読み込みできませんでした</h1>
        <p class="screen-lead">通信を確認して、もう一度試してください。一度読み込んだ後はオフラインでも遊べます。</p>
        <div class="button-row" style="justify-content:center">
          <button class="primary-button" type="button" data-action="reload">もう一度</button>
        </div>
      </div>
    </section>`;
}

function renderOnboarding() {
  const nickname = state.profile?.nickname === "Player" ? "" : state.profile?.nickname ?? "";
  app.innerHTML = `
    <section class="onboarding screen">
      <div class="onboarding-panel glass-card">
        <div class="onboarding-crest" aria-hidden="true">💎</div>
        <p class="eyebrow">Your Adventure Starts</p>
        <h1 class="screen-title">英語の世界へ<br>出発しよう</h1>
        <p class="screen-lead">1日3分から。正解してモンスターを倒し、ハイスコアをねらおう。</p>
        <div class="field-group">
          <label for="nickname">ゲーム内のニックネーム</label>
          <input id="nickname" class="text-input" maxlength="12" autocomplete="nickname"
            placeholder="例：英語勇者" value="${escapeHtml(nickname)}" />
          <p class="helper-text">本名は不要です。入力内容はこの端末にだけ保存されます。</p>
        </div>
        <div class="field-group">
          <span class="field-label">学習する範囲（両方選べます）</span>
          <div class="grade-options">
            ${gradeOption("elementary", "🌱", "小学校復習", "基本単語・あいさつ")}
            ${gradeOption("jhs1", "⚔️", "中学1年", "単語・熟語・基本文法")}
          </div>
        </div>
        <div class="privacy-note">🔒 ログイン、広告、位置情報は使いません。学習記録は息子さんの端末内に保存されます。</div>
        <button class="primary-button" style="width:100%;margin-top:18px" type="button" data-action="finish-onboarding">
          冒険をはじめる →
        </button>
      </div>
    </section>`;
}

function gradeOption(id, icon, label, description) {
  const selected = state.formGrades.has(id);
  return `<button class="grade-option ${selected ? "selected" : ""}" type="button"
    data-action="toggle-onboarding-grade" data-grade="${id}" aria-pressed="${selected}">
    <span aria-hidden="true" style="font-size:1.35rem">${icon}</span>
    <strong>${label}</strong><span>${description}</span>
  </button>`;
}

function renderHome() {
  const goalSeconds = Math.max(180, Number(state.settings?.dailyGoalMinutes ?? 5) * 60);
  const studied = Number(state.today?.studySeconds) || 0;
  const goalPercent = clamp((studied / goalSeconds) * 100, 0, 100);
  const goalComplete = goalPercent >= 100;
  app.innerHTML = `
    <section class="screen">
      <div class="hero-card">
        <span class="hero-badge">${state.online ? "✦ 今日のクエスト" : "● オフラインで冒険中"}</span>
        <h1>ENGLISH <span>ADVENTURE</span></h1>
        <p>${goalComplete ? "今日の目標達成！さらにハイスコアへ挑戦しよう。" : "正解が攻撃になる。今日も少しだけ、英語の世界を進もう。"}</p>
        <div class="hero-progress">
          <div class="progress-label"><span>今日の目標</span><span>${formatDuration(studied)} / ${state.settings?.dailyGoalMinutes ?? 5}分</span></div>
          <div class="progress-track" role="progressbar" aria-label="今日の学習目標" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(goalPercent)}">
            <div class="progress-fill" style="width:${goalPercent}%"></div>
          </div>
        </div>
        <div class="button-row">
          <button class="primary-button" type="button" data-action="open-mode" data-mode="daily">⚔️ 今日のクエスト</button>
          <button class="ghost-button" type="button" data-action="open-mode" data-mode="time">⏱ タイムアタック</button>
        </div>
      </div>
      <div class="quick-stats">
        ${statCard("🔥", state.stats.currentStreak, "連続日数")}
        ${statCard("🎯", `${getTodayAccuracy()}%`, "今日の正答率")}
        ${statCard("🏆", formatNumber(state.stats.highScore), "ハイスコア")}
      </div>
      <div class="section-title"><h2>クエストを選ぶ</h2><small>${activeQuestions().length}問収録</small></div>
      ${renderModeGrid()}
      ${state.installPrompt ? `
        <div class="glass-card" style="padding:17px;margin-top:14px">
          <strong>📱 スマホにアプリとして追加できます</strong>
          <p class="helper-text">ホーム画面から1タップで起動。読み込み後はオフラインでも遊べます。</p>
          <button class="secondary-button" type="button" data-action="install-app">ホーム画面に追加</button>
        </div>` : ""}
    </section>`;
}

function statCard(icon, value, label) {
  return `<div class="stat-card"><span class="stat-icon" aria-hidden="true">${icon}</span><strong class="stat-value">${value}</strong><span class="stat-label">${label}</span></div>`;
}

function renderModeGrid() {
  return `<div class="mode-grid">
    ${modeCard("daily", "⚔️", "今日のクエスト", "3分から。新しい問題と復習をミックス", "#58e6ff")}
    ${modeCard("time", "⏱", "タイムアタック", "30秒から挑戦。スピードと正確さを磨こう", "#ffd166")}
    ${modeCard("weak", "🎯", "苦手ダンジョン", "間違えた問題を優先。時間制限なし", "#ff77bd")}
    ${modeCard("stage", "🗺️", "ステージ練習", "単語・熟語・文法から選んで特訓", "#53e6a3")}
    ${modeCard("boss", "🐉", "ミニボス戦", "10問の総合バトル。コンボ攻撃で倒そう", "#ff9b5c")}
  </div>`;
}

function modeCard(mode, icon, title, description, color) {
  return `<button class="mode-card" style="--mode-color:${color}" type="button" data-action="open-mode" data-mode="${mode}">
    <span class="mode-icon" aria-hidden="true">${icon}</span>
    <span class="mode-copy"><h3>${title}</h3><p>${description}</p></span>
    <span class="mode-arrow" aria-hidden="true">›</span>
  </button>`;
}

function renderLearn() {
  const grades = normalizeGrades(state.profile?.selectedGrades).map((grade) => GRADE_LABELS[grade]).join(" ＋ ");
  app.innerHTML = `
    <section class="screen">
      <div class="screen-head"><div><p class="eyebrow">Choose Your Quest</p><h1 class="screen-title">クエスト選択</h1><p class="screen-lead">学習範囲：${escapeHtml(grades || "中学1年")}</p></div></div>
      ${renderModeGrid()}
      <div class="section-title"><h2>収録コンテンツ</h2></div>
      <div class="quick-stats">
        ${statCard("📘", state.content.words.length, "英単語")}
        ${statCard("💬", state.content.phrases.length, "熟語・会話")}
        ${statCard("🏛️", state.content.grammarUnits.length, "文法単元")}
      </div>
      <div class="glass-card" style="padding:17px;margin-top:14px">
        <strong>🔊 英語を音で覚えよう</strong>
        <p class="helper-text">問題画面の読み上げボタンで、単語や例文の発音を何度でも聞けます。</p>
      </div>
    </section>`;
}

function renderHistory() {
  const days = getLastDates(7);
  const daily = new Map(state.stats.daily.map((day) => [day.date, day]));
  const values = days.map((date) => daily.get(date)?.studySeconds ?? 0);
  const maximum = Math.max(60, ...values);
  const recentSessions = state.sessions.filter((session) => session.status === "completed").slice(0, 6);
  const weak = [...state.mastery]
    .filter((item) => (item.incorrectCount ?? 0) > 0)
    .sort((left, right) => weaknessScore(right) - weaknessScore(left))
    .slice(0, 6);
  app.innerHTML = `
    <section class="screen">
      <div class="screen-head"><div><p class="eyebrow">Adventure Log</p><h1 class="screen-title">学習のきろく</h1><p class="screen-lead">がんばりを見える形に。点数より、続けた日を大切にします。</p></div></div>
      <div class="quick-stats">
        ${statCard("🔥", `${state.stats.currentStreak}日`, "連続学習")}
        ${statCard("✅", `${state.stats.accuracy}%`, "全体正答率")}
        ${statCard("🌟", state.stats.masteredContentCount, "習得項目")}
      </div>
      <div class="history-grid">
        <article class="history-card glass-card">
          <h2>直近7日の学習時間</h2>
          <div class="chart-bars" aria-label="直近7日の学習時間グラフ">
            ${days.map((date, index) => {
              const percent = Math.max(3, (values[index] / maximum) * 100);
              const weekday = new Intl.DateTimeFormat("ja-JP", { weekday: "short" }).format(new Date(`${date}T12:00:00`));
              return `<div class="chart-column" title="${date}: ${formatDuration(values[index])}"><div class="chart-bar-wrap"><div class="chart-bar" style="height:${percent}%"></div></div><small>${weekday}</small></div>`;
            }).join("")}
          </div>
        </article>
        <article class="history-card glass-card">
          <h2>最近のクエスト</h2>
          ${recentSessions.length ? `<ul class="record-list">${recentSessions.map((session) => `
            <li class="record-row"><span><strong>${escapeHtml(MODE_NAMES[session.mode] ?? session.mode)}</strong><span>${escapeHtml(session.date)} ・ ${formatDuration(session.durationSeconds)}</span></span><strong>${formatNumber(session.score)} pt</strong></li>`).join("")}</ul>` : `<div class="empty-state">最初のクエストに挑戦すると、ここに記録が残ります。</div>`}
        </article>
        <article class="history-card glass-card">
          <h2>次に復習したい項目</h2>
          ${weak.length ? `<ul class="weak-list">${weak.map((item) => `
            <li class="weak-row"><span><strong>${escapeHtml(labelForContent(item.contentType, item.contentId))}</strong><span>${item.incorrectCount ?? 0}回間違え ・ 習得Lv.${item.masteryLevel ?? 0}</span></span><span>🎯</span></li>`).join("")}</ul>` : `<div class="empty-state">まだ苦手データはありません。</div>`}
        </article>
        <article class="history-card glass-card">
          <h2>保護者向けレポート</h2>
          <p class="screen-lead">今日の学習時間、正答率、苦手を閲覧専用で確認できます。</p>
          <button class="secondary-button" type="button" data-action="open-parent">🔒 保護者画面を開く</button>
        </article>
      </div>
    </section>`;
}

function settingToggle(key, title, description, checked) {
  return `<div class="setting-row"><span class="setting-copy"><strong>${title}</strong><span>${description}</span></span><label class="switch"><input type="checkbox" data-setting="${key}" ${checked ? "checked" : ""}><span aria-hidden="true"></span><span class="sr-only">${title}</span></label></div>`;
}

function renderSettings() {
  const notification = getNotificationSettings();
  const capability = getNotificationCapability();
  const grades = new Set(normalizeGrades(state.profile?.selectedGrades));
  app.innerHTML = `
    <section class="screen">
      <div class="screen-head"><div><p class="eyebrow">Customize</p><h1 class="screen-title">設定</h1><p class="screen-lead">無理なく続けられるように、音・演出・学習時間を調整できます。</p></div></div>
      <div class="settings-grid">
        <article class="settings-card glass-card">
          <h2>👤 プロフィールと学習範囲</h2>
          <div class="field-group"><label for="setting-nickname">ニックネーム</label><input id="setting-nickname" class="text-input" maxlength="12" data-setting="nickname" value="${escapeHtml(state.profile?.nickname ?? "勇者")}"></div>
          <span class="field-label">学習範囲</span>
          <div class="segmented">
            <button class="segment-button ${grades.has("elementary") ? "selected" : ""}" type="button" data-action="toggle-profile-grade" data-grade="elementary">小学校復習</button>
            <button class="segment-button ${grades.has("jhs1") ? "selected" : ""}" type="button" data-action="toggle-profile-grade" data-grade="jhs1">中学1年</button>
          </div>
          <div class="field-group"><label for="daily-goal">毎日の目標</label><select id="daily-goal" class="select-input" data-setting="dailyGoalMinutes">${[3,5,10,15].map((value) => `<option value="${value}" ${Number(state.settings?.dailyGoalMinutes) === value ? "selected" : ""}>${value}分</option>`).join("")}</select></div>
        </article>
        <article class="settings-card glass-card">
          <h2>🎵 音と読み上げ</h2>
          ${rangeSetting("bgmVolume", "BGM", state.settings?.bgmVolume ?? 0.55)}
          ${rangeSetting("effectsVolume", "効果音", state.settings?.effectsVolume ?? 0.8)}
          ${rangeSetting("speechVolume", "英語読み上げ", state.settings?.speechVolume ?? 1)}
          <div class="button-row" style="margin-top:12px"><button class="ghost-button" type="button" data-action="test-sound">🔊 音をテスト</button><button class="ghost-button" type="button" data-action="test-speech">🗣️ 発音をテスト</button></div>
        </article>
        <article class="settings-card glass-card">
          <h2>✨ 表示と演出</h2>
          ${settingToggle("reducedMotion", "演出を弱くする", "動きと画面の振動を抑えます", state.settings?.reducedMotion)}
          ${settingToggle("vibrationEnabled", "振動", "対応スマホで攻撃を振動で伝えます", state.settings?.vibrationEnabled !== false)}
          <div class="field-group"><label for="text-scale">文字サイズ</label><select id="text-scale" class="select-input" data-setting="textScale">${[[0.9,"小さめ"],[1,"標準"],[1.12,"大きめ"],[1.25,"とても大きい"]].map(([value,label]) => `<option value="${value}" ${Number(state.settings?.textScale ?? 1) === value ? "selected" : ""}>${label}</option>`).join("")}</select></div>
          <div class="field-group"><label for="theme">テーマ</label><select id="theme" class="select-input" data-setting="theme"><option value="system" ${state.settings?.theme === "system" ? "selected" : ""}>端末に合わせる</option><option value="dark" ${state.settings?.theme === "dark" ? "selected" : ""}>ダーク</option><option value="light" ${state.settings?.theme === "light" ? "selected" : ""}>ライト</option></select></div>
        </article>
        <article class="settings-card glass-card">
          <h2>🔔 学習リマインダー</h2>
          ${settingToggle("notificationEnabled", "通知を使う", capability.supported ? "許可はここでボタンを押したときだけ求めます" : "このブラウザは通知非対応です", notification.enabled)}
          <div class="field-group"><label for="notification-time">通知時刻</label><input id="notification-time" class="text-input" type="time" data-setting="notificationTime" value="${escapeHtml(notification.time)}"></div>
          <p class="helper-text">Web版は開いている間と次回起動時に確認します。将来のアプリ版では、閉じていても定時通知できます。深夜と学校時間は通知しません。</p>
          <button class="ghost-button" style="margin-top:10px" type="button" data-action="test-notification">テスト通知</button>
        </article>
        <article class="settings-card glass-card">
          <h2>📱 スマホ・データ</h2>
          <div class="button-row">
            <button class="secondary-button" type="button" data-action="install-app">ホーム画面に追加</button>
            <button class="ghost-button" type="button" data-action="export-data">記録をバックアップ</button>
            <label class="ghost-button" for="import-data" role="button">バックアップを戻す</label>
            <input id="import-data" class="sr-only" type="file" accept="application/json" data-action="import-data">
          </div>
          <p class="helper-text">記録はサーバーに送られず、この端末の中だけにあります。機種変更の前にバックアップを保存してください。</p>
        </article>
        <article class="settings-card glass-card">
          <h2>🔒 保護者向け</h2>
          <p class="screen-lead">PINで保護した閲覧専用の学習レポートです。得点の修正はできません。</p>
          <button class="secondary-button" type="button" data-action="open-parent">保護者画面を開く</button>
        </article>
      </div>
      <div class="glass-card" style="padding:17px;margin-top:14px">
        <strong>学習記録を初期化</strong><p class="helper-text">バックアップを作ってからの実行をおすすめします。</p>
        <button class="danger-button" type="button" data-action="ask-reset">記録をすべて削除する</button>
      </div>
    </section>`;
}

function rangeSetting(key, label, value) {
  return `<div class="setting-row"><label class="setting-copy" for="${key}"><strong>${label}</strong><span>${Math.round(Number(value) * 100)}%</span></label><input id="${key}" class="range-input" type="range" min="0" max="1" step="0.05" value="${value}" data-setting="${key}"></div>`;
}

function renderParent() {
  if (!state.parentUnlocked) {
    const hasPin = Boolean(state.settings?.parentPinHash);
    const locked = Date.now() < state.pinLockedUntil;
    app.innerHTML = `
      <section class="screen">
        <button class="ghost-button" type="button" data-action="navigate" data-screen="settings">← 設定に戻る</button>
        <div class="parent-lock glass-card">
          <div class="onboarding-crest" aria-hidden="true">🔒</div>
          <h1 class="screen-title">${hasPin ? "保護者PIN" : "保護者PINを設定"}</h1>
          <p class="screen-lead">${hasPin ? "4〜8桁のPINを入力してください。" : "初回のみ、保護者が4〜8桁のPINを決めてください。"}</p>
          <form data-form="parent-pin">
            <label class="sr-only" for="parent-pin">PIN</label>
            <input id="parent-pin" name="pin" class="text-input" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="off" ${locked ? "disabled" : ""} required>
            <button class="primary-button" type="submit" ${locked ? "disabled" : ""}>${hasPin ? "レポートを開く" : "PINを設定"}</button>
          </form>
          ${locked ? `<p class="helper-text">入力が続けて失敗したため、30秒後に再度試せます。</p>` : ""}
          <p class="helper-text">このPINは家族内の誤操作防止用です。端末管理者に対する強固なセキュリティではありません。</p>
        </div>
      </section>`;
    return;
  }

  const weak = [...state.mastery].filter((item) => (item.incorrectCount ?? 0) > 0).sort((a, b) => weaknessScore(b) - weaknessScore(a)).slice(0, 8);
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const thisWeek = state.stats.daily.filter((day) => day.date >= localDateKey(weekStart));
  const weekSeconds = thisWeek.reduce((sum, day) => sum + day.studySeconds, 0);
  app.innerHTML = `
    <section class="screen">
      <div class="screen-head"><div><p class="eyebrow">Parent Report</p><h1 class="screen-title">保護者レポート</h1><p class="screen-lead">閲覧専用 ・ 得点や記録の修正はできません。</p></div><button class="ghost-button" type="button" data-action="lock-parent">ロック</button></div>
      <div class="quick-stats">
        ${statCard("⏱", formatDuration(state.today?.studySeconds), "今日の学習")}
        ${statCard("🎯", `${getTodayAccuracy()}%`, "今日の正答率")}
        ${statCard("🔥", `${state.stats.currentStreak}日`, "連続学習")}
      </div>
      <div class="history-grid">
        <article class="history-card glass-card"><h2>今週のまとめ</h2><ul class="record-list">
          <li class="record-row"><span><strong>学習時間</strong><span>直近7日</span></span><strong>${formatDuration(weekSeconds)}</strong></li>
          <li class="record-row"><span><strong>解いた数</strong><span>回答ベース</span></span><strong>${thisWeek.reduce((sum, day) => sum + day.questionCount, 0)}問</strong></li>
          <li class="record-row"><span><strong>ハイスコア</strong><span>全期間</span></span><strong>${formatNumber(state.stats.highScore)}</strong></li>
        </ul></article>
        <article class="history-card glass-card"><h2>復習候補</h2>${weak.length ? `<ul class="weak-list">${weak.map((item) => `<li class="weak-row"><span><strong>${escapeHtml(labelForContent(item.contentType,item.contentId))}</strong><span>誤答 ${item.incorrectCount}回 ・ 次回復習 ${item.nextReviewAt ? new Date(item.nextReviewAt).toLocaleDateString("ja-JP") : "未定"}</span></span><span>🎯</span></li>`).join("")}</ul>` : `<div class="empty-state">苦手データはまだありません。</div>`}</article>
        <article class="history-card glass-card"><h2>今日の記録を共有</h2><p class="screen-lead">スマホの共有メニューから、保護者のメモやメッセージへ送れます。</p><button class="secondary-button" type="button" data-action="share-report">📤 今日の記録を共有</button></article>
      </div>
    </section>`;
}

function renderGame() {
  const session = state.session;
  if (!session) {
    state.screen = "home";
    render();
    return;
  }
  const question = session.queue[session.index];
  const type = questionType(question);
  const feedback = session.feedback;
  const progress = session.mode === "time"
    ? clamp((session.timeRemaining / session.durationSeconds) * 100, 0, 100)
    : clamp(((session.index + (session.locked ? 1 : 0)) / session.queue.length) * 100, 0, 100);
  const enemyHp = clamp(100 - ((session.index + session.correctCount * 0.3) / session.queue.length) * 100, 0, 100);
  const categoryLabel = DAILY_CATEGORY_LABELS[session.selectedCategory]
    ?? (questionType(question) === "listening_choice" ? DAILY_CATEGORY_LABELS.listening : DAILY_CATEGORY_LABELS[questionContentType(question)]);
  app.innerHTML = `
    <section class="game-screen screen">
      <div class="game-toolbar">
        <button class="icon-button" type="button" data-action="ask-quit-game" aria-label="クエストを中断">✕</button>
        <div class="game-progress-copy"><strong>${escapeHtml(sessionDisplayName(session))}</strong><span>${session.mode === "time" ? `${session.correctCount}問正解` : `${session.index + 1} / ${session.queue.length}`}</span></div>
        <span id="game-timer" class="timer-pill ${session.timeRemaining <= 10 && session.mode === "time" ? "urgent" : ""}">${session.mode === "time" ? `${Math.ceil(session.timeRemaining)}秒` : formatDuration(session.elapsedSeconds)}</span>
      </div>
      <div class="progress-track" style="grid-column:1/-1"><div id="game-progress" class="progress-fill" style="width:${progress}%"></div></div>
      <div class="battle-stage" id="battle-stage">
        <div class="battle-hud">
          <div class="hud-chip"><span>SCORE</span><strong>${formatNumber(session.score)}</strong></div>
          <div class="hud-chip" style="text-align:right"><span>COMBO</span><strong>${session.combo} ×</strong></div>
        </div>
        <div class="monster-wrap"><div id="monster" class="monster" aria-hidden="true"></div><span class="monster-name">Word Slime ・ HP ${Math.ceil(enemyHp)}%</span></div>
      </div>
      <article class="question-panel glass-card">
        <div class="question-meta"><span class="question-badges"><span class="question-type">${escapeHtml(QUESTION_TYPE_LABELS[type] ?? type)}</span>${categoryLabel ? `<span class="question-category">${escapeHtml(categoryLabel)}</span>` : ""}</span><span class="difficulty-dots" aria-label="難しさ ${question.difficulty ?? 1}">${"●".repeat(question.difficulty ?? 1)}${"○".repeat(Math.max(0, 3 - (question.difficulty ?? 1)))}</span></div>
        <p class="prompt-label">QUESTION</p>
        <h1 class="question-prompt ${type === "spelling" ? "english" : ""}" style="white-space:pre-line">${escapeHtml(question.prompt)}</h1>
        <button class="speak-button" type="button" data-action="speak-question">${type === "listening_choice" ? "🔊 もう一度聞く" : "🔊 発音を聞く"}</button>
        ${renderAnswerArea(question)}
        ${feedback ? renderFeedback(question, feedback) : ""}
      </article>
    </section>`;
  if (["spelling", "fill_blank"].includes(type) && !session.locked) {
    requestAnimationFrame(() => document.querySelector("#answer-input")?.focus());
  }
}

function renderAnswerArea(question) {
  const session = state.session;
  const type = questionType(question);
  if (type === "word_order") {
    const selected = session.selectedOrder;
    const chosen = new Set(selected);
    return `<div class="word-answer" aria-label="並べた語句">${selected.length ? selected.map((index) => `<button class="word-chip" type="button" data-action="remove-word" data-index="${index}" ${session.locked ? "disabled" : ""}>${escapeHtml(question.preparedWords[index])}</button>`).join("") : `<span class="helper-text">カードをタップして文を作ろう</span>`}</div>
      <div class="word-bank" aria-label="単語カード">${question.preparedWords.map((word, index) => chosen.has(index) ? "" : `<button class="word-chip" type="button" data-action="add-word" data-index="${index}" ${session.locked ? "disabled" : ""}>${escapeHtml(word)}</button>`).join("")}</div>
      <div class="button-row" style="margin-top:10px"><button class="primary-button" type="button" data-action="submit-order" ${session.locked || !selected.length ? "disabled" : ""}>この順番で決定</button><button class="ghost-button" type="button" data-action="clear-order" ${session.locked || !selected.length ? "disabled" : ""}>やり直す</button></div>`;
  }
  if (["spelling", "fill_blank"].includes(type) && !(question.preparedChoices?.length)) {
    return `<form class="answer-form" data-form="answer"><label class="sr-only" for="answer-input">答え</label><input id="answer-input" name="answer" class="spell-input" lang="en" autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="英語で入力" ${session.locked ? "disabled" : ""} value="${escapeHtml(session.draftAnswer ?? "")}"><button class="primary-button" type="submit" ${session.locked ? "disabled" : ""}>答える</button></form>`;
  }
  return `<div class="choices">${(question.preparedChoices ?? []).map((choice, index) => {
    const wrong = session.wrongSelections.has(choice);
    const correct = session.locked && checkAnswer(question, choice, { stripTerminalPunctuation: true }).isCorrect;
    const css = correct ? "correct" : wrong ? "wrong" : "";
    return `<button class="choice-button ${css}" type="button" data-action="choose-answer" data-index="${index}" ${session.locked || wrong ? "disabled" : ""}><span class="choice-key">${String.fromCharCode(65 + index)}</span><strong>${escapeHtml(choice)}</strong><span class="choice-mark">${correct ? "✓" : wrong ? "↻" : ""}</span></button>`;
  }).join("")}</div>`;
}

function renderFeedback(question, feedback) {
  return `<div class="feedback-card ${feedback.kind === "success" ? "success" : "retry"}">
    <h2 class="feedback-title">${feedback.kind === "success" ? "✨" : "💡"} ${escapeHtml(feedback.title)}</h2>
    <p>${escapeHtml(feedback.message)}</p>
    ${feedback.showAnswer ? `<p style="margin-top:7px"><strong>答え：${escapeHtml(question.correctAnswer)}</strong><br>${escapeHtml(question.explanation ?? "")}</p>` : ""}
    <div class="button-row" style="margin-top:10px">
      ${feedback.canRetry ? `<button class="ghost-button" type="button" data-action="reveal-answer">答えを見る</button>` : ""}
      ${state.session.locked ? `<button class="primary-button" type="button" data-action="next-question">${state.session.index + 1 >= state.session.queue.length ? "結果を見る" : "次の問題"} →</button>` : ""}
    </div>
  </div>`;
}

function renderResult() {
  const result = state.result;
  if (!result) {
    state.screen = "home";
    render();
    return;
  }
  app.innerHTML = `
    <section class="screen">
      <article class="result-card glass-card">
        <div class="result-emblem" aria-hidden="true">${result.newHighScore ? "🏆" : result.accuracy >= 80 ? "✨" : "⚔️"}</div>
        <p class="eyebrow">Quest Complete</p>
        <h1>${result.newHighScore ? "NEW HIGH SCORE!" : "クエスト完了！"}</h1>
        <p class="screen-lead" style="margin-inline:auto">${result.accuracy >= 80 ? "すごい集中力！英語の力がまた一つ上がった。" : "最後まで挑戦したことが一番の成果。苦手は次のクエストで強さに変わるよ。"}</p>
        <div class="score-number">${formatNumber(result.score)}</div><div class="eyebrow">POINTS</div>
        <div class="result-grid">
          ${resultMetric(`${result.correctCount} / ${result.questionCount}`, "正解数")}
          ${resultMetric(`${result.accuracy}%`, "正答率")}
          ${resultMetric(`${result.maxCombo}`, "最大コンボ")}
          ${resultMetric(formatDuration(result.durationSeconds), "学習時間")}
        </div>
        <p class="privacy-note">🪙 ${result.coinsEarned}コイン獲得 ・ 学習記録はこの端末に保存しました。</p>
        <div class="button-row" style="justify-content:center;margin-top:18px"><button class="primary-button" type="button" data-action="navigate" data-screen="home">ホームへ</button><button class="ghost-button" type="button" data-action="retry-mode" data-mode="${result.mode}">もう一度</button></div>
      </article>
    </section>`;
}

function resultMetric(value, label) {
  return `<div class="result-metric"><strong>${value}</strong><span>${label}</span></div>`;
}

function showModal(contents) {
  closeModal();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "modal-backdrop";
  backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${contents}</div>`;
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.querySelector("button, input, select")?.focus());
}

function closeModal() {
  document.querySelector("#modal-backdrop")?.remove();
}

function openModeModal(mode) {
  const descriptions = {
    daily: ["今日のクエスト", "学習時間を選んでください。新しい問題と復習が自動で混ざります。"],
    time: ["タイムアタック", "制限時間内にどこまで連続正解できるか挑戦！"],
    weak: ["苦手ダンジョン", "これまでの間違いをもとに、復習問題を自動で選びます。"],
    stage: ["ステージ練習", "練習したいカテゴリを選んでください。"],
    boss: ["ミニボス戦", "10問の総合バトル。ミスを恐れず、コンボ攻撃で挑もう。"],
  };
  const [title, description] = descriptions[mode] ?? descriptions.daily;
  let options = "";
  if (mode === "daily") {
    options = `<p class="field-label">内容を選ぶ</p><div class="segmented daily-category-grid">${[
      ["word", "📘 単語", "単語の意味・スペル"],
      ["grammar", "🏛️ 文法", "穴埋め・語順"],
      ["listening", "🎧 リスニング", "音を聞いて答える"],
      ["mixed", "🌈 全部ミックス", "単語・文法・音声"],
    ].map(([category, label, detail]) => `<button class="segment-button daily-category-button" type="button" data-action="choose-daily-category" data-category="${category}"><strong>${label}</strong><small>${detail}</small></button>`).join("")}</div>`;
  } else if (mode === "time") {
    options = `<div class="segmented">${[30, 60, 90, 120].map((seconds) => `<button class="segment-button" type="button" data-action="start-mode" data-mode="time" data-value="${seconds}">${seconds}秒</button>`).join("")}</div>`;
  } else if (mode === "stage") {
    options = `<div class="segmented">${[["word", "📘 英単語"], ["phrase", "💬 熟語・会話"], ["grammar", "🏛️ 基本文法"]].map(([category, label]) => `<button class="segment-button" type="button" data-action="start-mode" data-mode="stage" data-value="${category}">${label}</button>`).join("")}</div>`;
  } else {
    options = `<button class="primary-button" style="width:100%" type="button" data-action="start-mode" data-mode="${mode}" data-value="10">挑戦する</button>`;
  }
  showModal(`<p class="eyebrow">Quest Select</p><h2>${title}</h2><p class="screen-lead">${description}</p><div style="margin:20px 0">${options}</div><button class="ghost-button" type="button" data-action="close-modal">やめる</button>`);
}

function openDailyDurationModal(category) {
  const selectedCategory = ["word", "grammar", "listening", "mixed"].includes(category) ? category : "mixed";
  const label = DAILY_CATEGORY_LABELS[selectedCategory];
  const options = `<div class="segmented">${[3, 5, 10, 15].map((minutes) => `<button class="segment-button" type="button" data-action="start-mode" data-mode="daily" data-category="${selectedCategory}" data-value="${minutes}">${minutes}分<br><small>約${DAILY_LIMITS[minutes]}問</small></button>`).join("")}</div>`;
  showModal(`<p class="eyebrow">Daily Quest</p><h2>${label}</h2><p class="screen-lead">学習時間を選んでください。同じ種類の問題だけでクエストを作ります。</p><div style="margin:20px 0">${options}</div><div class="button-row"><button class="ghost-button" type="button" data-action="open-mode" data-mode="daily">← 内容を選び直す</button><button class="ghost-button" type="button" data-action="close-modal">やめる</button></div>`);
}

function prepareQuestion(question, sessionId, index) {
  const type = questionType(question);
  const choices = Array.isArray(question.choices) ? question.choices : [];
  return {
    ...question,
    preparedChoices: type === "word_order" ? [] : seededShuffle(choices, `${sessionId}:${question.id}:choices`),
    preparedWords: type === "word_order" ? seededShuffle(choices, `${sessionId}:${question.id}:words`) : [],
    queueIndex: index,
  };
}

async function startMode(mode, value, category = null) {
  closeModal();
  await unlockForSound();
  const all = activeQuestions();
  const mastery = await storage.listMastery();
  const seed = `${mode}:${localDateKey()}:${Date.now()}`;
  let queue = [];
  let durationSeconds = null;
  let selectedCategory = null;

  if (mode === "daily") {
    const minutes = [3, 5, 10, 15].includes(Number(value)) ? Number(value) : 5;
    selectedCategory = ["word", "grammar", "listening", "mixed"].includes(category) ? category : "mixed";
    queue = buildCategorizedDailyQueue(all, mastery, {
      category: selectedCategory,
      limit: DAILY_LIMITS[minutes],
      seed,
    });
  } else if (mode === "time") {
    durationSeconds = [30, 60, 90, 120].includes(Number(value)) ? Number(value) : 60;
    const fastQuestions = all.filter((question) => Array.isArray(question.choices) && question.choices.length >= 2 && questionType(question) !== "word_order");
    queue = engine.buildTimeAttackQueue(fastQuestions, { durationSeconds, averageResponseTimeMs: 3200, seed, limit: Math.ceil(durationSeconds / 2) + 6 });
  } else if (mode === "weak") {
    queue = engine.buildWeaknessQueue(all, mastery, { limit: 12, seed });
    if (!queue.length) {
      queue = engine.selectQuestions(all, { limit: 10, seed });
      showToast("まだ苦手データがないため、総合問題を出題します。", 3500);
    }
  } else if (mode === "stage") {
    selectedCategory = ["word", "phrase", "grammar"].includes(value) ? value : "word";
    queue = engine.selectQuestions(filterQuestionsByCategory(all, selectedCategory), {
      contentTypes: [selectedCategory],
      limit: 12,
      seed,
    });
  } else if (mode === "boss") {
    queue = engine.selectQuestions(all, { limit: 10, seed });
  }

  if (!queue.length) {
    showToast("この範囲の問題がまだありません。");
    return;
  }
  if (selectedCategory && selectedCategory !== "mixed" && !queue.every((question) => questionMatchesCategory(question, selectedCategory))) {
    console.error("Question category invariant failed", { mode, selectedCategory, questionIds: queue.map(({ id }) => id) });
    showToast("出題内容の確認に失敗しました。もう一度選び直してください。", 4500);
    return;
  }

  const record = await storage.createSession({
    mode,
    contentVersion: state.content.contentVersion,
    selectedGrades: normalizeGrades(state.profile.selectedGrades),
    selectedCategory,
    durationLimitSeconds: durationSeconds,
    questionIds: queue.map((question) => question.id),
  });
  const now = Date.now();
  state.session = {
    id: record.id,
    mode,
    selectedCategory,
    queue: queue.map((question, index) => prepareQuestion(question, record.id, index)),
    index: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    correctCount: 0,
    incorrectCount: 0,
    startedAtMs: now,
    questionShownAtMs: now,
    durationSeconds,
    deadlineMs: durationSeconds ? now + durationSeconds * 1000 : null,
    timeRemaining: durationSeconds ?? 0,
    elapsedSeconds: 0,
    selectedOrder: [],
    wrongSelections: new Set(),
    wrongAttempted: false,
    locked: false,
    feedback: null,
    firstAttemptRecorded: false,
    finalizing: false,
  };
  state.screen = "game";
  startTimer();
  ensureBgm(mode === "time" ? "timeAttack" : mode === "boss" ? "boss" : "battle");
  render();
}

function startTimer() {
  clearInterval(state.timerId);
  state.timerId = window.setInterval(() => {
    const session = state.session;
    if (!session || session.finalizing) return;
    const now = Date.now();
    session.elapsedSeconds = Math.max(0, Math.round((now - session.startedAtMs) / 1000));
    if (session.mode === "time") {
      session.timeRemaining = Math.max(0, (session.deadlineMs - now) / 1000);
      if (session.timeRemaining <= 0) {
        finishSession();
        return;
      }
    }
    updateTimerUi();
  }, 250);
}

function updateTimerUi() {
  const session = state.session;
  const timer = document.querySelector("#game-timer");
  if (!session || !timer) return;
  timer.textContent = session.mode === "time" ? `${Math.ceil(session.timeRemaining)}秒` : formatDuration(session.elapsedSeconds);
  timer.classList.toggle("urgent", session.mode === "time" && session.timeRemaining <= 10);
  if (session.mode === "time") {
    const progress = document.querySelector("#game-progress");
    if (progress) progress.style.width = `${clamp((session.timeRemaining / session.durationSeconds) * 100, 0, 100)}%`;
  }
}

async function recordAnswer(question, answer, isCorrect, responseTimeMs, { firstAttempt, scoreResult, hintUsed }) {
  const attempt = {
    sessionId: state.session.id,
    questionId: question.id,
    contentType: questionContentType(question),
    contentId: questionContentId(question),
    questionType: questionType(question),
    userAnswer: String(answer),
    isCorrect,
    responseTimeMs,
    score: firstAttempt ? scoreResult.total : 0,
    combo: firstAttempt ? scoreResult.combo : state.session.combo,
    firstAttempt,
    hintUsed: Boolean(hintUsed),
    contentVersion: state.content.contentVersion,
  };
  await storage.recordAttempt(attempt);
  const previous = await storage.getMastery(attempt.contentType, attempt.contentId);
  const mastery = updateMastery(previous ?? {}, attempt, new Date());
  await storage.saveMastery(mastery);
  return attempt;
}

async function submitAnswer(answer) {
  const session = state.session;
  if (!session || session.locked || session.finalizing) return;
  const question = session.queue[session.index];
  const responseTimeMs = Math.max(0, Date.now() - session.questionShownAtMs);
  const result = checkAnswer(question, answer, { stripTerminalPunctuation: true });
  const firstAttempt = !session.firstAttemptRecorded;
  const scoreResult = calculateScore({
    isCorrect: result.isCorrect,
    comboBefore: session.combo,
    responseTimeMs,
    difficulty: question.difficulty ?? 1,
    questionType: questionType(question),
    isReview: Boolean(await storage.getMastery(questionContentType(question), questionContentId(question))),
    perfectSpelling: questionType(question) === "spelling" && firstAttempt,
    hintUsed: !firstAttempt,
  });

  try {
    await recordAnswer(question, answer, result.isCorrect, responseTimeMs, {
      firstAttempt,
      scoreResult,
      hintUsed: !firstAttempt,
    });
  } catch (error) {
    console.error("Failed to save answer", error);
    showToast("記録の保存に問題が起きました。この回答は画面内で続行します。", 4000);
  }

  if (firstAttempt) {
    session.firstAttemptRecorded = true;
    if (result.isCorrect) {
      session.score += scoreResult.total;
      session.combo = scoreResult.combo;
      session.maxCombo = Math.max(session.maxCombo, session.combo);
      session.correctCount += 1;
    } else {
      session.combo = 0;
      session.incorrectCount += 1;
    }
    await storage.updateSession(session.id, {
      score: session.score,
      questionCount: session.correctCount + session.incorrectCount,
      correctCount: session.correctCount,
      incorrectCount: session.incorrectCount,
      maxCombo: session.maxCombo,
      currentIndex: session.index,
    });
  }

  if (result.isCorrect) {
    session.locked = true;
    session.feedback = {
      kind: "success",
      title: firstAttempt ? `正解！ +${scoreResult.total} pt` : "できた！",
      message: question.explanation ?? "その調子！",
      showAnswer: false,
      canRetry: false,
    };
    playSfx(session.combo >= 5 ? "combo" : "correct");
    animateMonster("hit");
    celebrateCorrect(session.combo, scoreResult.total);
    if (session.mode === "time") window.setTimeout(() => nextQuestion(), 620);
  } else if (firstAttempt && session.mode !== "time") {
    session.wrongAttempted = true;
    session.wrongSelections.add(String(answer));
    session.feedback = {
      kind: "retry",
      title: "おしい、もう一回！",
      message: question.hint || "問題をもう一度ゆっくり見てみよう。",
      showAnswer: false,
      canRetry: true,
    };
    playSfx("wrong");
    animateMonster("attack");
    gentleShake();
  } else {
    session.locked = true;
    session.wrongSelections.add(String(answer));
    session.feedback = {
      kind: "retry",
      title: "挑戦したことが力になる！",
      message: question.hint || "次に出たときは必ず思い出せるよ。",
      showAnswer: true,
      canRetry: false,
    };
    playSfx("wrong");
    animateMonster("attack");
    gentleShake();
    if (session.mode === "time") window.setTimeout(() => nextQuestion(), 850);
  }
  render();
}

function animateMonster(className) {
  requestAnimationFrame(() => {
    const monster = document.querySelector("#monster");
    monster?.classList.add(className);
  });
}

function gentleShake() {
  if (state.settings?.reducedMotion) return;
  document.querySelector("#app-shell")?.classList.add("shake");
  window.setTimeout(() => document.querySelector("#app-shell")?.classList.remove("shake"), 420);
  if (state.settings?.vibrationEnabled && navigator.vibrate) navigator.vibrate([45, 35, 35]);
}

function celebrateCorrect(combo, points) {
  const intensity = state.settings?.reducedMotion ? 0 : state.settings?.effectIntensity === "low" ? 8 : 18;
  const colors = ["#58e6ff", "#ffd166", "#53e6a3", "#9c7cff", "#ff77bd"];
  for (let index = 0; index < intensity; index += 1) {
    const particle = document.createElement("i");
    particle.className = "particle";
    particle.style.left = `${10 + Math.random() * 80}%`;
    particle.style.top = `${-10 - Math.random() * 30}px`;
    particle.style.setProperty("--particle-color", colors[index % colors.length]);
    particle.style.animationDelay = `${Math.random() * 180}ms`;
    effectsLayer.append(particle);
    window.setTimeout(() => particle.remove(), 1500);
  }
  if ([5, 10, 20, 30].includes(combo) && !state.settings?.reducedMotion) {
    const labels = { 5: "🔥 5 COMBO", 10: "⚡ 10 COMBO", 20: "🌈 20 COMBO", 30: "✨ FINAL MOVE" };
    const banner = document.createElement("div");
    banner.className = "combo-banner";
    banner.textContent = labels[combo];
    banner.style.setProperty("--combo-color", colors[(combo / 5) % colors.length]);
    effectsLayer.append(banner);
    window.setTimeout(() => banner.remove(), 950);
  }
  const score = document.createElement("div");
  score.className = "score-fly";
  score.textContent = `+${points}`;
  score.style.left = "52%";
  score.style.top = "30%";
  document.querySelector("#battle-stage")?.append(score);
  window.setTimeout(() => score.remove(), 900);
  if (state.settings?.vibrationEnabled && navigator.vibrate) navigator.vibrate(28);
}

function revealAnswer() {
  const session = state.session;
  if (!session || session.locked) return;
  const question = session.queue[session.index];
  session.locked = true;
  session.feedback = {
    kind: "retry",
    title: "答えを確認しよう",
    message: question.hint ?? "次回の復習でもう一度出題します。",
    showAnswer: true,
    canRetry: false,
  };
  render();
}

function resetQuestionState() {
  const session = state.session;
  session.selectedOrder = [];
  session.wrongSelections = new Set();
  session.wrongAttempted = false;
  session.locked = false;
  session.feedback = null;
  session.firstAttemptRecorded = false;
  session.draftAnswer = "";
  session.questionShownAtMs = Date.now();
}

function nextQuestion() {
  const session = state.session;
  if (!session || session.finalizing) return;
  if (session.index + 1 >= session.queue.length) {
    finishSession();
    return;
  }
  session.index += 1;
  resetQuestionState();
  render();
}

async function finishSession({ status = "completed" } = {}) {
  const session = state.session;
  if (!session || session.finalizing) return;
  session.finalizing = true;
  clearInterval(state.timerId);
  const durationSeconds = Math.max(1, Math.round((Date.now() - session.startedAtMs) / 1000));
  const questionCount = session.correctCount + session.incorrectCount;
  const accuracy = questionCount ? Math.round((session.correctCount / questionCount) * 100) : 0;
  const previousHighScore = state.stats.highScore;
  await storage.finishSession(session.id, {
    status,
    durationSeconds,
    score: session.score,
    questionCount,
    correctCount: session.correctCount,
    incorrectCount: session.incorrectCount,
    maxCombo: session.maxCombo,
    accuracy,
  });
  const coinsEarned = session.correctCount * 3 + (accuracy === 100 && questionCount ? 10 : 0);
  await storage.saveProfile({
    xp: (Number(state.profile?.xp) || 0) + session.correctCount * 20,
    coins: (Number(state.profile?.coins) || 0) + coinsEarned,
    highScore: Math.max(Number(state.profile?.highScore) || 0, session.score),
  });
  state.profile = await storage.getProfile();
  await refreshRecords();
  const newHighScore = session.score > 0 && session.score > previousHighScore;
  state.result = {
    mode: session.mode,
    score: session.score,
    correctCount: session.correctCount,
    questionCount,
    accuracy,
    maxCombo: session.maxCombo,
    durationSeconds,
    coinsEarned,
    newHighScore,
  };
  state.session = null;
  state.screen = status === "completed" ? "result" : "home";
  if (status === "completed") {
    playSfx(newHighScore ? "highScore" : "bossDefeat");
    ensureBgm("result");
    if (newHighScore) celebrateCorrect(30, 0);
  } else {
    ensureBgm("home");
  }
  render();
}

async function unlockForSound() {
  if (!state.audioUnlocked) state.audioUnlocked = await unlockAudio();
  return state.audioUnlocked;
}

async function ensureBgm(theme = "home") {
  if (!state.audioUnlocked || Number(state.settings?.bgmVolume ?? 0.55) <= 0) return;
  if (getCurrentBgmTheme() !== theme) await startBgm(theme);
}

function navigate(screen) {
  if (!new Set(["home", "learn", "history", "settings", "parent"]).has(screen)) screen = "home";
  state.screen = screen;
  if (screen !== "parent") state.parentUnlocked = false;
  ensureBgm("home");
  render();
  window.scrollTo({ top: 0, behavior: state.settings?.reducedMotion ? "auto" : "smooth" });
}

async function hashPin(pin) {
  const bytes = new TextEncoder().encode(`word-quest-parent:${pin}`);
  if (crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return `fallback-${hash >>> 0}`;
}

async function handleParentPin(pin) {
  if (!/^\d{4,8}$/.test(pin)) {
    showToast("PINは4〜8桁の数字で入力してください。");
    return;
  }
  const hash = await hashPin(pin);
  if (!state.settings.parentPinHash) {
    state.settings = await storage.saveSettings({ parentPinHash: hash });
    state.parentUnlocked = true;
    showToast("保護者PINを設定しました。");
  } else if (hash === state.settings.parentPinHash) {
    state.parentUnlocked = true;
    state.pinFailures = 0;
  } else {
    state.pinFailures += 1;
    if (state.pinFailures >= 5) {
      state.pinLockedUntil = Date.now() + 30_000;
      state.pinFailures = 0;
    }
    showToast("そのPINは一致しません。");
  }
  render();
}

async function exportData() {
  const payload = await storage.exportData();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `word-quest-backup-${localDateKey()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("学習記録のバックアップを作りました。");
}

async function importData(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload.format !== "word-quest-backup") throw new Error("Unsupported backup format");
    await storage.importData(payload, { mode: "replace" });
    state.profile = await storage.getProfile();
    state.settings = await storage.getSettings();
    applyVisualSettings();
    await refreshRecords();
    showToast("バックアップを復元しました。");
    render();
  } catch (error) {
    console.error(error);
    showToast("このファイルはWORD QUESTのバックアップとして読み込めません。", 4200);
  }
}

function askReset() {
  showModal(`<p class="eyebrow">Danger Zone</p><h2>学習記録を初期化しますか？</h2><p class="screen-lead">得点、習得度、連続学習日数、PINを含むすべての端末内データが削除されます。必要なら先にバックアップを作ってください。</p><div class="button-row" style="margin-top:18px"><button class="danger-button" type="button" data-action="confirm-reset">すべて削除</button><button class="ghost-button" type="button" data-action="close-modal">やめる</button></div>`);
}

async function resetAll() {
  closeModal();
  stopAllAudio();
  await storage.resetData();
  state.profile = await storage.getProfile();
  state.settings = await storage.getSettings();
  state.formGrades = new Set(["elementary", "jhs1"]);
  state.screen = "onboarding";
  state.parentUnlocked = false;
  await refreshRecords();
  applyVisualSettings();
  render();
  showToast("記録を初期化しました。");
}

async function installApp() {
  if (state.installPrompt) {
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    render();
    return;
  }
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  showModal(`<p class="eyebrow">Install WORD QUEST</p><h2>ホーム画面に追加</h2><p class="screen-lead">${isIos ? "Safari下の「共有」ボタンを押し、「ホーム画面に追加」を選びます。" : "Chromeのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。"}</p><button class="primary-button" type="button" data-action="close-modal">わかった</button>`);
}

async function shareParentReport() {
  const nickname = state.profile?.nickname || "英語勇者";
  const text = `【WORD QUEST・今日の記録】\n${nickname}\n学習時間: ${formatDuration(state.today?.studySeconds)}\n回答数: ${state.today?.questionCount ?? 0}問\n正答率: ${getTodayAccuracy()}%\n得点: ${formatNumber(state.today?.score)} pt\n連続学習: ${state.stats.currentStreak}日`;
  try {
    if (navigator.share) await navigator.share({ title: "WORD QUEST 学習記録", text });
    else {
      await navigator.clipboard.writeText(text);
      showToast("今日の記録をコピーしました。");
    }
  } catch (error) {
    if (error?.name !== "AbortError") showToast("共有できませんでした。");
  }
}

async function saveSetting(element) {
  const key = element.dataset.setting;
  if (!key) return;
  let value = element.type === "checkbox" ? element.checked : element.value;
  if (["dailyGoalMinutes", "bgmVolume", "effectsVolume", "speechVolume", "textScale"].includes(key)) value = Number(value);

  if (key === "nickname") {
    const nickname = String(value).trim().slice(0, 12) || "勇者";
    state.profile = await storage.saveProfile({ nickname });
  } else if (key === "notificationEnabled") {
    const result = await scheduleDailyReminder({ enabled: Boolean(value), time: getNotificationSettings().time });
    if (value && !result.scheduled) {
      element.checked = false;
      value = false;
      showToast(result.reason === "permission-denied" ? "通知が許可されませんでした。ブラウザ設定から変更できます。" : "その時刻は学校時間または深夜に含まれます。", 4200);
    } else if (value) {
      showToast(result.channel === "capacitor" ? "毎日のローカル通知を設定しました。" : "Web版の学習リマインダーを設定しました。");
    }
    state.settings = await storage.saveSettings({ notificationEnabled: Boolean(value) });
  } else if (key === "notificationTime") {
    const current = getNotificationSettings();
    const result = await scheduleDailyReminder({ ...current, time: String(value) });
    if (!result.scheduled && current.enabled) {
      showToast("その時刻は学校時間または深夜に含まれます。");
      render();
      return;
    }
    state.settings = await storage.saveSettings({ notificationTime: String(value) });
  } else {
    state.settings = await storage.saveSettings({ [key]: value });
  }
  applyVisualSettings();
  if (["bgmVolume", "effectsVolume", "speechVolume"].includes(key)) {
    const label = element.closest(".setting-row")?.querySelector(".setting-copy span");
    if (label) label.textContent = `${Math.round(Number(value) * 100)}%`;
    if (key === "bgmVolume" && Number(value) > 0) ensureBgm("home");
  } else {
    renderTopbar();
  }
}

async function toggleProfileGrade(grade) {
  const grades = new Set(normalizeGrades(state.profile.selectedGrades));
  if (grades.has(grade)) {
    if (grades.size === 1) {
      showToast("学習範囲は1つ以上選んでください。");
      return;
    }
    grades.delete(grade);
  } else {
    grades.add(grade);
  }
  state.profile = await storage.saveProfile({ selectedGrades: [...grades] });
  render();
}

function askQuitGame() {
  showModal(`<p class="eyebrow">Pause Quest</p><h2>クエストを中断しますか？</h2><p class="screen-lead">ここまでの回答と学習時間は保存されます。</p><div class="button-row" style="margin-top:18px"><button class="danger-button" type="button" data-action="quit-game">中断してホームへ</button><button class="ghost-button" type="button" data-action="close-modal">続ける</button></div>`);
}

async function handleClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (!state.audioUnlocked && !["reload", "close-modal"].includes(action)) await unlockForSound();
  if (!state.session && !["test-sound", "test-speech"].includes(action)) playSfx("click");

  if (action === "navigate") navigate(target.dataset.screen);
  else if (action === "reload") location.reload();
  else if (action === "toggle-onboarding-grade") {
    const grade = target.dataset.grade;
    if (state.formGrades.has(grade)) {
      if (state.formGrades.size > 1) state.formGrades.delete(grade);
    } else state.formGrades.add(grade);
    render();
  } else if (action === "finish-onboarding") {
    const nickname = document.querySelector("#nickname")?.value.trim().slice(0, 12) || "英語勇者";
    state.profile = await storage.saveProfile({ nickname, selectedGrades: [...state.formGrades], onboardingComplete: true, xp: 0, coins: 0 });
    state.screen = "home";
    render();
    ensureBgm("home");
  } else if (action === "open-mode") openModeModal(target.dataset.mode);
  else if (action === "choose-daily-category") openDailyDurationModal(target.dataset.category);
  else if (action === "start-mode") await startMode(target.dataset.mode, target.dataset.value, target.dataset.category);
  else if (action === "close-modal") closeModal();
  else if (action === "choose-answer") {
    const question = state.session.queue[state.session.index];
    const answer = question.preparedChoices[Number(target.dataset.index)];
    await submitAnswer(answer);
  } else if (action === "add-word") {
    state.session.selectedOrder.push(Number(target.dataset.index));
    render();
  } else if (action === "remove-word") {
    const index = Number(target.dataset.index);
    const position = state.session.selectedOrder.lastIndexOf(index);
    if (position >= 0) state.session.selectedOrder.splice(position, 1);
    render();
  } else if (action === "clear-order") {
    state.session.selectedOrder = [];
    render();
  } else if (action === "submit-order") {
    const question = state.session.queue[state.session.index];
    const answer = state.session.selectedOrder.map((index) => question.preparedWords[index]).join(" ");
    await submitAnswer(answer);
  } else if (action === "speak-question") {
    const spoken = await speak(questionSpeechText(state.session.queue[state.session.index]));
    if (!spoken) showToast("この端末では英語音声を再生できませんでした。", 3800);
  }
  else if (action === "reveal-answer") revealAnswer();
  else if (action === "next-question") nextQuestion();
  else if (action === "ask-quit-game") askQuitGame();
  else if (action === "quit-game") { closeModal(); await finishSession({ status: "abandoned" }); }
  else if (action === "retry-mode") openModeModal(target.dataset.mode);
  else if (action === "toggle-profile-grade") await toggleProfileGrade(target.dataset.grade);
  else if (action === "test-sound") { await unlockForSound(); playSfx("correct"); ensureBgm("home"); }
  else if (action === "test-speech") speak("You can do it! Keep going.");
  else if (action === "test-notification") {
    const result = await showTestNotification();
    showToast(result.shown ? "テスト通知を送りました。" : "通知が許可されていません。");
  } else if (action === "install-app") await installApp();
  else if (action === "export-data") await exportData();
  else if (action === "ask-reset") askReset();
  else if (action === "confirm-reset") await resetAll();
  else if (action === "open-parent") { state.screen = "parent"; state.parentUnlocked = false; render(); }
  else if (action === "lock-parent") { state.parentUnlocked = false; render(); }
  else if (action === "share-report") await shareParentReport();
}

async function handleSubmit(event) {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  if (event.isComposing) return;
  if (form.dataset.form === "answer") {
    const answer = new FormData(form).get("answer");
    if (!String(answer ?? "").trim()) {
      showToast("答えを入力してから押してね。");
      return;
    }
    await submitAnswer(answer);
  } else if (form.dataset.form === "parent-pin") {
    await handleParentPin(String(new FormData(form).get("pin") ?? ""));
  }
}

async function handleChange(event) {
  const target = event.target;
  if (target.matches("[data-setting]")) await saveSetting(target);
  if (target.id === "import-data") await importData(target.files?.[0]);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${APP_BASE_URL}sw.js`, { scope: APP_BASE_URL }).then((registration) => {
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) showToast("新しいバージョンを準備しました。次回起動時に更新します。", 4200);
        });
      });
    }).catch((error) => console.warn("Service worker registration failed", error));
  });
}

async function init() {
  render();
  try {
    const [response] = await Promise.all([fetch(`${APP_BASE_URL}data/content.json`), storage.ready()]);
    if (!response.ok) throw new Error(`Content request failed: ${response.status}`);
    state.content = await response.json();
    state.contentMaps = createContentMaps(state.content);
    state.profile = await storage.getProfile();
    state.settings = await storage.getSettings();
    const grades = normalizeGrades(state.profile.selectedGrades);
    state.formGrades = new Set(grades.length ? grades : ["elementary", "jhs1"]);
    await refreshRecords();
    applyVisualSettings();
    await initializeNotifications({
      onInAppReminder(reminder) {
        showToast(`🔔 ${reminder.message}`, 6500);
      },
    });
    const params = new URLSearchParams(location.search);
    state.screen = state.profile.onboardingComplete ? "home" : "onboarding";
    render();
    if (state.profile.onboardingComplete && params.get("mode")) {
      const shortcut = params.get("mode") === "time-attack" ? "time" : params.get("mode") === "daily" ? "daily" : null;
      if (shortcut) openModeModal(shortcut);
    }
  } catch (error) {
    console.error(error);
    state.screen = "error";
    render();
  }
}

document.addEventListener("click", (event) => void handleClick(event));
document.addEventListener("submit", (event) => void handleSubmit(event));
document.addEventListener("change", (event) => void handleChange(event));
document.addEventListener("input", (event) => {
  if (event.target.id === "answer-input" && state.session) state.session.draftAnswer = event.target.value;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Tab") document.body.classList.add("keyboard-navigation");
  if (event.key === "Escape" && document.querySelector("#modal-backdrop")) closeModal();
  if (state.screen === "game" && !event.metaKey && !event.ctrlKey && ["1", "2", "3", "4"].includes(event.key)) {
    const question = state.session?.queue[state.session.index];
    const answer = question?.preparedChoices?.[Number(event.key) - 1];
    if (answer !== undefined) void submitAnswer(answer);
  }
});
document.addEventListener("pointerdown", () => document.body.classList.remove("keyboard-navigation"), { passive: true });
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPrompt = event;
  if (state.screen === "home") render();
});
window.addEventListener("appinstalled", () => {
  state.installPrompt = null;
  showToast("WORD QUESTをホーム画面に追加しました！");
});
window.addEventListener("online", () => { state.online = true; if (state.screen === "home") render(); });
window.addEventListener("offline", () => { state.online = false; showToast("オフラインになりました。学習と記録はそのまま続けられます。"); if (state.screen === "home") render(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.session?.mode === "time" && Date.now() >= state.session.deadlineMs) void finishSession();
});

registerServiceWorker();
void init();
