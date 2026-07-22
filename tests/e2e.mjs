import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(currentDirectory, "..");
const screenshotDirectory = path.join(currentDirectory, "screenshots");
const content = JSON.parse(await readFile(path.join(projectDirectory, "public/data/content.json"), "utf8"));
const questionByPrompt = new Map(content.questions.map((question) => [question.prompt.trim(), question]));
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function answerCorrectly(page, question) {
  if (question.questionType === "word_order") {
    const tokens = question.correctAnswer.replace(/[.!?]+$/u, "").split(/\s+/u);
    for (const token of tokens) {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const chip = page.locator(".word-bank .word-chip", { hasText: token })
        .filter({ hasText: new RegExp(`^${escaped}$`) })
        .first();
      await chip.click();
    }
    await page.getByRole("button", { name: /この順番で決定/ }).click();
  } else if (["spelling", "fill_blank"].includes(question.questionType) && question.choices.length === 0) {
    await page.locator("#answer-input").fill(question.correctAnswer);
    await page.getByRole("button", { name: "答える" }).click();
  } else {
    await page.locator(".choice-button").filter({ hasText: question.correctAnswer }).first().click();
  }
}

await mkdir(screenshotDirectory, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  locale: "ja-JP",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

await page.goto(process.env.WORD_QUEST_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
await page.getByRole("heading", { name: /英語の世界へ/ }).waitFor();
await page.locator("#nickname").fill("英語勇者");
await page.getByRole("button", { name: /冒険をはじめる/ }).click();
await page.getByRole("button", { name: /今日のクエスト/ }).first().waitFor();
await page.waitForTimeout(500);

assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "home must not overflow at 390px");
await page.screenshot({ path: path.join(screenshotDirectory, "mobile-home.png"), fullPage: true });

await page.getByRole("button", { name: /今日のクエスト/ }).first().click();
for (const category of ["word", "grammar", "listening", "mixed"]) {
  await page.locator(`.daily-category-button[data-category="${category}"]`).waitFor();
}
await page.waitForTimeout(350);
await page.screenshot({ path: path.join(screenshotDirectory, "mobile-daily-categories.png"), fullPage: true });
await page.locator('.daily-category-button[data-category="mixed"]').click();
await page.locator(".segment-button", { hasText: "3分" }).click();
await page.locator(".question-panel").waitFor();
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(screenshotDirectory, "mobile-game.png"), fullPage: true });

let answered = 0;
const dailyQuestionTypes = [];
while ((await page.locator(".question-panel").count()) && answered < 12) {
  const prompt = (await page.locator(".question-prompt").innerText()).trim();
  const question = questionByPrompt.get(prompt);
  assert.ok(question, `question prompt should exist in content: ${prompt}`);
  dailyQuestionTypes.push(question.questionType);
  await answerCorrectly(page, question);

  answered += 1;
  await page.locator(".feedback-card.success").waitFor();
  const next = page.locator('[data-action="next-question"]');
  if (await next.count()) await next.click();
  await page.waitForTimeout(80);
}

assert.equal(dailyQuestionTypes.includes("listening_choice"), true, "mixed daily quest should include listening");
assert.equal(dailyQuestionTypes.some((type) => type !== "listening_choice"), true, "mixed daily quest should include non-listening questions");

await page.locator(".result-card").waitFor({ timeout: 10_000 });
assert.match(await page.locator(".score-number").innerText(), /[1-9]/, "completed quest should award points");
await page.waitForTimeout(1600);
await page.screenshot({ path: path.join(screenshotDirectory, "mobile-result.png"), fullPage: true });

await page.getByRole("button", { name: "ホームへ", exact: true }).click();
await page.locator('[data-action="navigate"][data-screen="history"]').click();
await page.getByRole("heading", { name: "学習のきろく" }).waitFor();
await page.waitForTimeout(500);
assert.match(await page.locator(".record-list").first().innerText(), /今日のクエスト/, "completed session should be listed");
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "history must not overflow at 390px");
await page.screenshot({ path: path.join(screenshotDirectory, "mobile-history.png"), fullPage: true });

await page.reload({ waitUntil: "networkidle" });
await page.locator(".brand-sub", { hasText: "英語勇者" }).waitFor();
const serviceWorkerControlled = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller));
assert.equal(serviceWorkerControlled, true, "service worker should control the reloaded app");

await context.setOffline(true);
await page.reload({ waitUntil: "domcontentloaded" });
await page.locator(".brand-sub", { hasText: "英語勇者" }).waitFor();
assert.equal(await page.getByText("オフラインで冒険中").count(), 1, "cached app should render while offline");
await context.setOffline(false);
await page.reload({ waitUntil: "networkidle" });
await page.locator('[data-action="navigate"][data-screen="settings"]').click();
await page.getByRole("heading", { name: "設定" }).waitFor();
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "settings must not overflow at 390px");

const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.getByRole("button", { name: /記録をバックアップ/ }).click(),
]);
const backupPath = await download.path();
const backup = JSON.parse(await readFile(backupPath, "utf8"));
assert.equal(backup.format, "word-quest-backup", "downloaded backup should use the Word Quest format");
assert.ok(backup.data.sessions.length >= 1, "downloaded backup should include the completed session");

await page.getByRole("button", { name: "保護者画面を開く" }).click();
await page.locator("#parent-pin").fill("1234");
await page.getByRole("button", { name: "PINを設定" }).click();
await page.getByRole("heading", { name: "保護者レポート" }).waitFor();
await page.getByRole("button", { name: "ロック" }).click();
await page.locator("#parent-pin").fill("1234");
await page.getByRole("button", { name: "レポートを開く" }).click();
await page.getByRole("heading", { name: "保護者レポート" }).waitFor();

await page.locator('[data-action="navigate"][data-screen="learn"]').click();
await page.locator(".mode-card", { hasText: "ステージ練習" }).click();
await page.locator(".segment-button", { hasText: "英単語" }).click();
await page.locator(".question-panel").waitFor();
const retryPrompt = (await page.locator(".question-prompt").innerText()).trim();
const retryQuestion = questionByPrompt.get(retryPrompt);
assert.ok(retryQuestion, "retry test question should exist in content");
if (retryQuestion.choices.length) {
  const wrongAnswer = retryQuestion.choices.find((choice) => choice !== retryQuestion.correctAnswer);
  await page.locator(".choice-button").filter({ hasText: wrongAnswer }).first().click();
} else {
  await page.locator("#answer-input").fill("zzz");
  await page.getByRole("button", { name: "答える" }).click();
}
await page.locator(".feedback-card.retry", { hasText: "もう一回" }).waitFor();
await page.getByRole("button", { name: "答えを見る" }).click();
await page.locator(".feedback-card", { hasText: retryQuestion.correctAnswer }).waitFor();
assert.equal(retryQuestion.contentType, "word", "first word-stage question must be a word");
assert.notEqual(retryQuestion.questionType, "listening_choice", "word stage must exclude listening-only questions");
let stageQuestions = 1;
await page.locator('[data-action="next-question"]').click();
while ((await page.locator(".question-panel").count()) && stageQuestions < 12) {
  const stagePrompt = (await page.locator(".question-prompt").innerText()).trim();
  const stageQuestion = questionByPrompt.get(stagePrompt);
  assert.ok(stageQuestion, `stage prompt should exist in content: ${stagePrompt}`);
  assert.equal(stageQuestion.contentType, "word", `word stage leaked ${stageQuestion.contentType}: ${stageQuestion.id}`);
  assert.notEqual(stageQuestion.questionType, "listening_choice", `word stage leaked listening: ${stageQuestion.id}`);
  await answerCorrectly(page, stageQuestion);
  stageQuestions += 1;
  await page.locator(".feedback-card.success").waitFor();
  const nextStage = page.locator('[data-action="next-question"]');
  if (await nextStage.count()) await nextStage.click();
  await page.waitForTimeout(60);
}
await page.locator(".result-card").waitFor({ timeout: 10_000 });
assert.equal(stageQuestions, 12, "word stage should complete all 12 word questions");
await page.getByRole("button", { name: "ホームへ", exact: true }).click();
await page.getByRole("button", { name: /今日のクエスト/ }).first().waitFor();

const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await desktop.goto(process.env.WORD_QUEST_URL || "http://127.0.0.1:4173", { waitUntil: "networkidle" });
await desktop.getByRole("heading", { name: /英語の世界へ/ }).waitFor();
assert.equal(await desktop.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "onboarding must not overflow on desktop");
await desktop.screenshot({ path: path.join(screenshotDirectory, "desktop-onboarding.png"), fullPage: true });

await browser.close();

assert.deepEqual(errors, [], `browser errors detected:\n${errors.join("\n")}`);
console.log(JSON.stringify({ answered, dailyQuestionTypes, stageQuestions, serviceWorkerControlled, offlineReload: true, backupSessions: backup.data.sessions.length, parentPin: true, retryFlow: true, screenshots: screenshotDirectory, errors }, null, 2));
