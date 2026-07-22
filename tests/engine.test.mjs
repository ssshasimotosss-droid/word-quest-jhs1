import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateStats,
  buildDailyQueue,
  buildTimeAttackQueue,
  buildWeaknessQueue,
  calculateScore,
  checkAnswer,
  normalizeAnswer,
  selectQuestions,
  updateMastery,
} from "../src/game-engine.js";
import { createStorage } from "../src/storage.js";

const NOW = new Date("2026-07-22T12:00:00.000Z");

test("normalizes NFKC text, whitespace and apostrophe variants", () => {
  assert.equal(
    normalizeAnswer("  Ｉ’ｍ　Fine. ", { stripTerminalPunctuation: true }),
    "i'm fine",
  );
  assert.equal(
    checkAnswer({ correct_answer: "I'm fine." }, "I ’ m fine", { stripTerminalPunctuation: true }).isCorrect,
    true,
  );
});

test("seeded question selection is stable regardless of source order", () => {
  const questions = ["c", "a", "d", "b"].map((id) => ({ id, contentType: "word", correctAnswer: id }));
  const first = selectQuestions(questions, { seed: "daily-2026-07-22", limit: 3 }).map((question) => question.id);
  const second = selectQuestions([...questions].reverse(), { seed: "daily-2026-07-22", limit: 3 }).map((question) => question.id);
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, 3);
});

test("score calculation applies speed, difficulty, review, spelling and combo deterministically", () => {
  const result = calculateScore({
    isCorrect: true,
    responseTimeMs: 2_000,
    comboBefore: 4,
    difficulty: 3,
    isReview: true,
    questionType: "spelling",
    hintUsed: false,
  });
  assert.deepEqual(result, {
    total: 264,
    combo: 5,
    multiplier: 1.2,
    breakdown: {
      base: 100,
      speed: 50,
      difficulty: 20,
      review: 25,
      spelling: 25,
      noMiss: 0,
      subtotal: 220,
    },
  });
  assert.equal(calculateScore({ isCorrect: false, combo: 29 }).combo, 0);
});

test("weakness and daily queues prioritize due/error-prone content without duplicates", () => {
  const questions = [
    { id: "review", contentType: "word", contentId: "review", correctAnswer: "review" },
    { id: "weak", contentType: "word", contentId: "weak", correctAnswer: "weak" },
    { id: "new", contentType: "word", contentId: "new", correctAnswer: "new" },
    { id: "phrase-a", contentType: "phrase", contentId: "phrase-a", correctAnswer: "get up" },
    { id: "phrase-b", contentType: "phrase", contentId: "phrase-b", correctAnswer: "look at" },
    { id: "grammar", contentType: "grammar", contentId: "grammar", correctAnswer: "am" },
  ];
  const mastery = [
    {
      contentType: "word",
      contentId: "review",
      masteryLevel: 2,
      correctCount: 2,
      incorrectCount: 2,
      nextReviewAt: "2026-07-21T00:00:00.000Z",
    },
    {
      contentType: "word",
      contentId: "weak",
      masteryLevel: 0,
      correctCount: 1,
      incorrectCount: 6,
      nextReviewAt: "2026-07-30T00:00:00.000Z",
    },
  ];

  const weak = buildWeaknessQueue(questions, mastery, { now: NOW, limit: 2, seed: "weak" });
  assert.equal(weak[0].id, "weak");

  const daily = buildDailyQueue(questions, mastery, {
    now: NOW,
    seed: "daily",
    newCount: 1,
    reviewCount: 1,
    phraseCount: 1,
    grammarCount: 1,
    limit: 4,
  });
  const ids = daily.map((question) => question.id);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4);
  assert.ok(ids.includes("review"));
  assert.ok(ids.includes("grammar"));
});

test("time attack queue has deterministic target length and cycles a small pool", () => {
  const questions = [
    { id: "one", contentType: "word" },
    { id: "two", contentType: "word" },
  ];
  const first = buildTimeAttackQueue(questions, { durationSeconds: 30, averageResponseTimeMs: 5_000, seed: "run" });
  const second = buildTimeAttackQueue(questions, { durationSeconds: 30, averageResponseTimeMs: 5_000, seed: "run" });
  assert.equal(first.length, 9);
  assert.deepEqual(first.map((question) => question.id), second.map((question) => question.id));
});

test("mastery uses spaced intervals and requires productive recall for high levels", () => {
  const first = updateMastery({}, {
    isCorrect: true,
    questionType: "en_to_ja_choice",
    responseTimeMs: 3_000,
    answeredAt: NOW,
  });
  assert.equal(first.masteryLevel, 1);
  assert.equal(first.productiveCorrectCount, 0);
  assert.equal(first.nextReviewAt, "2026-07-23T12:00:00.000Z");

  const capped = updateMastery({ ...first, masteryLevel: 3 }, {
    isCorrect: true,
    questionType: "choice",
    responseTimeMs: 2_000,
    answeredAt: NOW,
  });
  assert.equal(capped.masteryLevel, 3);

  const productive = updateMastery(capped, {
    isCorrect: true,
    questionType: "spelling",
    responseTimeMs: 2_000,
    answeredAt: NOW,
  });
  assert.equal(productive.masteryLevel, 4);
  assert.equal(productive.nextReviewAt, "2026-08-05T12:00:00.000Z");

  const missed = updateMastery(productive, {
    isCorrect: false,
    questionType: "spelling",
    responseTimeMs: 9_000,
    answeredAt: NOW,
  });
  assert.equal(missed.masteryLevel, 2);
  assert.equal(missed.consecutiveCorrect, 0);
  assert.equal(missed.nextReviewAt, NOW.toISOString());
});

test("stats aggregation avoids summary double counting and calculates streaks", () => {
  const stats = aggregateStats({
    attempts: [
      { date: "2026-07-22", isCorrect: true, score: 150, combo: 2, responseTimeMs: 2_000 },
      { date: "2026-07-22", isCorrect: false, score: 0, combo: 0, responseTimeMs: 4_000 },
    ],
    sessions: [
      { date: "2026-07-22", durationSeconds: 300, score: 150, maxCombo: 2 },
    ],
    dailySummaries: [
      { date: "2026-07-21", studySeconds: 180, sessionCount: 1, questionCount: 1, correctCount: 1, incorrectCount: 0, score: 200, highScore: 200 },
      { date: "2026-07-22", studySeconds: 300, sessionCount: 1, questionCount: 2, correctCount: 1, incorrectCount: 1, score: 150, highScore: 150 },
    ],
    mastery: [
      { masteryLevel: 4, correctCount: 8, incorrectCount: 0 },
      { masteryLevel: 0, correctCount: 1, incorrectCount: 5, difficultyScore: 20 },
    ],
  }, { now: NOW });

  assert.equal(stats.studySeconds, 480);
  assert.equal(stats.questionCount, 3);
  assert.equal(stats.correctCount, 2);
  assert.equal(stats.accuracy, 66.7);
  assert.equal(stats.averageResponseTimeMs, 3_000);
  assert.equal(stats.totalScore, 350);
  assert.equal(stats.highScore, 200);
  assert.equal(stats.currentStreak, 2);
  assert.equal(stats.longestStreak, 2);
  assert.equal(stats.masteredContentCount, 1);
  assert.equal(stats.weakContentCount, 1);
});

test("storage works without browser globals and supports backup, restore and reset", async () => {
  const clock = () => new Date("2026-07-22T10:00:00.000Z");
  const repository = createStorage({ indexedDB: null, localStorage: null, clock });
  await repository.ready();
  assert.equal(repository.backendType, "memory");

  await repository.saveProfile({ nickname: "Quest Kid" });
  await repository.saveSettings({ dailyGoalMinutes: 10 });
  await repository.createSession({ id: "session-1", startedAt: "2026-07-22T09:00:00.000Z" });
  await repository.recordAttempt({
    id: "attempt-1",
    sessionId: "session-1",
    contentType: "word",
    contentId: "dog",
    isCorrect: true,
    score: 150,
    combo: 1,
    responseTimeMs: 2_000,
    answeredAt: "2026-07-22T09:00:30.000Z",
  });
  await repository.saveMastery({ contentType: "word", contentId: "dog", masteryLevel: 1 });
  await repository.finishSession("session-1", { endedAt: "2026-07-22T09:01:00.000Z", score: 150 });

  const backup = await repository.exportData();
  assert.equal(backup.data.profiles[0].nickname, "Quest Kid");
  assert.equal(backup.data.attempts.length, 1);
  assert.equal(backup.data.dailySummaries[0].studySeconds, 60);

  const restored = createStorage({ indexedDB: null, localStorage: null, clock });
  const counts = await restored.importData(backup);
  assert.equal(counts.attempts, 1);
  assert.equal((await restored.getProfile()).nickname, "Quest Kid");
  assert.equal((await restored.listMastery()).length, 1);

  await restored.resetData({ preserveSettings: true });
  assert.equal((await restored.listAttempts()).length, 0);
  assert.equal((await restored.getSettings()).dailyGoalMinutes, 10);
});
