import {
  buildDailyQueue,
  questionContentType,
  questionType,
  seededShuffle,
} from "./game-engine.js";

export const DAILY_CATEGORY_LABELS = Object.freeze({
  word: "📘 単語",
  grammar: "🏛️ 文法",
  listening: "🎧 リスニング",
  mixed: "🌈 全部ミックス",
  phrase: "💬 熟語・会話",
});

export function questionMatchesCategory(question, category) {
  const type = questionType(question);
  const contentType = questionContentType(question);
  if (category === "listening") return type === "listening_choice";
  if (category === "word") return contentType === "word" && type !== "listening_choice";
  if (category === "grammar") return contentType === "grammar" && type !== "listening_choice";
  if (category === "phrase") return contentType === "phrase" && type !== "listening_choice";
  return category === "mixed";
}

export function filterQuestionsByCategory(questions, category) {
  if (category === "mixed") return [...questions];
  return questions.filter((question) => questionMatchesCategory(question, category));
}

function fillWithReviewCycles(queue, pool, target, seed) {
  const result = queue.slice(0, target);
  let cycle = 1;
  while (result.length < target && pool.length) {
    const shuffled = seededShuffle(pool, `${seed}:cycle:${cycle}`);
    result.push(...shuffled.slice(0, target - result.length));
    cycle += 1;
  }
  return result;
}

export function buildCategorizedDailyQueue(questions, mastery, options = {}) {
  const category = ["word", "grammar", "listening", "mixed"].includes(options.category)
    ? options.category
    : "mixed";
  const limit = Math.max(1, Math.floor(Number(options.limit) || 8));
  const seed = options.seed ?? "daily-category";

  if (category !== "mixed") {
    const pool = filterQuestionsByCategory(questions, category);
    const prioritized = buildDailyQueue(pool, mastery, { limit, seed: `${seed}:${category}` });
    return fillWithReviewCycles(prioritized, pool, limit, `${seed}:${category}`);
  }

  const listeningPool = filterQuestionsByCategory(questions, "listening");
  const corePool = questions.filter((question) => questionType(question) !== "listening_choice");
  const listeningTarget = listeningPool.length ? Math.max(1, Math.round(limit * 0.25)) : 0;
  const coreTarget = limit - listeningTarget;
  const core = buildDailyQueue(corePool, mastery, { limit: coreTarget, seed: `${seed}:core` });
  const listening = buildDailyQueue(listeningPool, mastery, {
    limit: listeningTarget,
    seed: `${seed}:listening`,
  });
  const completedCore = fillWithReviewCycles(core, corePool, coreTarget, `${seed}:core`);
  const completedListening = fillWithReviewCycles(
    listening,
    listeningPool,
    listeningTarget,
    `${seed}:listening`,
  );
  return seededShuffle([...completedCore, ...completedListening], `${seed}:mixed`).slice(0, limit);
}
