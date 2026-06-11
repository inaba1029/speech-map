# セキュリティレビューと対応（2026-06-11）

街頭活動予約アプリ speech-map のセキュリティレビュー結果と、本ブランチで実施した修正の記録。

## このブランチで対応済み

### 1. サーバーAPIの認証追加（重大）
ログイン時に張られる Supabase Auth のJWTを各APIで検証する共通ヘルパー
[`api/_auth.js`](api/_auth.js) を追加し、以下を保護した。ロール判定はクライアントを信用せず、
DB(`users`テーブル)を正とする。

- `api/reset-password.js` … **無認証で誰でも任意アカウントのパスワードを書き換え可能だった**。
  呼び出し元が `admin`、または対象と同一政党の `party_admin` の場合のみ許可。エラー詳細の漏えいも停止。
- `api/lottery.js` … 無認証で抽選起動＝落選予約の削除が可能だった。手動実行は `admin` 限定。
  自動実行は「DB上に存在し実行時刻を過ぎた正当なスケジュール」のときのみ許可。
  `target_date` を `YYYY-MM-DD` 固定、`schedule_id` を書式検証し、PostgRESTフィルタ注入を防止。
- `api/chat.js` … 無認証・無制限のAI代理（課金悪用）だった。ログイン済みユーザー限定＋メッセージ数上限を追加。
- クライアント側は `authHeader()` を追加し、3つのAPI呼び出しに `Authorization: Bearer <token>` を付与。

### 2. パスワードハッシュのブラウザ配信を停止（重大）
`renderLoginAccountTable()` がログイン画面で `user_passwords.pw`（全ハッシュ）を取得していたのを削除。
表示には不要だった。**ただし根本対策はRLS**（下記「残作業」）。

### 3. XSS対策
HTMLエスケープ関数 `escapeHtml()` / 属性内JS文字列用 `jsAttr()` を追加し、
ユーザー入力（氏名・政党名・場所名・選挙区）を `innerHTML` に差し込む約40箇所をエスケープ。
`partyBadge()` と `resetPassword()` の `onclick` 注入も修正。
（`showToast`/`showConfirmAsync` は `textContent` のため元から安全）

## 残作業（要対応・別途）

### A. RLS（行レベルセキュリティ）— 最重要
APIを固めても、ブラウザは anon キーで直接DBを操作できる。RLSが緩いと無意味。
- まず [`supabase/01-rls-check.sql`](supabase/01-rls-check.sql) をSQL Editorで実行し現状を共有。
- 緊急対応として [`supabase/02-rls-harden-user_passwords.sql`](supabase/02-rls-harden-user_passwords.sql)
  でハッシュ漏えいを停止（本人＋管理者のみアクセス可）。
- `users` / `reservations` / `spots` / `lottery_*` / `reports` / `settings` 等の書き込みポリシーは
  スキーマ確認後に整備する（候補者が他人のデータを改ざんできないように）。

### B. 設計上の根本課題
- **`user_passwords` は Supabase Auth と重複する自前の資格情報ストア**で、検証もブラウザ側。
  将来的には廃止し Supabase Auth に一本化するのが望ましい。
- **ログイン試行ロック（`login_attempts`）がクライアント任せ**で、攻撃者は自分のカウントを
  リセット（ロック回避）でき、他人をロック（DoS）もできる。ログイン処理をサーバーAPI化して
  そこでロックを判定するのが正攻法。
- **アカウント列挙**：ログイン画面が全ユーザーのID/名前を公開している。公開要件を再検討。
- `/api/chat` のレート制限（ユーザー単位）も追加余地あり。

### C. その他
- `api/config.js` で Supabase URL/キーを返すのは anon キー＋厳格なRLS前提なら許容。Aの完了が条件。
