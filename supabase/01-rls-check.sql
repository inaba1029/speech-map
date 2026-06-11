-- ============================================================
-- RLS 現状確認用クエリ（読み取り専用・変更なし）
-- Supabase ダッシュボード → SQL Editor に貼り付けて実行してください。
-- 出力を共有いただければ、各テーブルのポリシー詰めを次段で行います。
-- ============================================================

-- (1) 各テーブルで RLS が有効になっているか
--     rowsecurity = false のテーブルは「誰でも読み書きできる」状態です。
select n.nspname as schema,
       c.relname  as table,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;

-- (2) 現在定義されている RLS ポリシー一覧
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- (3) anon ロールに付与されているテーブル権限（SELECT/INSERT/UPDATE/DELETE）
--     anon に user_passwords の SELECT がある場合、全ハッシュが流出可能です。
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
order by table_name, privilege_type;

-- (4) authenticated ロールの権限
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'authenticated' and table_schema = 'public'
order by table_name, privilege_type;
