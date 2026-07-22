import assert from "node:assert/strict";
import test from "node:test";

import { resolveQuestionAudioText } from "../src/question-audio.js";
import {
  buildCategorizedDailyQueue,
  filterQuestionsByCategory,
  questionMatchesCategory,
} from "../src/question-categories.js";

const sampleQuestions = [
  { id: "word_1", contentType: "word", questionType: "spelling", correctAnswer: "apple" },
  { id: "word_2", contentType: "word", questionType: "en_to_ja_choice", correctAnswer: "りんご" },
  { id: "grammar_1", contentType: "grammar", questionType: "fill_blank", correctAnswer: "am" },
  { id: "phrase_1", contentType: "phrase", questionType: "word_order", correctAnswer: "I get up." },
  { id: "listen_1", contentType: "word", questionType: "listening_choice", correctAnswer: "りんご" },
  { id: "listen_2", contentType: "word", questionType: "listening_choice", correctAnswer: "本" },
];

test("daily and stage categories never leak into each other", () => {
  assert.deepEqual(filterQuestionsByCategory(sampleQuestions, "word").map(({ id }) => id), ["word_1", "word_2"]);
  assert.deepEqual(filterQuestionsByCategory(sampleQuestions, "grammar").map(({ id }) => id), ["grammar_1"]);
  assert.deepEqual(filterQuestionsByCategory(sampleQuestions, "listening").map(({ id }) => id), ["listen_1", "listen_2"]);
  assert.deepEqual(filterQuestionsByCategory(sampleQuestions, "phrase").map(({ id }) => id), ["phrase_1"]);
});

test("categorized daily queues preserve the requested category across review cycles", () => {
  for (const category of ["word", "grammar", "listening"]) {
    const queue = buildCategorizedDailyQueue(sampleQuestions, [], { category, limit: 8, seed: category });
    assert.equal(queue.length, 8);
    assert.equal(queue.every((question) => questionMatchesCategory(question, category)), true);
  }
  const mixed = buildCategorizedDailyQueue(sampleQuestions, [], { category: "mixed", limit: 8, seed: "mixed" });
  assert.equal(mixed.length, 8);
  assert.equal(mixed.some((question) => question.questionType === "listening_choice"), true);
  assert.equal(mixed.some((question) => question.questionType !== "listening_choice"), true);
});

test("audio text uses complete, relevant English instead of isolated grammar fragments", () => {
  assert.equal(resolveQuestionAudioText(
    { questionType: "fill_blank", prompt: "I ___ a student.", correctAnswer: "am" },
  ), "I am a student.");
  assert.equal(resolveQuestionAudioText(
    { questionType: "word_order", prompt: "並べ替え", correctAnswer: "I listen to music after school." },
    { expression: "listen to" },
  ), "I listen to music after school.");
  assert.equal(resolveQuestionAudioText(
    { questionType: "conversation_choice", prompt: "A: Can you help me?\nB: ______", correctAnswer: "Of course." },
  ), "Can you help me?");
  assert.equal(resolveQuestionAudioText(
    { questionType: "listening_choice", audioText: "library", correctAnswer: "図書館" },
  ), "library");
});
