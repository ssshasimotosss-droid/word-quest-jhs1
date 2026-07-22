/** Pure learning/game rules for Word Quest. No DOM or browser APIs required. */

export const SCORE_RULES = Object.freeze({
  correct: 100,
  maximumSpeedBonus: 50,
  fastestAnswerMs: 2_000,
  speedBonusEndsMs: 10_000,
  difficultyStepBonus: 10,
  reviewSuccessBonus: 25,
  perfectSpellingBonus: 25,
  noMissBonus: 100,
});

export const MASTERY_INTERVAL_DAYS = Object.freeze([0, 1, 3, 7, 14, 30]);

export const PRODUCTIVE_QUESTION_TYPES = Object.freeze(new Set([
  "spelling",
  "typing",
  "input",
  "fill_blank",
  "word_order",
  "transformation",
  "sentence_input",
]));

const APOSTROPHES = /[\u0060\u00b4\u02bc\u055a\u2018\u2019\u201b\uff07]/g;
const ZERO_WIDTH = /[\u200b-\u200d\ufeff]/g;
const DAY_MS = 86_400_000;

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function validDate(value, fallback = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value ?? fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
}

export function dateKey(value = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = validDate(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateOrdinal(value) {
  const [year, month, day] = dateKey(value).split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

/**
 * Canonical answer text. NFKC handles full-width input; smart apostrophes and
 * optional spaces around contractions are normalized separately.
 */
export function normalizeAnswer(value, options = {}) {
  let normalized = String(value ?? "").normalize("NFKC");
  normalized = normalized.replace(ZERO_WIDTH, "").replace(APOSTROPHES, "'");
  normalized = normalized.replace(/\s+/gu, " ").replace(/\s*'\s*/g, "'").trim();
  if (options.stripTerminalPunctuation) normalized = normalized.replace(/[.!?]+$/u, "").trimEnd();
  if (!options.caseSensitive) normalized = normalized.toLocaleLowerCase(options.locale ?? "en-US");
  return normalized;
}

function answerStrings(expected) {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    return asArray(expected.answers ?? expected.acceptedAnswers ?? expected.accepted_answers ?? expected.correctAnswer ?? expected.correct_answer ?? expected.answer);
  }
  return asArray(expected);
}

export function answersMatch(userAnswer, expected, options = {}) {
  const actual = normalizeAnswer(userAnswer, options);
  return answerStrings(expected).some((answer) => normalizeAnswer(answer, options) === actual);
}

export function getAcceptedAnswers(question) {
  const direct = answerStrings(question);
  const alternatives = [
    ...asArray(question?.answerAlternatives),
    ...asArray(question?.answer_alternatives),
    ...asArray(question?.meaningAlternatives),
    ...asArray(question?.meaning_alternatives_ja),
  ];
  return [...new Set([...direct, ...alternatives].filter((value) => value !== undefined && value !== null).map(String))];
}

export function checkAnswer(question, userAnswer, options = {}) {
  const acceptedAnswers = getAcceptedAnswers(question);
  const normalizedAnswer = normalizeAnswer(userAnswer, options);
  const isCorrect = acceptedAnswers.some((answer) => normalizeAnswer(answer, options) === normalizedAnswer);
  return { isCorrect, normalizedAnswer, acceptedAnswers };
}

export function isAnswerCorrect(question, userAnswer, options = {}) {
  return checkAnswer(question, userAnswer, options).isCorrect;
}

export function questionId(question) {
  const id = question?.id ?? question?.questionId ?? question?.question_id;
  if (id === undefined || id === null) throw new TypeError("Every question requires an id");
  return String(id);
}

export function questionContentType(question) {
  return String(question?.contentType ?? question?.content_type ?? question?.category ?? "word").toLowerCase();
}

export function questionContentId(question) {
  return String(question?.contentId ?? question?.content_id ?? question?.wordId ?? question?.phraseId ?? question?.grammarUnitId ?? questionId(question));
}

export function questionContentKey(question) {
  return `${questionContentType(question)}:${questionContentId(question)}`;
}

export function questionType(question) {
  return String(question?.questionType ?? question?.question_type ?? question?.type ?? "choice").toLowerCase();
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function seededRandom(seed = "word-quest") {
  let state = fnv1a(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function seededShuffle(values, seed = "word-quest") {
  const result = [...values];
  const random = seededRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function normalizedSet(value) {
  const values = asArray(value).filter((item) => item !== undefined && item !== null);
  return values.length ? new Set(values.map((item) => String(item).toLowerCase())) : null;
}

function isActiveQuestion(question) {
  return question && question.isActive !== false && question.is_active !== false;
}

export function selectQuestions(questions, options = {}) {
  const excluded = new Set(asArray(options.excludeIds).map(String));
  const contentTypes = normalizedSet(options.contentTypes ?? options.contentType);
  const questionTypes = normalizedSet(options.questionTypes ?? options.questionType);
  const grades = normalizedSet(options.grades ?? options.grade);
  const filtered = asArray(questions).filter((question) => {
    if (!isActiveQuestion(question) || excluded.has(questionId(question))) return false;
    if (contentTypes && !contentTypes.has(questionContentType(question))) return false;
    if (questionTypes && !questionTypes.has(questionType(question))) return false;
    const grade = String(question.grade ?? question.targetGrade ?? question.target_grade ?? "").toLowerCase();
    if (grades && !grades.has(grade)) return false;
    return typeof options.predicate !== "function" || options.predicate(question);
  });
  // Sorting before shuffling makes a seed stable even if JSON files are merged
  // in a different order.
  filtered.sort((left, right) => questionId(left).localeCompare(questionId(right)));
  const shuffled = seededShuffle(filtered, options.seed ?? "select");
  const limit = options.limit === undefined ? shuffled.length : Math.max(0, Math.floor(finiteNumber(options.limit)));
  return shuffled.slice(0, limit);
}

export function selectNextQuestion(questions, options = {}) {
  return selectQuestions(questions, { ...options, limit: 1 })[0] ?? null;
}

export function masteryLookup(masteryRecords = []) {
  if (masteryRecords instanceof Map) return masteryRecords;
  const lookup = new Map();
  const records = Array.isArray(masteryRecords) ? masteryRecords : Object.values(masteryRecords ?? {});
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const contentType = String(record.contentType ?? record.content_type ?? "word").toLowerCase();
    const contentId = record.contentId ?? record.content_id;
    const contentKey = record.contentKey ?? record.content_key ?? (contentId === undefined ? null : `${contentType}:${String(contentId)}`);
    if (contentKey) lookup.set(String(contentKey), record);
    if (record.id) lookup.set(String(record.id), record);
  }
  return lookup;
}

export function masteryForQuestion(question, masteryRecords = []) {
  const lookup = masteryRecords instanceof Map ? masteryRecords : masteryLookup(masteryRecords);
  const key = questionContentKey(question);
  return lookup.get(key) ?? lookup.get(`local-player:${key}`) ?? null;
}

export function isMasteryDue(record, now = new Date()) {
  if (!record?.nextReviewAt && !record?.next_review_at) return false;
  const dueAt = new Date(record.nextReviewAt ?? record.next_review_at).getTime();
  return Number.isFinite(dueAt) && dueAt <= validDate(now).getTime();
}

export function weaknessScore(record, now = new Date()) {
  if (!record) return 0;
  const correct = Math.max(0, finiteNumber(record.correctCount ?? record.correct_count));
  const incorrect = Math.max(0, finiteNumber(record.incorrectCount ?? record.incorrect_count));
  const total = correct + incorrect;
  const errorRate = total ? incorrect / total : 0;
  const level = clamp(finiteNumber(record.masteryLevel ?? record.mastery_level), 0, MASTERY_INTERVAL_DAYS.length - 1);
  const responseTime = Math.max(0, finiteNumber(record.averageResponseTimeMs ?? record.average_response_time));
  const explicitDifficulty = Math.max(0, finiteNumber(record.difficultyScore ?? record.difficulty_score));
  const dueAt = new Date(record.nextReviewAt ?? record.next_review_at ?? validDate(now)).getTime();
  const overdueDays = Number.isFinite(dueAt) ? Math.max(0, (validDate(now).getTime() - dueAt) / DAY_MS) : 0;
  return Number((incorrect * 5 + errorRate * 20 + (5 - level) * 2 + Math.min(8, responseTime / 4_000) + Math.min(10, overdueDays) + explicitDifficulty).toFixed(4));
}

function rankedByWeakness(questions, lookup, now, seed, includeUnseen = false) {
  return questions
    .map((question) => {
      const record = masteryForQuestion(question, lookup);
      const hasWeakness = record && (
        finiteNumber(record.incorrectCount ?? record.incorrect_count) > 0
        || finiteNumber(record.difficultyScore ?? record.difficulty_score) > 0
        || finiteNumber(record.masteryLevel ?? record.mastery_level) < 2
      );
      return { question, record, score: record ? weaknessScore(record, now) : 0, hasWeakness };
    })
    .filter((item) => includeUnseen || item.hasWeakness)
    .sort((left, right) => right.score - left.score || fnv1a(`${seed}:${questionId(left.question)}`) - fnv1a(`${seed}:${questionId(right.question)}`));
}

export function buildWeaknessQueue(questions, masteryRecords = [], options = {}) {
  const lookup = masteryLookup(masteryRecords);
  const active = asArray(questions).filter(isActiveQuestion);
  const ranked = rankedByWeakness(active, lookup, options.now ?? new Date(), options.seed ?? "weakness", options.includeUnseen);
  const limit = Math.max(0, Math.floor(finiteNumber(options.limit, 10)));
  return ranked.slice(0, limit).map((item) => item.question);
}

function isPhraseQuestion(question) {
  const type = questionContentType(question);
  return ["phrase", "idiom", "greeting", "response", "daily_expression", "classroom_expression"].includes(type);
}

function isGrammarQuestion(question) {
  return questionContentType(question) === "grammar";
}

/**
 * Builds a stable daily mix. Defaults mirror the product brief: five new,
 * ten reviews, three phrases and five grammar questions. Buckets never add the
 * same question twice; any shortfall is filled from the remaining active pool.
 */
export function buildDailyQueue(questions, masteryRecords = [], options = {}) {
  const active = asArray(questions).filter(isActiveQuestion);
  const lookup = masteryLookup(masteryRecords);
  const now = validDate(options.now ?? new Date());
  const seed = options.seed ?? `daily:${dateKey(now)}`;
  const counts = {
    new: Math.max(0, Math.floor(finiteNumber(options.newCount, 5))),
    review: Math.max(0, Math.floor(finiteNumber(options.reviewCount, 10))),
    phrase: Math.max(0, Math.floor(finiteNumber(options.phraseCount, 3))),
    grammar: Math.max(0, Math.floor(finiteNumber(options.grammarCount, 5))),
  };
  const target = Math.max(0, Math.floor(finiteNumber(options.limit, counts.new + counts.review + counts.phrase + counts.grammar)));
  const selected = [];
  const seen = new Set();
  const add = (items, count) => {
    if (count <= 0 || selected.length >= target) return;
    let added = 0;
    for (const question of items) {
      if (selected.length >= target || added >= count) break;
      const id = questionId(question);
      if (seen.has(id)) continue;
      selected.push(question);
      seen.add(id);
      added += 1;
    }
  };

  const due = active
    .map((question) => ({ question, record: masteryForQuestion(question, lookup) }))
    .filter((item) => item.record && isMasteryDue(item.record, now))
    .sort((left, right) => weaknessScore(right.record, now) - weaknessScore(left.record, now)
      || String(left.record.nextReviewAt ?? "").localeCompare(String(right.record.nextReviewAt ?? ""))
      || fnv1a(`${seed}:due:${questionId(left.question)}`) - fnv1a(`${seed}:due:${questionId(right.question)}`))
    .map((item) => item.question);
  const weak = rankedByWeakness(active, lookup, now, `${seed}:weak`).map((item) => item.question);
  const reviews = [...due, ...weak.filter((question) => !due.some((dueQuestion) => questionId(dueQuestion) === questionId(question)))];
  const unseen = selectQuestions(active.filter((question) => !masteryForQuestion(question, lookup)), { seed: `${seed}:new` });
  const phrases = selectQuestions(active, { seed: `${seed}:phrases`, predicate: isPhraseQuestion });
  const grammar = selectQuestions(active, { seed: `${seed}:grammar`, predicate: isGrammarQuestion });

  add(reviews, counts.review);
  add(unseen, counts.new);
  add(phrases, counts.phrase);
  add(grammar, counts.grammar);
  add(selectQuestions(active, { seed: `${seed}:fill` }), target - selected.length);
  return seededShuffle(selected, `${seed}:order`).slice(0, target);
}

export function buildTimeAttackQueue(questions, options = {}) {
  const durationSeconds = clamp(finiteNumber(options.durationSeconds, 60), 1, 3_600);
  const averageResponseTimeMs = clamp(finiteNumber(options.averageResponseTimeMs, 4_000), 500, 60_000);
  const target = Math.max(1, Math.floor(finiteNumber(options.limit, Math.ceil((durationSeconds * 1_000) / averageResponseTimeMs) + 3)));
  const basePool = selectQuestions(questions, {
    ...options,
    limit: undefined,
    seed: `${options.seed ?? "time-attack"}:0`,
  });
  if (!basePool.length) return [];
  const queue = [];
  let cycle = 0;
  while (queue.length < target) {
    const pool = cycle === 0 ? basePool : seededShuffle(basePool, `${options.seed ?? "time-attack"}:${cycle}`);
    queue.push(...pool.slice(0, target - queue.length));
    cycle += 1;
  }
  return queue;
}

export function comboMultiplier(combo) {
  const count = Math.max(0, Math.floor(finiteNumber(combo)));
  if (count >= 30) return 3;
  if (count >= 20) return 2;
  if (count >= 10) return 1.5;
  if (count >= 5) return 1.2;
  return 1;
}

export function speedBonus(responseTimeMs, rules = SCORE_RULES) {
  const elapsed = Math.max(0, finiteNumber(responseTimeMs, rules.speedBonusEndsMs));
  if (elapsed <= rules.fastestAnswerMs) return rules.maximumSpeedBonus;
  if (elapsed >= rules.speedBonusEndsMs) return 0;
  const remainingRatio = (rules.speedBonusEndsMs - elapsed) / (rules.speedBonusEndsMs - rules.fastestAnswerMs);
  return Math.round(rules.maximumSpeedBonus * remainingRatio);
}

/** `combo` is the streak before this answer; the returned combo includes it. */
export function calculateScore(input = {}) {
  const isCorrect = Boolean(input.isCorrect ?? input.is_correct);
  if (!isCorrect) {
    return {
      total: 0,
      combo: 0,
      multiplier: 1,
      breakdown: { base: 0, speed: 0, difficulty: 0, review: 0, spelling: 0, noMiss: 0, subtotal: 0 },
    };
  }

  const rules = { ...SCORE_RULES, ...(input.rules ?? {}) };
  const newCombo = Math.max(0, Math.floor(finiteNumber(input.comboBefore ?? input.combo))) + 1;
  const difficulty = clamp(Math.floor(finiteNumber(input.difficulty, 1)), 1, 6);
  const type = String(input.questionType ?? input.question_type ?? "").toLowerCase();
  const spellingPerfect = Boolean(input.perfectSpelling ?? input.isPerfectSpelling ?? input.spellingPerfect)
    || (type === "spelling" && input.hintUsed === false);
  const breakdown = {
    base: rules.correct,
    speed: speedBonus(input.responseTimeMs, rules),
    difficulty: (difficulty - 1) * rules.difficultyStepBonus,
    review: input.isReview ? rules.reviewSuccessBonus : 0,
    spelling: spellingPerfect ? rules.perfectSpellingBonus : 0,
    noMiss: input.noMiss ? rules.noMissBonus : 0,
  };
  breakdown.subtotal = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const multiplier = comboMultiplier(newCombo);
  return {
    total: Math.round(breakdown.subtotal * multiplier),
    combo: newCombo,
    multiplier,
    breakdown,
  };
}

function attemptProductive(attempt) {
  const type = String(attempt.questionType ?? attempt.question_type ?? "choice").toLowerCase();
  return PRODUCTIVE_QUESTION_TYPES.has(type);
}

/** Applies one attempt to a mastery record and schedules the next review. */
export function updateMastery(previous = {}, attempt = {}, now = new Date()) {
  const answeredAt = validDate(attempt.answeredAt ?? attempt.answered_at ?? now);
  const isCorrect = Boolean(attempt.isCorrect ?? attempt.is_correct);
  const oldCorrect = Math.max(0, Math.floor(finiteNumber(previous.correctCount ?? previous.correct_count)));
  const oldIncorrect = Math.max(0, Math.floor(finiteNumber(previous.incorrectCount ?? previous.incorrect_count)));
  const oldTotal = oldCorrect + oldIncorrect;
  const oldAverage = Math.max(0, finiteNumber(previous.averageResponseTimeMs ?? previous.average_response_time));
  const responseTimeMs = Math.max(0, finiteNumber(attempt.responseTimeMs ?? attempt.response_time_ms));
  const correctCount = oldCorrect + (isCorrect ? 1 : 0);
  const incorrectCount = oldIncorrect + (isCorrect ? 0 : 1);
  const productiveCorrectCount = Math.max(0, Math.floor(finiteNumber(previous.productiveCorrectCount ?? previous.productive_correct_count)))
    + (isCorrect && attemptProductive(attempt) ? 1 : 0);
  const previousLevel = clamp(Math.floor(finiteNumber(previous.masteryLevel ?? previous.mastery_level)), 0, MASTERY_INTERVAL_DAYS.length - 1);
  let masteryLevel = isCorrect ? Math.min(MASTERY_INTERVAL_DAYS.length - 1, previousLevel + 1) : Math.max(0, previousLevel - 2);
  // Recognition alone should not mark an item fully mastered.
  if (productiveCorrectCount === 0) masteryLevel = Math.min(masteryLevel, 3);
  const consecutiveCorrect = isCorrect
    ? Math.max(0, Math.floor(finiteNumber(previous.consecutiveCorrect ?? previous.consecutive_correct))) + 1
    : 0;
  const averageResponseTimeMs = Math.round(((oldAverage * oldTotal) + responseTimeMs) / Math.max(1, oldTotal + 1));
  const nextReview = new Date(answeredAt.getTime() + (isCorrect ? MASTERY_INTERVAL_DAYS[masteryLevel] * DAY_MS : 0));
  const difficultyScore = clamp(Number((
    incorrectCount * 5
    + (incorrectCount / Math.max(1, correctCount + incorrectCount)) * 20
    + Math.min(10, averageResponseTimeMs / 4_000)
    + (5 - masteryLevel) * 2
  ).toFixed(4)), 0, 100);
  const contentType = attempt.contentType ?? attempt.content_type ?? previous.contentType ?? previous.content_type;
  const contentId = attempt.contentId ?? attempt.content_id ?? previous.contentId ?? previous.content_id;

  return {
    ...previous,
    ...(contentType === undefined ? {} : { contentType }),
    ...(contentId === undefined ? {} : { contentId }),
    masteryLevel,
    correctCount,
    incorrectCount,
    consecutiveCorrect,
    productiveCorrectCount,
    averageResponseTimeMs,
    difficultyScore,
    lastAnsweredAt: answeredAt.toISOString(),
    lastCorrectAt: isCorrect ? answeredAt.toISOString() : previous.lastCorrectAt ?? previous.last_correct_at ?? null,
    nextReviewAt: nextReview.toISOString(),
  };
}

export const applyAttemptToMastery = updateMastery;

function recordDate(record, fields) {
  for (const field of fields) {
    if (record?.[field]) return dateKey(record[field]);
  }
  return null;
}

function emptyDay(date) {
  return {
    date,
    studySeconds: 0,
    sessionCount: 0,
    questionCount: 0,
    correctCount: 0,
    incorrectCount: 0,
    score: 0,
    highScore: 0,
    maxCombo: 0,
    responseTimeMs: 0,
    responseCount: 0,
  };
}

function calculateStreaks(activityDates, today) {
  const ordinals = [...new Set(activityDates.map(dateOrdinal))].sort((left, right) => left - right);
  let longestStreak = 0;
  let run = 0;
  let previous = null;
  for (const ordinal of ordinals) {
    run = previous !== null && ordinal === previous + 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = ordinal;
  }
  const todayOrdinal = dateOrdinal(today);
  const activity = new Set(ordinals);
  let cursor = activity.has(todayOrdinal) ? todayOrdinal : activity.has(todayOrdinal - 1) ? todayOrdinal - 1 : null;
  let currentStreak = 0;
  while (cursor !== null && activity.has(cursor)) {
    currentStreak += 1;
    cursor -= 1;
  }
  return { currentStreak, longestStreak };
}

/** Aggregates raw records into home/history/parent-dashboard metrics. */
export function aggregateStats(input = {}, options = {}) {
  const source = Array.isArray(input) ? { attempts: input } : input;
  const attempts = asArray(source.attempts);
  const sessions = asArray(source.sessions);
  const mastery = asArray(source.mastery);
  const summaries = asArray(source.dailySummaries ?? source.daily_summaries);
  const days = new Map();

  for (const attempt of attempts) {
    const key = recordDate(attempt, ["date", "answeredAt", "answered_at"]);
    if (!key) continue;
    const day = days.get(key) ?? emptyDay(key);
    const correct = Boolean(attempt.isCorrect ?? attempt.is_correct);
    day.questionCount += 1;
    day.correctCount += correct ? 1 : 0;
    day.incorrectCount += correct ? 0 : 1;
    day.score += Math.max(0, finiteNumber(attempt.score));
    day.highScore = Math.max(day.highScore, Math.max(0, finiteNumber(attempt.score)));
    day.maxCombo = Math.max(day.maxCombo, Math.max(0, finiteNumber(attempt.combo)));
    day.responseTimeMs += Math.max(0, finiteNumber(attempt.responseTimeMs ?? attempt.response_time_ms));
    day.responseCount += 1;
    days.set(key, day);
  }

  const sessionStudyByDay = new Map();
  for (const session of sessions) {
    const key = recordDate(session, ["date", "startedAt", "started_at"]);
    if (!key) continue;
    const seconds = Math.max(0, finiteNumber(session.durationSeconds ?? session.duration_seconds));
    sessionStudyByDay.set(key, (sessionStudyByDay.get(key) ?? 0) + seconds);
    const day = days.get(key) ?? emptyDay(key);
    day.sessionCount += 1;
    day.highScore = Math.max(day.highScore, Math.max(0, finiteNumber(session.score)));
    day.maxCombo = Math.max(day.maxCombo, Math.max(0, finiteNumber(session.maxCombo ?? session.max_combo)));
    days.set(key, day);
  }

  const summaryDates = new Set();
  for (const summary of summaries) {
    const key = recordDate(summary, ["date", "updatedAt", "updated_at"]);
    if (!key) continue;
    summaryDates.add(key);
    const day = days.get(key) ?? emptyDay(key);
    // When attempts are unavailable (for example, a compact backup), summary
    // counts are authoritative. Otherwise they would double-count attempts.
    if (!attempts.some((attempt) => recordDate(attempt, ["date", "answeredAt", "answered_at"]) === key)) {
      day.questionCount = Math.max(0, finiteNumber(summary.questionCount ?? summary.question_count));
      day.correctCount = Math.max(0, finiteNumber(summary.correctCount ?? summary.correct_count));
      day.incorrectCount = Math.max(0, finiteNumber(summary.incorrectCount ?? summary.incorrect_count));
      day.score = Math.max(0, finiteNumber(summary.score));
    }
    day.studySeconds = Math.max(0, finiteNumber(summary.studySeconds ?? summary.study_seconds));
    day.sessionCount = Math.max(day.sessionCount, Math.max(0, finiteNumber(summary.sessionCount ?? summary.session_count)));
    day.highScore = Math.max(day.highScore, Math.max(0, finiteNumber(summary.highScore ?? summary.high_score)));
    day.maxCombo = Math.max(day.maxCombo, Math.max(0, finiteNumber(summary.maxCombo ?? summary.max_combo)));
    days.set(key, day);
  }

  for (const [key, seconds] of sessionStudyByDay) {
    const day = days.get(key) ?? emptyDay(key);
    if (!summaryDates.has(key)) day.studySeconds = seconds;
    days.set(key, day);
  }

  const daily = [...days.values()].sort((left, right) => left.date.localeCompare(right.date)).map((day) => ({
    ...day,
    accuracy: day.questionCount ? Number(((day.correctCount / day.questionCount) * 100).toFixed(1)) : 0,
  }));
  const totals = daily.reduce((result, day) => {
    result.studySeconds += day.studySeconds;
    result.sessionCount += day.sessionCount;
    result.questionCount += day.questionCount;
    result.correctCount += day.correctCount;
    result.incorrectCount += day.incorrectCount;
    result.totalScore += day.score;
    result.highScore = Math.max(result.highScore, day.highScore);
    result.maxCombo = Math.max(result.maxCombo, day.maxCombo);
    result.responseTimeMs += day.responseTimeMs;
    result.responseCount += day.responseCount;
    return result;
  }, {
    studySeconds: 0,
    sessionCount: 0,
    questionCount: 0,
    correctCount: 0,
    incorrectCount: 0,
    totalScore: 0,
    highScore: 0,
    maxCombo: 0,
    responseTimeMs: 0,
    responseCount: 0,
  });
  const masteredContentCount = mastery.filter((record) => finiteNumber(record.masteryLevel ?? record.mastery_level) >= 4).length;
  const weakContentCount = mastery.filter((record) => weaknessScore(record, options.now ?? new Date()) >= finiteNumber(options.weaknessThreshold, 15)).length;
  const activityDates = daily.filter((day) => day.questionCount > 0 || day.studySeconds > 0).map((day) => day.date);
  const streaks = calculateStreaks(activityDates, options.now ?? new Date());

  return {
    ...totals,
    accuracy: totals.questionCount ? Number(((totals.correctCount / totals.questionCount) * 100).toFixed(1)) : 0,
    averageResponseTimeMs: totals.responseCount ? Math.round(totals.responseTimeMs / totals.responseCount) : 0,
    masteredContentCount,
    weakContentCount,
    ...streaks,
    daily,
  };
}

export class GameEngine {
  constructor(options = {}) {
    this.seed = options.seed ?? "word-quest";
    this.clock = typeof options.clock === "function" ? options.clock : () => new Date();
  }

  normalizeAnswer(value, options) {
    return normalizeAnswer(value, options);
  }

  checkAnswer(question, answer, options) {
    return checkAnswer(question, answer, options);
  }

  selectQuestions(questions, options = {}) {
    return selectQuestions(questions, { seed: this.seed, ...options });
  }

  buildDailyQueue(questions, mastery, options = {}) {
    return buildDailyQueue(questions, mastery, { now: this.clock(), seed: this.seed, ...options });
  }

  buildWeaknessQueue(questions, mastery, options = {}) {
    return buildWeaknessQueue(questions, mastery, { now: this.clock(), seed: this.seed, ...options });
  }

  buildTimeAttackQueue(questions, options = {}) {
    return buildTimeAttackQueue(questions, { seed: this.seed, ...options });
  }

  calculateScore(input) {
    return calculateScore(input);
  }

  updateMastery(previous, attempt, now = this.clock()) {
    return updateMastery(previous, attempt, now);
  }

  aggregateStats(records, options = {}) {
    return aggregateStats(records, { now: this.clock(), ...options });
  }
}

export default GameEngine;
