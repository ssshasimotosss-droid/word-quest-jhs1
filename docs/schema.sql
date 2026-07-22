-- WORD QUEST local SQLite schema
-- Content field names are snake_case equivalents of public/data/content.json.
-- The application should run this file with foreign key enforcement enabled.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS content_metadata (
  content_version TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'ja-JP',
  source TEXT NOT NULL,
  license TEXT NOT NULL,
  license_note TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS words (
  id TEXT PRIMARY KEY NOT NULL,
  lemma TEXT NOT NULL,
  display_form TEXT NOT NULL,
  meanings_ja_json TEXT NOT NULL CHECK (json_valid(meanings_ja_json)),
  part_of_speech TEXT NOT NULL CHECK (
    part_of_speech IN ('noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction', 'other')
  ),
  grade TEXT NOT NULL CHECK (grade IN ('elementary', 'jhs1')),
  stage INTEGER NOT NULL CHECK (stage >= 1),
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 6),
  plural_form TEXT,
  third_person_singular TEXT,
  past_form TEXT,
  past_participle TEXT,
  ing_form TEXT,
  pronunciation TEXT,
  audio_path TEXT,
  image_path TEXT,
  example_en TEXT NOT NULL,
  example_ja TEXT NOT NULL,
  source TEXT NOT NULL,
  license TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_words_grade_stage
  ON words (grade, stage, difficulty);

CREATE TABLE IF NOT EXISTS phrases (
  id TEXT PRIMARY KEY NOT NULL,
  expression TEXT NOT NULL,
  meaning_ja TEXT NOT NULL,
  type TEXT NOT NULL CHECK (
    type IN ('phrase', 'idiom', 'greeting', 'response', 'classroom_expression', 'daily_expression')
  ),
  grade TEXT NOT NULL CHECK (grade IN ('elementary', 'jhs1')),
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 6),
  example_en TEXT NOT NULL,
  example_ja TEXT NOT NULL,
  audio_path TEXT,
  image_path TEXT,
  source TEXT NOT NULL,
  license TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_phrases_grade_difficulty
  ON phrases (grade, difficulty);

CREATE TABLE IF NOT EXISTS grammar_units (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  grade TEXT NOT NULL CHECK (grade IN ('elementary', 'jhs1')),
  stage INTEGER NOT NULL CHECK (stage >= 1),
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 6),
  short_explanation TEXT NOT NULL,
  learning_goal TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  license TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_grammar_units_grade_stage
  ON grammar_units (grade, stage, sort_order);

CREATE TABLE IF NOT EXISTS grammar_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grammar_unit_id TEXT NOT NULL,
  example_en TEXT NOT NULL,
  example_ja TEXT NOT NULL,
  explanation TEXT,
  audio_path TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (grammar_unit_id) REFERENCES grammar_units (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_grammar_examples_unit
  ON grammar_examples (grammar_unit_id, sort_order);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('word', 'phrase', 'grammar')),
  content_id TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (
    question_type IN (
      'en_to_ja_choice',
      'ja_to_en_choice',
      'spelling',
      'fill_blank',
      'word_order',
      'conversation_choice'
    )
  ),
  prompt TEXT NOT NULL,
  choices_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(choices_json)),
  correct_answer TEXT NOT NULL,
  hint TEXT NOT NULL,
  explanation TEXT NOT NULL,
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 6),
  image_path TEXT,
  audio_path TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_questions_content
  ON questions (content_type, content_id, question_type);

CREATE INDEX IF NOT EXISTS idx_questions_type_difficulty
  ON questions (question_type, difficulty);

-- SQLite cannot express a foreign key whose destination depends on content_type.
-- These triggers enforce the polymorphic question reference during writes.
CREATE TRIGGER IF NOT EXISTS questions_content_reference_insert
BEFORE INSERT ON questions
BEGIN
  SELECT CASE
    WHEN NEW.content_type = 'word'
      AND NOT EXISTS (SELECT 1 FROM words WHERE id = NEW.content_id)
      THEN RAISE(ABORT, 'question references an unknown word')
    WHEN NEW.content_type = 'phrase'
      AND NOT EXISTS (SELECT 1 FROM phrases WHERE id = NEW.content_id)
      THEN RAISE(ABORT, 'question references an unknown phrase')
    WHEN NEW.content_type = 'grammar'
      AND NOT EXISTS (SELECT 1 FROM grammar_units WHERE id = NEW.content_id)
      THEN RAISE(ABORT, 'question references an unknown grammar unit')
  END;
END;

CREATE TRIGGER IF NOT EXISTS questions_content_reference_update
BEFORE UPDATE OF content_type, content_id ON questions
BEGIN
  SELECT CASE
    WHEN NEW.content_type = 'word'
      AND NOT EXISTS (SELECT 1 FROM words WHERE id = NEW.content_id)
      THEN RAISE(ABORT, 'question references an unknown word')
    WHEN NEW.content_type = 'phrase'
      AND NOT EXISTS (SELECT 1 FROM phrases WHERE id = NEW.content_id)
      THEN RAISE(ABORT, 'question references an unknown phrase')
    WHEN NEW.content_type = 'grammar'
      AND NOT EXISTS (SELECT 1 FROM grammar_units WHERE id = NEW.content_id)
      THEN RAISE(ABORT, 'question references an unknown grammar unit')
  END;
END;

CREATE TABLE IF NOT EXISTS learning_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT 'local-user',
  content_type TEXT NOT NULL CHECK (content_type IN ('word', 'phrase', 'grammar')),
  content_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  question_type TEXT NOT NULL,
  answered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  response_time_ms INTEGER NOT NULL CHECK (response_time_ms >= 0),
  user_answer TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0),
  combo INTEGER NOT NULL DEFAULT 0 CHECK (combo >= 0),
  FOREIGN KEY (question_id) REFERENCES questions (id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_learning_records_user_date
  ON learning_records (user_id, answered_at DESC);

CREATE INDEX IF NOT EXISTS idx_learning_records_content
  ON learning_records (user_id, content_type, content_id, answered_at DESC);

CREATE TABLE IF NOT EXISTS mastery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT 'local-user',
  content_type TEXT NOT NULL CHECK (content_type IN ('word', 'phrase', 'grammar')),
  content_id TEXT NOT NULL,
  mastery_level INTEGER NOT NULL DEFAULT 0 CHECK (mastery_level BETWEEN 0 AND 6),
  correct_count INTEGER NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  incorrect_count INTEGER NOT NULL DEFAULT 0 CHECK (incorrect_count >= 0),
  consecutive_correct INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_correct >= 0),
  average_response_time_ms INTEGER NOT NULL DEFAULT 0 CHECK (average_response_time_ms >= 0),
  last_answered_at TEXT,
  last_correct_at TEXT,
  next_review_at TEXT,
  difficulty_score REAL NOT NULL DEFAULT 0 CHECK (difficulty_score >= 0),
  UNIQUE (user_id, content_type, content_id)
);

CREATE INDEX IF NOT EXISTS idx_mastery_review_queue
  ON mastery (user_id, next_review_at, difficulty_score DESC);

CREATE TABLE IF NOT EXISTS daily_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT 'local-user',
  study_date TEXT NOT NULL,
  study_seconds INTEGER NOT NULL DEFAULT 0 CHECK (study_seconds >= 0),
  question_count INTEGER NOT NULL DEFAULT 0 CHECK (question_count >= 0),
  correct_count INTEGER NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  incorrect_count INTEGER NOT NULL DEFAULT 0 CHECK (incorrect_count >= 0),
  score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
  high_score INTEGER NOT NULL DEFAULT 0 CHECK (high_score >= 0),
  max_combo INTEGER NOT NULL DEFAULT 0 CHECK (max_combo >= 0),
  learned_word_count INTEGER NOT NULL DEFAULT 0 CHECK (learned_word_count >= 0),
  learned_phrase_count INTEGER NOT NULL DEFAULT 0 CHECK (learned_phrase_count >= 0),
  reviewed_word_count INTEGER NOT NULL DEFAULT 0 CHECK (reviewed_word_count >= 0),
  grammar_question_count INTEGER NOT NULL DEFAULT 0 CHECK (grammar_question_count >= 0),
  time_attack_high_score INTEGER NOT NULL DEFAULT 0 CHECK (time_attack_high_score >= 0),
  UNIQUE (user_id, study_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_records_user_date
  ON daily_records (user_id, study_date DESC);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY NOT NULL DEFAULT 'local-user',
  nickname TEXT NOT NULL DEFAULT 'プレイヤー',
  selected_grades_json TEXT NOT NULL DEFAULT '["jhs1"]' CHECK (json_valid(selected_grades_json)),
  daily_goal_minutes INTEGER NOT NULL DEFAULT 5 CHECK (daily_goal_minutes IN (3, 5, 10, 15)),
  notifications_enabled INTEGER NOT NULL DEFAULT 0 CHECK (notifications_enabled IN (0, 1)),
  notification_time TEXT,
  bgm_volume REAL NOT NULL DEFAULT 0.7 CHECK (bgm_volume BETWEEN 0 AND 1),
  sound_effect_volume REAL NOT NULL DEFAULT 0.8 CHECK (sound_effect_volume BETWEEN 0 AND 1),
  speech_volume REAL NOT NULL DEFAULT 1.0 CHECK (speech_volume BETWEEN 0 AND 1),
  vibration_enabled INTEGER NOT NULL DEFAULT 1 CHECK (vibration_enabled IN (0, 1)),
  reduced_motion INTEGER NOT NULL DEFAULT 0 CHECK (reduced_motion IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO user_settings (user_id) VALUES ('local-user');
