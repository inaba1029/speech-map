-- ============================================================
-- 【緊急】user_passwords テーブルの締め直し
--   現状、anon/他ユーザーが全パスワードハッシュを SELECT できる疑いが濃厚です。
--   このSQLで「自分の行のみ」アクセス可、管理者のみ全行アクセス可に制限します。
--
--   ⚠ 本番に適用する前に、必ず以下の動作を確認してください:
--      - 候補者/管理者の通常ログイン
--      - 自分のパスワード変更（changePassword）
--      - 管理者による他ユーザーのPWリセット（confirmPwReset）
--   問題があれば末尾の「ロールバック」を実行して元に戻せます。
-- ============================================================

-- 呼び出し元(JWTのauth.uid())→ usersテーブル から、アプリ上のロール/ID/政党を引く補助関数
create or replace function public.app_user_id() returns text
  language sql stable security definer set search_path = public as $$
    select id from public.users where auth_id = auth.uid() limit 1;
$$;
create or replace function public.app_role() returns text
  language sql stable security definer set search_path = public as $$
    select role from public.users where auth_id = auth.uid() limit 1;
$$;
create or replace function public.app_party() returns text
  language sql stable security definer set search_path = public as $$
    select party from public.users where auth_id = auth.uid() limit 1;
$$;

-- RLS を有効化
alter table public.user_passwords enable row level security;

-- 既存の緩いポリシーがあれば掃除（名前は環境により異なるため確認のうえ）
-- 例: drop policy if exists "Enable read access for all users" on public.user_passwords;

-- 本人は自分の行のみ参照/更新できる
drop policy if exists up_select_own on public.user_passwords;
create policy up_select_own on public.user_passwords
  for select using (
    user_id = public.app_user_id()
    or public.app_role() = 'admin'
    or (public.app_role() = 'party_admin'
        and exists (select 1 from public.users u
                    where u.id = user_passwords.user_id
                      and u.party = public.app_party()))
  );

drop policy if exists up_upsert_own on public.user_passwords;
create policy up_upsert_own on public.user_passwords
  for insert with check (
    user_id = public.app_user_id() or public.app_role() = 'admin'
  );
drop policy if exists up_update_own on public.user_passwords;
create policy up_update_own on public.user_passwords
  for update using (
    user_id = public.app_user_id() or public.app_role() = 'admin'
  );

-- anon からの直接権限を剥奪（service_role はRLSをバイパスするのでサーバーAPIは影響なし）
revoke all on public.user_passwords from anon;

-- ============================================================
-- ロールバック（元に戻す場合）:
--   alter table public.user_passwords disable row level security;
--   drop policy if exists up_select_own on public.user_passwords;
--   drop policy if exists up_upsert_own on public.user_passwords;
--   drop policy if exists up_update_own on public.user_passwords;
-- ============================================================
