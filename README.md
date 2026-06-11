# トドくん

ブラウザ完結で使える、Google カレンダーと Google To Do 連携つきのタスク管理アプリです。

パソコンでもスマホでも使え、登録したタスクを Google カレンダーと Google Tasks に連携できます。

## 現在できること

- ブラウザだけで使える操作画面
- スマホでも扱いやすいレスポンシブ画面
- Google OAuth の接続と解除
- ブラウザ上での連携設定入力
- Google 接続前の不足項目チェック
- タスク登録時の Google カレンダー / Google To Do 自動連携
- タスク編集、完了切替、削除、手動再連携
- 状態サマリーと未連携タスクの一括再実行
- バックアップの書き出し / 読み込み
- GitHub Actions による lint / build 確認
- ホーム画面追加しやすい PWA マニフェスト

## 技術構成

- Next.js 16
- TypeScript
- App Router
- Google APIs via `googleapis`
- File-based storage for the current MVP

## セットアップ

1. Install dependencies with `npm install`
2. Copy `.env.example` to `.env.local`
3. In Google Cloud, enable:
   - Google Calendar API
   - Google Tasks API
4. Create an OAuth client and set:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI`
5. Set app values:
   - `APP_URL`
   - `APP_SECRET`
6. Start the app with `npm run dev`

## 保存方式について

- 現在のタスク保存先は `data/tasks.json` です
- Google OAuth トークンは暗号化した HTTP-only Cookie に保存しています
- 本番公開では、タスク保存先をデータベースへ移すことを強くおすすめします
- 特に Vercel 本番運用では、ローカルファイル保存のまま長期利用しない前提で考えるのが安全です

## 本番公開のおすすめ

- GitHub はコード管理に使う
- 本番公開先は Vercel を使う
- タスク保存先は Postgres や Supabase などへ移す
- Google OAuth の本番用 Redirect URI を公開URLに合わせる

## GitHub 運用

- Keep `main` deployable
- Create a branch per feature
- Review with pull requests
- Let CI verify lint and build before merge

## デプロイ

- Recommended target: Vercel
- Deployment checklist: [docs/deployment.md](docs/deployment.md)
- GitHub publish helper: [docs/github-publish.md](docs/github-publish.md)
