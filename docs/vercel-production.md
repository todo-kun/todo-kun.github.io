# Vercel Production Launch

## 目的

「トドくん」の本体アプリを Vercel に公開し、Google カレンダー / Google To Do 連携を本番URLで使えるようにするための手順です。

## 先に知っておきたいこと

- GitHub リポジトリ: `todo-kun/todo-kun.github.io`
- 本体アプリは Next.js の API を使うため、GitHub Pages ではなく Vercel に公開します
- 現在の MVP は `data/tasks.json` に保存しています
- 本番で長く使うなら、保存先は Postgres や Supabase などへ切り替える前提がおすすめです

## Vercel での作成手順

1. Vercel にログインする
2. `Add New...` から `Project` を選ぶ
3. GitHub を連携し、`todo-kun/todo-kun.github.io` を選ぶ
4. Framework は `Next.js` のままで進める
5. Root Directory はリポジトリ直下のままにする
6. Build / Output の設定は自動判定のままでよい

## Vercel に入れる環境変数

Production と Preview の両方に、少なくとも次を入れます。

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_CALENDAR_ID`
- `GOOGLE_TASKS_LIST_ID`
- `APP_URL`
- `APP_SECRET`

## 値の入れ方

- `GOOGLE_CLIENT_ID`: Google Cloud の OAuth Client ID
- `GOOGLE_CLIENT_SECRET`: Google Cloud の OAuth Client Secret
- `GOOGLE_REDIRECT_URI`: `https://<your-vercel-domain>/api/google/callback`
- `GOOGLE_CALENDAR_ID`: 通常は `primary`
- `GOOGLE_TASKS_LIST_ID`: 通常は `@default`
- `APP_URL`: `https://<your-vercel-domain>`
- `APP_SECRET`: 長めのランダム文字列

## 公開後に Google 側で合わせる項目

Google Cloud の OAuth 設定で、承認済みのリダイレクト URI に次を追加します。

- `https://<your-vercel-domain>/api/google/callback`

プレビュー用ブランチでも Google 連携確認をしたい場合は、Preview 用に別 OAuth クライアントを分けるほうが安全です。

## 公開後の確認

1. Vercel の本番 URL を開く
2. 設定画面で保存済み値が正しいか確認する
3. セットアップチェックがすべて完了になるか確認する
4. Google 接続を実行する
5. タスクを 1 件作る
6. Google カレンダーと Google To Do に反映されるか確認する
7. バックアップ書き出し / 読み込みも確認する

## いまの構成での注意

- Vercel は GitHub 連携により、`main` への push ごとに本番更新されます
- それ以外のブランチは Preview URL が自動で作られます
- 環境変数の変更は過去のデプロイには反映されないため、値を更新したら再デプロイします
- ストレージは Vercel Marketplace から Postgres / Supabase / Upstash などを追加すると本番向きに育てやすいです
