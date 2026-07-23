import { readFile, writeFile } from "node:fs/promises";

const contentUrl = new URL("../public/data/content.json", import.meta.url);

const vocabulary = [
  ["student", "生徒", "noun", "students", "I am a junior high school student.", "私は中学生です。"],
  ["teacher", "先生", "noun", "teachers", "Our teacher is kind.", "私たちの先生は親切です。"],
  ["class", "授業", "noun", "classes", "English class starts at nine.", "英語の授業は9時に始まります。"],
  ["classroom", "教室", "noun", "classrooms", "Our classroom is bright.", "私たちの教室は明るいです。"],
  ["desk", "机", "noun", "desks", "My bag is under the desk.", "私のかばんは机の下です。"],
  ["notebook", "ノート", "noun", "notebooks", "This is my English notebook.", "これは私の英語ノートです。"],
  ["pencil", "えんぴつ", "noun", "pencils", "I need a new pencil.", "私は新しいえんぴつが必要です。"],
  ["question", "質問", "noun", "questions", "I have a question.", "私は質問があります。"],
  ["answer", "答え", "noun", "answers", "Write your answer here.", "ここに答えを書きましょう。"],
  ["language", "言語", "noun", "languages", "English is an important language.", "英語は大切な言語です。"],
  ["English", "英語", "noun", null, "I enjoy English.", "私は英語を楽しんでいます。"],
  ["Japanese", "日本語", "noun", null, "She speaks Japanese.", "彼女は日本語を話します。"],
  ["science", "理科", "noun", null, "Science is fun.", "理科は楽しいです。"],
  ["math", "数学", "noun", null, "Math is my favorite subject.", "数学は私の一番好きな教科です。"],
  ["history", "歴史", "noun", null, "We study history at school.", "私たちは学校で歴史を勉強します。"],
  ["art", "美術", "noun", null, "I like art class.", "私は美術の授業が好きです。"],
  ["lunch", "昼食", "noun", null, "We eat lunch at school.", "私たちは学校で昼食を食べます。"],
  ["breakfast", "朝食", "noun", null, "I eat breakfast at seven.", "私は7時に朝食を食べます。"],
  ["dinner", "夕食", "noun", null, "Dinner is ready.", "夕食の準備ができました。"],
  ["family", "家族", "noun", "families", "My family is happy.", "私の家族は幸せです。"],
  ["mother", "母", "noun", "mothers", "My mother cooks dinner.", "私の母は夕食を作ります。"],
  ["father", "父", "noun", "fathers", "My father works in a hospital.", "私の父は病院で働いています。"],
  ["brother", "兄弟", "noun", "brothers", "My brother likes soccer.", "私の兄弟はサッカーが好きです。"],
  ["sister", "姉妹", "noun", "sisters", "My sister reads books.", "私の姉妹は本を読みます。"],
  ["grandfather", "祖父", "noun", "grandfathers", "My grandfather is funny.", "私の祖父はおもしろいです。"],
  ["grandmother", "祖母", "noun", "grandmothers", "I visit my grandmother on Sunday.", "私は日曜日に祖母を訪ねます。"],
  ["people", "人々", "noun", "people", "Many people are in the park.", "たくさんの人々が公園にいます。"],
  ["boy", "男の子", "noun", "boys", "That boy is my friend.", "あの男の子は私の友達です。"],
  ["girl", "女の子", "noun", "girls", "The girl has a blue bag.", "その女の子は青いかばんを持っています。"],
  ["city", "都市", "noun", "cities", "Tokyo is a big city.", "東京は大きな都市です。"],
  ["country", "国", "noun", "countries", "Japan is a beautiful country.", "日本は美しい国です。"],
  ["park", "公園", "noun", "parks", "We play in the park.", "私たちは公園で遊びます。"],
  ["station", "駅", "noun", "stations", "The station is near here.", "駅はここの近くです。"],
  ["hospital", "病院", "noun", "hospitals", "The hospital is open today.", "病院は今日開いています。"],
  ["store", "店", "noun", "stores", "That store sells books.", "あの店は本を売っています。"],
  ["restaurant", "レストラン", "noun", "restaurants", "This restaurant is popular.", "このレストランは人気があります。"],
  ["house", "家", "noun", "houses", "Their house is near the school.", "彼らの家は学校の近くです。"],
  ["room", "部屋", "noun", "rooms", "My room is clean.", "私の部屋はきれいです。"],
  ["door", "ドア", "noun", "doors", "Please close the door.", "ドアを閉めてください。"],
  ["window", "窓", "noun", "windows", "Open the window, please.", "窓を開けてください。"],
  ["time", "時間", "noun", "times", "What time is it now?", "今何時ですか。"],
  ["day", "日", "noun", "days", "Today is a good day.", "今日は良い日です。"],
  ["week", "週", "noun", "weeks", "We have English twice a week.", "私たちは週2回英語があります。"],
  ["year", "年", "noun", "years", "This year is exciting.", "今年はわくわくします。"],
  ["today", "今日", "adverb", null, "I have soccer practice today.", "私は今日サッカーの練習があります。"],
  ["tomorrow", "明日", "adverb", null, "We will meet tomorrow.", "私たちは明日会います。"],
  ["yesterday", "昨日", "adverb", null, "I was busy yesterday.", "私は昨日忙しかったです。"],
  ["early", "早く", "adverb", null, "I get up early every day.", "私は毎日早く起きます。"],
  ["busy", "忙しい", "adjective", null, "My mother is busy today.", "私の母は今日忙しいです。"],
  ["kind", "親切な", "adjective", null, "He is kind to everyone.", "彼はみんなに親切です。"],
  ["new", "新しい", "adjective", null, "I have a new notebook.", "私は新しいノートを持っています。"],
  ["old", "古い", "adjective", null, "This is an old picture.", "これは古い写真です。"],
  ["big", "大きい", "adjective", null, "Our school is big.", "私たちの学校は大きいです。"],
  ["small", "小さい", "adjective", null, "The cat is small.", "その猫は小さいです。"],
  ["long", "長い", "adjective", null, "This river is long.", "この川は長いです。"],
  ["short", "短い", "adjective", null, "This pencil is short.", "このえんぴつは短いです。"],
  ["good", "良い", "adjective", null, "You did a good job.", "あなたは良くできました。"],
  ["bad", "悪い", "adjective", null, "The weather is bad today.", "今日の天気は悪いです。"],
  ["beautiful", "美しい", "adjective", null, "The flower is beautiful.", "その花は美しいです。"],
  ["clean", "きれいな", "adjective", null, "Keep your room clean.", "部屋をきれいに保ちましょう。"],
  ["like", "好き", "verb", ["likes", "liked", "liked", "liking"], "I like music.", "私は音楽が好きです。"],
  ["love", "大好き", "verb", ["loves", "loved", "loved", "loving"], "I love this song.", "私はこの歌が大好きです。"],
  ["want", "欲しい", "verb", ["wants", "wanted", "wanted", "wanting"], "I want a new bike.", "私は新しい自転車が欲しいです。"],
  ["need", "必要とする", "verb", ["needs", "needed", "needed", "needing"], "We need more time.", "私たちはもっと時間が必要です。"],
  ["know", "知っている", "verb", ["knows", "knew", "known", "knowing"], "I know that teacher.", "私はあの先生を知っています。"],
  ["use", "使う", "verb", ["uses", "used", "used", "using"], "We use this room for class.", "私たちはこの部屋を授業で使います。"],
  ["make", "作る", "verb", ["makes", "made", "made", "making"], "I make breakfast for my family.", "私は家族のために朝食を作ります。"],
  ["take", "取る", "verb", ["takes", "took", "taken", "taking"], "Take this book with you.", "この本を持っていってください。"],
  ["give", "与える", "verb", ["gives", "gave", "given", "giving"], "Please give me your answer.", "答えを私に渡してください。"],
  ["get", "得る", "verb", ["gets", "got", "got", "getting"], "I get a letter from my friend.", "私は友達から手紙を受け取ります。"],
  ["go", "行く", "verb", ["goes", "went", "gone", "going"], "We go to the park on Sunday.", "私たちは日曜日に公園へ行きます。"],
  ["come", "来る", "verb", ["comes", "came", "come", "coming"], "Come to my house after school.", "放課後私の家に来てください。"],
  ["live", "住む", "verb", ["lives", "lived", "lived", "living"], "I live in this city.", "私はこの都市に住んでいます。"],
  ["work", "働く", "verb", ["works", "worked", "worked", "working"], "My father works every day.", "私の父は毎日働いています。"],
  ["watch", "見る", "verb", ["watches", "watched", "watched", "watching"], "We watch a movie at home.", "私たちは家で映画を見ます。"],
  ["listen", "聞く", "verb", ["listens", "listened", "listened", "listening"], "Listen to the teacher.", "先生の話を聞きなさい。"],
  ["read", "読む", "verb", ["reads", "read", "read", "reading"], "I read a book after dinner.", "私は夕食の後に本を読みます。"],
  ["write", "書く", "verb", ["writes", "wrote", "written", "writing"], "Write your name here.", "ここに名前を書いてください。"],
  ["play", "遊ぶ", "verb", ["plays", "played", "played", "playing"], "We play tennis after school.", "私たちは放課後テニスをします。"],
  ["walk", "歩く", "verb", ["walks", "walked", "walked", "walking"], "I walk to school every day.", "私は毎日学校へ歩いて行きます。"],
  ["buy", "買う", "verb", ["buys", "bought", "bought", "buying"], "I buy a notebook at the store.", "私は店でノートを買います。"],
  ["open", "開ける", "verb", ["opens", "opened", "opened", "opening"], "Please open the window.", "窓を開けてください。"],
  ["close", "閉める", "verb", ["closes", "closed", "closed", "closing"], "Please close the door.", "ドアを閉めてください。"],
  ["teach", "教える", "verb", ["teaches", "taught", "taught", "teaching"], "Our teacher teaches English.", "私たちの先生は英語を教えます。"],
  ["learn", "学ぶ", "verb", ["learns", "learned", "learned", "learning"], "We learn English at school.", "私たちは学校で英語を学びます。"],
  ["understand", "理解する", "verb", ["understands", "understood", "understood", "understanding"], "I understand the question now.", "私は今その質問が理解できます。"],
  ["meet", "会う", "verb", ["meets", "met", "met", "meeting"], "We meet at the station.", "私たちは駅で会います。"],
  ["call", "電話する", "verb", ["calls", "called", "called", "calling"], "Please call me tonight.", "今夜私に電話してください。"],
];

const content = JSON.parse(await readFile(contentUrl, "utf8"));
const generatedIds = new Set(vocabulary.map(([lemma]) => `word_jhs1_${lemma.toLowerCase()}`));
content.words = content.words.filter((word) => !generatedIds.has(word.id));
content.questions = content.questions.filter((question) => !question.id.startsWith("question_jhs1_"));

function forms(value) {
  if (Array.isArray(value)) {
    const [thirdPersonSingular, past, pastParticiple, ing] = value;
    return { plural: null, thirdPersonSingular, past, pastParticiple, ing };
  }
  return { plural: value ?? null, thirdPersonSingular: null, past: null, pastParticiple: null, ing: null };
}

const addedWords = vocabulary.map(([lemma, meaning, partOfSpeech, inflection, exampleEn, exampleJa], index) => {
  const stage = 4 + Math.floor(index / 11);
  return {
    id: `word_jhs1_${lemma.toLowerCase()}`,
    lemma,
    displayForm: lemma,
    meaningsJa: [meaning],
    partOfSpeech,
    grade: "jhs1",
    stage,
    difficulty: stage <= 5 ? 2 : stage <= 8 ? 3 : 4,
    forms: forms(inflection),
    example: { en: exampleEn, ja: exampleJa },
    source: "original",
    license: "Original-Project-Content",
    isActive: true,
  };
});

content.words.push(...addedWords);

function alternatives(items, current, key, count = 3) {
  const result = [];
  for (let offset = 1; result.length < count && offset < items.length * 2; offset += 1) {
    const candidate = key(items[(current + offset * 13) % items.length]);
    if (!result.includes(candidate)) result.push(candidate);
  }
  return result;
}

for (const [index, word] of addedWords.entries()) {
  const meaning = word.meaningsJa[0];
  const meaningChoices = [meaning, ...alternatives(addedWords, index, (item) => item.meaningsJa[0])];
  const englishChoices = [word.lemma, ...alternatives(addedWords, index, (item) => item.lemma)];
  const base = `question_jhs1_${word.lemma.toLowerCase()}`;
  const initial = word.lemma[0].toUpperCase();

  content.questions.push(
    {
      id: `${base}_meaning`, contentType: "word", contentId: word.id, questionType: "en_to_ja_choice",
      prompt: `${word.lemma} の意味はどれ？`, choices: meaningChoices, correctAnswer: meaning,
      hint: `最初の文字は ${initial} です。`, explanation: `${word.lemma} は「${meaning}」という意味です。`, difficulty: word.difficulty,
    },
    {
      id: `${base}_production`, contentType: "word", contentId: word.id, questionType: "ja_to_en_choice",
      prompt: `「${meaning}」を英語で選ぼう。`, choices: englishChoices, correctAnswer: word.lemma,
      hint: `最初の文字は ${initial} です。`, explanation: `「${meaning}」は ${word.lemma} といいます。`, difficulty: word.difficulty,
    },
    {
      id: `${base}_spelling`, contentType: "word", contentId: word.id, questionType: "spelling",
      prompt: `「${meaning}」を英語で入力しよう。`, choices: [], correctAnswer: word.lemma,
      hint: `最初の文字は ${initial} です。`, explanation: `${word.lemma} のつづりを完成させよう。`, difficulty: Math.min(6, word.difficulty + 1),
    },
    {
      id: `${base}_listening`, contentType: "word", contentId: word.id, questionType: "listening_choice",
      audioText: word.lemma, prompt: `リスニング ${String(index + 1).padStart(2, "0")} — 聞こえた英単語の意味を選ぼう。`,
      choices: meaningChoices, correctAnswer: meaning,
      hint: `読み上げボタンでもう一度聞けます。`, explanation: `聞こえた単語は ${word.lemma}。「${meaning}」です。`, difficulty: word.difficulty,
    },
  );
}

content.contentVersion = "1.2.0";
await writeFile(contentUrl, `${JSON.stringify(content, null, 2)}\n`);
console.log(`Added ${addedWords.length} words and ${addedWords.length * 4} questions.`);
