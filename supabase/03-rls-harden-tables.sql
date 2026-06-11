-- ============================================================
-- RLS締め直し：書き込み/削除が「誰でも(true)」だったテーブルを最低でも「ログイン必須」に。
-- 公開アノンキーは /api/config 経由で誰でも入手できるため、true のままだと
-- 未ログインの第三者が spots/settings 等を改ざん・全削除できてしまう。
--
-- SELECT(閲覧)ポリシーは地図・一覧表示に必要なので変更しない。
-- 適用後、末尾の検証クエリと「適用後に確認する動作」を必ずチェックすること。
-- ============================================================

-- ロール判定の補助関数（usersのRLSに左右されないよう security definer）
create or replace function public.is_app_authed() returns boolean
  language sql stable security definer set search_path = public as $$
    select exists(select 1 from public.users where auth_id = auth.uid());
$$;
create or replace function public.is_app_staff() returns boolean
  language sql stable security definer set search_path = public as $$
    select exists(select 1 from public.users
                  where auth_id = auth.uid() and role in ('admin','party_admin'));
$$;
create or replace function public.is_app_admin() returns boolean
  language sql stable security definer set search_path = public as $$
    select exists(select 1 from public.users
                  where auth_id = auth.uid() and role = 'admin');
$$;

-- ---- spots（演説場所）: 候補者は書き込まない → 管理者/政党管理者のみ。削除は管理者のみ ----
drop policy if exists spots_insert on public.spots;
create policy spots_insert on public.spots for insert to public with check (is_app_staff());
drop policy if exists spots_update on public.spots;
create policy spots_update on public.spots for update to public using (is_app_staff()) with check (is_app_staff());
drop policy if exists spots_delete on public.spots;
create policy spots_delete on public.spots for delete to public using (is_app_admin());

-- ---- settings: 候補者もテーマ保存で書き込む → ログイン必須。削除は管理者のみ ----
drop policy if exists settings_insert on public.settings;
create policy settings_insert on public.settings for insert to public with check (is_app_authed());
drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings for update to public using (is_app_authed()) with check (is_app_authed());
drop policy if exists settings_delete on public.settings;
create policy settings_delete on public.settings for delete to public using (is_app_admin());

-- ---- lottery_schedules: 全ログインユーザーの自動スケジューラが書く → ログイン必須 ----
drop policy if exists lottery_schedules_insert on public.lottery_schedules;
create policy lottery_schedules_insert on public.lottery_schedules for insert to public with check (is_app_authed());
drop policy if exists lottery_schedules_update on public.lottery_schedules;
create policy lottery_schedules_update on public.lottery_schedules for update to public using (is_app_authed()) with check (is_app_authed());
drop policy if exists lottery_schedules_delete on public.lottery_schedules;
create policy lottery_schedules_delete on public.lottery_schedules for delete to public using (is_app_authed());

-- ---- lottery_logs: 記録はログイン必須、全削除は管理者のみ ----
drop policy if exists allow_insert_lottery_logs on public.lottery_logs;
create policy allow_insert_lottery_logs on public.lottery_logs for insert to public with check (is_app_authed());
drop policy if exists allow_delete_lottery_logs on public.lottery_logs;
create policy allow_delete_lottery_logs on public.lottery_logs for delete to public using (is_app_admin());

-- ---- spot_reports: 通報はログイン必須、解決(update)は管理者/政党管理者のみ ----
drop policy if exists allow_insert_spot_reports on public.spot_reports;
create policy allow_insert_spot_reports on public.spot_reports for insert to public with check (is_app_authed());
drop policy if exists allow_update_spot_reports on public.spot_reports;
create policy allow_update_spot_reports on public.spot_reports for update to public using (is_app_staff()) with check (is_app_staff());

-- ============================================================
-- 検証：書き込み系ポリシーに true が残っていないか（0行が理想。login_attempts/audit_logsは別途）
select tablename, policyname, cmd, coalesce(qual,'') as using_cond, coalesce(with_check,'') as check_cond
from pg_policies
where schemaname='public' and cmd in ('INSERT','UPDATE','DELETE')
  and (coalesce(qual,'')='true' or coalesce(with_check,'')='true')
  and tablename not in ('login_attempts','audit_logs')
order by tablename, cmd;
-- ============================================================
-- ロールバック（元の「誰でも可」に戻す例。必要時のみ）:
--   drop policy if exists spots_insert on public.spots;
--   create policy spots_insert on public.spots for insert to public with check (true);
--   …（各ポリシー同様）
-- ============================================================
