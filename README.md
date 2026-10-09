# くすりログ

さき専用の服薬記録Webアプリ。説明は `CLAUDE.md` を参照。

## 初回の公開手順

```sh
npx wrangler d1 create kusuri-log          # 表示された database_id を wrangler.toml に書く
npx wrangler d1 execute kusuri-log --remote --file=schema.sql
npx wrangler pages project create kusuri-log --production-branch main
npx wrangler pages secret put APP_PASSWORD --project-name kusuri-log   # パスワード
npx wrangler pages secret put SESSION_SECRET --project-name kusuri-log # 長いランダム文字列
npx wrangler pages deploy
```

パスワードと鍵は secret にだけ入れる(コード・コミットに書かない)。
公開後、iPhoneのSafariで開き「ホーム画面に追加」。

## ローカル確認

```sh
cp .dev.vars.example .dev.vars   # 中身を書き換える
npx wrangler d1 execute kusuri-log --local --file=schema.sql
npx wrangler pages dev
```

ログインなしで `/` はログイン画面、`/api/state` は 401 になることを確認する。
