# くすりログ

自分専用の服薬記録Webアプリ。記録はiPhoneの中だけに保存され、どこにも送られない。設計の説明は `CLAUDE.md`。

## iPhoneに入れる

`docs/` の中身は静的ファイルだけ(記録は含まない)。HTTPSで開ける場所に置き、iPhoneのSafariで開いて「ホーム画面に追加」する。
GitHub Pagesを使う場合: リポジトリの Settings → Pages → Branch を `main` / `/docs` にする。

- ページを開いても、中身は空のアプリが出るだけ。記録は各端末のブラウザの中にしかない。
- 記録を守る手段は「ホーム画面に追加して使う」+「ときどき書き出す」(薬の設定 → バックアップ)。
- 機種変更・Safariのデータ消去・アプリの削除で記録は消える。書き出したJSONで戻せる。

## ローカル確認

```sh
cd docs && python3 -m http.server 8790   # http://localhost:8790/
```
