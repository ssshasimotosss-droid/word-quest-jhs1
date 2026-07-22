import assert from "node:assert/strict";
import test from "node:test";

import { speak } from "../src/audio.js";

test("speech synthesis receives the exact text and an English voice", async () => {
  const previousSynth = globalThis.speechSynthesis;
  const previousUtterance = globalThis.SpeechSynthesisUtterance;
  let spoken = null;

  class FakeUtterance extends EventTarget {
    constructor(text) {
      super();
      this.text = text;
      this.lang = "";
      this.voice = null;
    }
  }

  const englishVoice = { name: "English Test Voice", lang: "en-US" };
  globalThis.SpeechSynthesisUtterance = FakeUtterance;
  globalThis.speechSynthesis = {
    cancel() {},
    getVoices() { return [englishVoice, { name: "Japanese Voice", lang: "ja-JP" }]; },
    speak(utterance) {
      spoken = utterance;
      queueMicrotask(() => utterance.dispatchEvent(new Event("end")));
    },
  };

  try {
    assert.equal(await speak("I am a student."), true);
    assert.equal(spoken.text, "I am a student.");
    assert.equal(spoken.lang, "en-US");
    assert.equal(spoken.voice, englishVoice);
  } finally {
    globalThis.speechSynthesis = previousSynth;
    globalThis.SpeechSynthesisUtterance = previousUtterance;
  }
});
