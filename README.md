# WORD QUEST

中学1年生を中心に、英語が苦手な生徒がゲーム感覚で学べる1人用の英語学習PWAです。正式公開先はGitHubリポジトリ`word-quest-jhs1`のGitHub Pagesです。Web版を先に運用し、将来は同じコードをCapacitorでAndroid／iOSへ展開できる構成です。

## 現在の実装

- 今日のクエスト4カテゴリ
  - 📘 単語
  - 🏛️ 文法
  - 🎧 リスニング
  - 🌈 全部ミックス
- 3分／5分／10分／15分を選択し、約8／12／20／30問を出題
- タイムアタック、苦手ダンジョン、カテゴリ別ステージ、10問のミニボス戦
- 問題ごとに入れ替わる6種類の敵キャラクターと、ボス戦専用の後半形態
- 得点、コンボ、ハイスコア、習熟度、履歴、保護者PIN、JSONバックアップ
- Web Audioで生成するBGM／効果音と、端末のSpeech Synthesisによる英語音声
- IndexedDBを優先し、失敗時は`localStorage`へ切り替える端末内保存
- PWA manifest、Service Worker、オフラインキャッシュ

学習記録はGitHub Pagesや外部サーバーへ送信しません。別端末・別ブラウザ・別URLへは自動移行しないため、必要に応じて設定画面からJSONバックアップを保存してください。

## 学習コンテンツ

`public/data/content.json`の版は`1.3.0`です。

- 単語114語（小学校復習12語、中学1年102語）
- 熟語・定型表現12件
- 文法単元10件
- 明示問題438問
  - 英語→日本語4択: 100問
  - 日本語→英語4択: 100問
  - スペル入力: 98問
  - 空欄補充: 10問
  - 語順並べ替え: 10問
  - 会話選択: 6問
  - リスニング4択: 114問

中学1年の追加90語は、意味、日本語→英語、スペル入力、リスニングの4形式ずつを持ちます。日本語→英語とスペル入力は例文の場面を表示します。特に`see`、`look`、`watch`は3語を同じ選択肢に出し、「自然に目に入る」「目を向ける」「テレビ・動画などを続けて見る」の違いをヒントで学べます。「全部ミックス」はリスニングを約25%含め、残りを単語・熟語・文法から構成します。単語・文法・リスニングを個別選択した場合は、選んだカテゴリ以外を混ぜません。

## セットアップ

必要環境はNode.js 22以上とnpmです。

```bash
cd word-quest
npm install
npm run dev
```

開発サーバーは通常`http://localhost:5173`です。同じWi-Fi上のスマホからは`http://<MacのIPアドレス>:5173`へ接続できますが、PWAの最終確認はGitHub PagesのHTTPS URLで行います。

## コマンド

| コマンド | 用途 |
|---|---|
| `npm run dev` | 開発サーバーを起動 |
| `npm run build` | ルート配信用に`dist/`へビルド |
| `npm run build:pages` | `/word-quest-jhs1/`向けにGitHub Pages用ビルド |
| `npm run preview` | `dist/`を4173番ポートで確認 |
| `npm run content:expand:jhs1` | 中1単語102語と4形式の教材データを再生成 |
| `npm test` | データ、カテゴリ、音声、ゲーム規則、保存層をテスト |
| `npm run test:e2e` | 起動中のpreviewへ接続してChrome E2Eを実行 |
| `npm run check` | テスト後に通常ビルド |
| `npm run cap:add:android` | Androidプロジェクトを初回作成 |
| `npm run cap:sync` | Webビルド後にCapacitorへ同期 |
| `npm run android:open` | Android Studioで開く |

現在、`npm test`は22件すべて成功しています。Pages用ビルドと公開URLのHTTP 200を確認し、公開URLに対する390×844のChrome E2Eで、今日の4カテゴリ、全部ミックス、英単語ステージ12問、保存、バックアップ、Service Worker、強制オフライン再読込を確認しています。

## GitHub Pages公開

公開URLは [https://ssshasimotosss-droid.github.io/word-quest-jhs1/](https://ssshasimotosss-droid.github.io/word-quest-jhs1/) です。`main`にはソース、`gh-pages`には検証後の`dist/`のみを置き、GitHub Pagesは`gh-pages`ブランチのルートから配信します。この方式はActions用の追加トークン権限を必要としません。

更新時は`npm test`と`npm run build:pages`を成功させ、生成された`dist/`のみを`gh-pages`へ公開します。`vite.config.js`は`VITE_BASE_PATH=/word-quest-jhs1/`を受け取り、アプリ本体、コンテンツ、manifest、Service Workerを同じリポジトリ配下へ揃えます。

旧Netlify公開は過去の配信記録であり、正式公開先ではありません。現行の`package.json`にNetlify CLIやNetlify deployスクリプトはありません。旧Netlify URLとGitHub Pages URLは別オリジンなので、旧URLの学習記録が必要な場合は旧URLでバックアップし、GitHub Pages側で復元します。

## 音声について

114問のリスニング問題は`audioText`を端末のSpeech Synthesisへ渡します。ほかの問題でも「発音を聞く」から、単語または完成した英文を再生できます。音声ファイルを同梱する方式ではないため、利用できる声と発音品質はOS・ブラウザ・端末に依存します。

自動テストで確認できるのは、正しい英文を渡すこと、言語を`en-US`にすること、英語音声を選ぶことまでです。次は実機で耳で確認する必要があります。

Android Chromeでは、読み上げをボタンを押した直後に開始する実装です。音声が出ない場合は、端末の`Speech Services by Google`と英語音声を更新・有効化してから、設定画面の「発音をテスト」を押してください。

- BGM、効果音、読み上げが実際に聞こえるか
- 本体音量、消音モード、ブラウザの自動再生制限の影響
- 英語音声の有無、発音の自然さ、音量バランス
- Android Chrome／iPhone Safariでの再生と再読み上げ

## 端末内保存とPWA

保存対象はニックネーム、設定、セッション、回答、習熟度、日別集計です。IndexedDB、`localStorage`、メモリの順にフォールバックします。サイトデータを削除すると記録を失う可能性があります。

Service Workerはアプリ本体、438問のコンテンツ、背景、アイコンをキャッシュします。実スマホへのインストール、ホーム画面起動、通知許可、音の実聴は端末ごとの確認が必要です。

詳しい構成は[技術設計](docs/TECHNICAL_DESIGN.md)を参照してください。
