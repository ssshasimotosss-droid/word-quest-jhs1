import { questionType } from "./game-engine.js";

function hasEnglish(value) {
  return /[A-Za-z]/u.test(String(value ?? ""));
}

function completeBlank(prompt, answer) {
  const source = String(prompt ?? "").trim();
  if (!source || !hasEnglish(source)) return "";
  return source.replace(/_{2,}/gu, String(answer ?? "").trim()).replace(/\s+/gu, " ").trim();
}

function conversationPrompt(prompt) {
  const source = String(prompt ?? "").trim();
  if (!hasEnglish(source)) return "";
  return source
    .replace(/\n?\s*[A-Z]:\s*_{2,}[\s\S]*$/u, "")
    .replace(/^\s*[A-Z]:\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Resolves the exact English that the pronunciation button should speak. */
export function resolveQuestionAudioText(question, content = null) {
  const explicit = question?.audioText ?? question?.speechText ?? question?.listeningText;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();

  const type = questionType(question);
  const answer = String(question?.correctAnswer ?? "").trim();
  const prompt = String(question?.prompt ?? "").trim();

  if (type === "fill_blank") {
    const completed = completeBlank(prompt, answer);
    if (completed) return completed;
  }
  if (type === "word_order" && hasEnglish(answer)) return answer;
  if (type === "conversation_choice") {
    const spokenPrompt = conversationPrompt(prompt);
    if (spokenPrompt) return spokenPrompt;
  }
  if (["en_to_ja_choice", "ja_to_en_choice", "spelling"].includes(type)) {
    if (typeof content?.lemma === "string" && content.lemma.trim()) return content.lemma.trim();
    if (hasEnglish(answer)) return answer;
  }
  if (typeof content?.expression === "string" && content.expression.trim()) {
    return content.expression.trim();
  }
  if (hasEnglish(answer)) return answer;
  if (hasEnglish(prompt)) return prompt;
  return "";
}
