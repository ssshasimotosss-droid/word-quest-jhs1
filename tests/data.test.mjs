import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const contentUrl = new URL('../public/data/content.json', import.meta.url);
const schemaUrl = new URL('../schemas/content.schema.json', import.meta.url);

const content = JSON.parse(await readFile(contentUrl, 'utf8'));
const schema = JSON.parse(await readFile(schemaUrl, 'utf8'));

const requiredQuestionTypes = [
  'en_to_ja_choice',
  'ja_to_en_choice',
  'spelling',
  'fill_blank',
  'word_order',
  'conversation_choice',
  'listening_choice',
];

const choiceQuestionTypes = new Set([
  'en_to_ja_choice',
  'ja_to_en_choice',
  'conversation_choice',
  'listening_choice',
]);

function assertUniqueIds(items, label) {
  const ids = items.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, `${label} IDs must be unique`);
  for (const id of ids) {
    assert.match(id, /^[a-z][a-z0-9_]*$/, `${label} ID is invalid: ${id}`);
  }
}

function sortedTokens(value) {
  return value
    .replace(/[.!?,]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toLocaleLowerCase('en'))
    .sort();
}

test('content bundle is versioned and meets the requested minimum counts', () => {
  assert.match(content.contentVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(content.metadata.locale, 'ja-JP');
  assert.match(content.metadata.source, /オリジナル|新規作成/);
  assert.ok(content.metadata.license.length > 0);
  assert.ok(content.metadata.licenseNote.length > 0);

  assert.ok(content.words.length >= 114, 'at least 114 words are required');
  assert.ok(content.phrases.length >= 12, 'at least 12 phrases are required');
  assert.ok(content.grammarUnits.length >= 10, 'at least 10 grammar units are required');
  assert.ok(content.questions.length >= 438, 'at least 438 explicit questions are required');

  const elementaryWords = content.words.filter((word) => word.grade === 'elementary');
  const jhs1Words = content.words.filter((word) => word.grade === 'jhs1');
  assert.ok(elementaryWords.length > 0, 'elementary words are required');
  assert.ok(jhs1Words.length >= 102, 'at least 102 jhs1 words are required');

  const expandedWordQuestions = content.questions.filter(({ id }) => id.startsWith('question_jhs1_'));
  assert.equal(expandedWordQuestions.length, 360, '90 added words need four questions each');
  const expectedTypes = new Set(['en_to_ja_choice', 'ja_to_en_choice', 'spelling', 'listening_choice']);
  for (const word of jhs1Words.filter(({ id }) => id.startsWith('word_jhs1_') && ![
    'word_jhs1_study', 'word_jhs1_speak', 'word_jhs1_library', 'word_jhs1_subject',
    'word_jhs1_favorite', 'word_jhs1_usually', 'word_jhs1_practice', 'word_jhs1_homework',
    'word_jhs1_interesting', 'word_jhs1_difficult', 'word_jhs1_visit', 'word_jhs1_help',
  ].includes(id))) {
    const types = new Set(expandedWordQuestions
      .filter(({ contentId }) => contentId === word.id)
      .map(({ questionType }) => questionType));
    assert.deepEqual(types, expectedTypes, `${word.id} needs meaning, production, spelling, and listening`);
  }
});

test('JSON Schema declares the same content sections and minimums', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.deepEqual(
    new Set(schema.required),
    new Set(['contentVersion', 'metadata', 'words', 'phrases', 'grammarUnits', 'questions']),
  );
  assert.equal(schema.properties.words.minItems, 114);
  assert.equal(schema.properties.phrases.minItems, 12);
  assert.equal(schema.properties.grammarUnits.minItems, 10);
  assert.equal(schema.properties.questions.minItems, 438);
});

test('see, look, and watch are distinguished with context and shared choices', () => {
  const expectedMeanings = {
    see: '自然に見える・目に入る',
    look: '目を向けて見る',
    watch: 'テレビ・動画などを見る',
  };

  for (const [lemma, meaning] of Object.entries(expectedMeanings)) {
    const word = content.words.find(({ id }) => id === `word_jhs1_${lemma}`);
    assert.equal(word?.meaningsJa[0], meaning);

    const production = content.questions.find(({ id }) => id === `question_jhs1_${lemma}_production`);
    assert.ok(production.prompt.includes(word.example.ja), `${lemma} needs a Japanese context sentence`);
    assert.deepEqual(new Set(production.choices), new Set(['see', 'look', 'watch', 'read']));
    assert.equal(production.correctAnswer, lemma);
    assert.match(production.hint, /目|テレビ|動画|試合/);
  }
});

test('content IDs are valid and unique, including across content collections', () => {
  assertUniqueIds(content.words, 'word');
  assertUniqueIds(content.phrases, 'phrase');
  assertUniqueIds(content.grammarUnits, 'grammar unit');
  assertUniqueIds(content.questions, 'question');

  const contentIds = [
    ...content.words.map(({ id }) => id),
    ...content.phrases.map(({ id }) => id),
    ...content.grammarUnits.map(({ id }) => id),
  ];
  assert.equal(
    new Set(contentIds).size,
    contentIds.length,
    'IDs must also be unique across words, phrases, and grammar units',
  );
});

test('all learning content carries original-source and license metadata', () => {
  const allContent = [...content.words, ...content.phrases, ...content.grammarUnits];
  for (const item of allContent) {
    assert.equal(item.source, 'original', `${item.id} must identify its source as original`);
    assert.ok(item.license.length > 0, `${item.id} must include a license label`);
    assert.equal(item.isActive, true, `${item.id} should be active`);
    assert.ok(item.difficulty >= 1 && item.difficulty <= 6, `${item.id} difficulty is invalid`);
  }

  for (const word of content.words) {
    assert.ok(word.lemma.length > 0);
    assert.ok(word.displayForm.length > 0);
    assert.ok(word.meaningsJa.length > 0);
    assert.ok(word.example.en.length > 0);
    assert.ok(word.example.ja.length > 0);
  }

  for (const phrase of content.phrases) {
    assert.ok(phrase.expression.length > 0);
    assert.ok(phrase.meaningJa.length > 0);
    assert.ok(phrase.example.en.length > 0);
    assert.ok(phrase.example.ja.length > 0);
  }

  for (const unit of content.grammarUnits) {
    assert.ok(unit.shortExplanation.length > 0);
    assert.ok(unit.learningGoal.length > 0);
    assert.ok(unit.examples.length > 0);
  }
});

test('questions span every required type and contain learner support', () => {
  const counts = Object.fromEntries(requiredQuestionTypes.map((type) => [type, 0]));

  for (const question of content.questions) {
    assert.ok(
      requiredQuestionTypes.includes(question.questionType),
      `${question.id} has an unsupported question type`,
    );
    counts[question.questionType] += 1;
    assert.ok(question.prompt.trim().length > 0, `${question.id} needs a prompt`);
    assert.ok(question.correctAnswer.trim().length > 0, `${question.id} needs a correct answer`);
    assert.ok(question.hint.trim().length > 0, `${question.id} needs a hint`);
    assert.ok(question.explanation.trim().length > 0, `${question.id} needs an explanation`);
    assert.ok(
      question.difficulty >= 1 && question.difficulty <= 6,
      `${question.id} difficulty is invalid`,
    );
    if (question.questionType === 'listening_choice') {
      assert.ok(question.audioText?.trim(), `${question.id} needs explicit audioText`);
      assert.doesNotMatch(question.prompt, /[A-Za-z]/, `${question.id} must not reveal the English audio in its prompt`);
    }
  }

  for (const type of requiredQuestionTypes) {
    assert.ok(counts[type] > 0, `questions of type ${type} are required`);
  }
});

test('every question references an existing content record of the declared type', () => {
  const references = {
    word: new Set(content.words.map(({ id }) => id)),
    phrase: new Set(content.phrases.map(({ id }) => id)),
    grammar: new Set(content.grammarUnits.map(({ id }) => id)),
  };

  for (const question of content.questions) {
    assert.ok(
      Object.hasOwn(references, question.contentType),
      `${question.id} has an unsupported contentType`,
    );
    assert.ok(
      references[question.contentType].has(question.contentId),
      `${question.id} references missing ${question.contentType} ${question.contentId}`,
    );
  }
});

test('choice questions have unique choices containing the correct answer', () => {
  for (const question of content.questions.filter(({ questionType }) => choiceQuestionTypes.has(questionType))) {
    assert.ok(question.choices.length >= 3, `${question.id} needs at least three choices`);
    assert.equal(
      new Set(question.choices).size,
      question.choices.length,
      `${question.id} contains duplicate choices`,
    );
    assert.ok(
      question.choices.includes(question.correctAnswer),
      `${question.id} choices do not contain its correct answer`,
    );
  }
});

test('word translation and spelling answers agree with their referenced words', () => {
  const wordsById = new Map(content.words.map((word) => [word.id, word]));

  for (const question of content.questions.filter(({ contentType }) => contentType === 'word')) {
    const word = wordsById.get(question.contentId);
    if (question.questionType === 'en_to_ja_choice') {
      assert.ok(
        word.meaningsJa.includes(question.correctAnswer),
        `${question.id} answer does not match ${word.id} meanings`,
      );
    }
    if (question.questionType === 'ja_to_en_choice' || question.questionType === 'spelling') {
      assert.equal(
        question.correctAnswer.toLocaleLowerCase('en'),
        word.lemma.toLocaleLowerCase('en'),
        `${question.id} answer does not match ${word.id} lemma`,
      );
    }
  }
});

test('fill-blank and word-order questions can be resolved from their explicit answers', () => {
  for (const question of content.questions.filter(({ questionType }) => questionType === 'fill_blank')) {
    assert.match(question.prompt, /___/, `${question.id} needs an explicit blank marker`);
    const completed = question.prompt.replace('___', question.correctAnswer);
    assert.ok(!completed.includes('___'), `${question.id} answer did not fill the blank`);
  }

  for (const question of content.questions.filter(({ questionType }) => questionType === 'word_order')) {
    assert.ok(question.choices.length >= 2, `${question.id} needs orderable tokens`);
    assert.deepEqual(
      question.choices.flatMap(sortedTokens).sort(),
      sortedTokens(question.correctAnswer),
      `${question.id} tokens cannot form its correct answer`,
    );
  }
});
