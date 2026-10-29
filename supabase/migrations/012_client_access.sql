-- 012: สิทธิ์ระดับ "บริษัท" (แยกจากสิทธิ์ระดับสาขา VTA)
-- เดิม: ผู้ใช้ได้สิทธิ์ผ่านสาขา VTA เท่านั้น (user_service_branches) = เห็นทุกบริษัทที่สาขานั้นดูแล
-- ใหม่: ให้สิทธิ์เฉพาะบางบริษัทได้ (user_clients) โดยไม่ต้องให้ทั้งสาขา
--       สิทธิ์ครอบคลุมพนักงานของบริษัทนั้นในทุกสาขา VTA ที่ดูแลบริษัทนี้ (รวมสาขาที่เพิ่มภายหลัง)
-- สิทธิ์จริง = รวมกัน (union) ของสิทธิ์รายสาขา VTA และสิทธิ์รายบริษัท ใครได้อย่างใดอย่างหนึ่งก็ผ่าน
-- เช่น ดูอย่างเดียวทั้งสาขา + แก้ไขได้เฉพาะบริษัท A => แก้ไขได้เฉพาะบริษัท A ที่เหลือดูอย่างเดียว

create table if not exists user_clients (
  user_id uuid not null references profiles(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  can_edit boolean not null default false,
  can_view_sensitive boolean not null default false,
  primary key (user_id, client_id));
create index if not exists user_clients_client on user_clients(client_id);

alter table user_clients enable row level security;
drop policy if exists uc_self on user_clients; drop policy if exists uc_adm on user_clients;
create policy uc_self on user_clients for select using (user_id = auth.uid() or private.is_admin());
create policy uc_adm on user_clients for all using (private.is_admin()) with check (private.is_admin());

-- ===== ฟังก์ชันสิทธิ์ระดับสาขา x บริษัท (branches.id) : รับสิทธิ์จากสาขา VTA หรือจากบริษัท =====
create or replace function private.can_view(b uuid) returns boolean language sql stable security definer set search_path=public as
$$ select private.is_admin() or exists(
     select 1 from branches br join profiles p on p.id = auth.uid() and p.active
     where br.id = b and (
       exists(select 1 from user_service_branches u where u.user_id = p.id and u.service_branch_id = br.service_branch_id)
       or exists(select 1 from user_clients c where c.user_id = p.id and c.client_id = br.client_id))) $$;

create or replace function private.can_edit(b uuid) returns boolean language sql stable security definer set search_path=public as
$$ select private.is_admin() or exists(
     select 1 from branches br join profiles p on p.id = auth.uid() and p.active and p.role <> 'viewer'
     where br.id = b and (
       exists(select 1 from user_service_branches u where u.user_id = p.id and u.service_branch_id = br.service_branch_id and u.can_edit)
       or exists(select 1 from user_clients c where c.user_id = p.id and c.client_id = br.client_id and c.can_edit))) $$;

create or replace function private.can_sensitive(b uuid) returns boolean language sql stable security definer set search_path=public as
$$ select private.is_admin() or exists(
     select 1 from branches br join profiles p on p.id = auth.uid() and p.active
     where br.id = b and (
       exists(select 1 from user_service_branches u where u.user_id = p.id and u.service_branch_id = br.service_branch_id and u.can_view_sensitive)
       or exists(select 1 from user_clients c where c.user_id = p.id and c.client_id = br.client_id and c.can_view_sensitive))) $$;

-- ===== ฟังก์ชันสิทธิ์ระดับบริษัท (clients.id) ใช้กับไฟล์แนบของบริษัท และหน้ารายการบริษัท =====
create or replace function private.can_view_client(c uuid) returns boolean language sql stable security definer set search_path=public as
$$ select private.is_admin() or exists(
     select 1 from profiles p where p.id = auth.uid() and p.active and (
       exists(select 1 from user_clients uc where uc.user_id = p.id and uc.client_id = c)
       or exists(select 1 from branches br join user_service_branches u on u.service_branch_id = br.service_branch_id
                 where br.client_id = c and u.user_id = p.id))) $$;

create or replace function private.can_edit_client(c uuid) returns boolean language sql stable security definer set search_path=public as
$$ select private.is_admin() or exists(
     select 1 from profiles p where p.id = auth.uid() and p.active and p.role <> 'viewer' and (
       exists(select 1 from user_clients uc where uc.user_id = p.id and uc.client_id = c and uc.can_edit)
       or exists(select 1 from branches br join user_service_branches u on u.service_branch_id = br.service_branch_id
                 where br.client_id = c and u.user_id = p.id and u.can_edit))) $$;

-- สาขา VTA ที่ผู้ใช้เห็นได้ = ได้สิทธิ์ทั้งสาขา หรือมีบริษัทที่ได้สิทธิ์อยู่ในสาขานั้น (ใช้กับตัวกรองสาขาในหน้าภาพรวม)
create or replace function private.can_view_service(s uuid) returns boolean language sql stable security definer set search_path=public as
$$ select private.is_admin() or exists(
     select 1 from profiles p where p.id = auth.uid() and p.active and (
       exists(select 1 from user_service_branches u where u.user_id = p.id and u.service_branch_id = s)
       or exists(select 1 from branches br join user_clients uc on uc.client_id = br.client_id
                 where br.service_branch_id = s and uc.user_id = p.id))) $$;

-- ===== RLS ของ clients / service_branches ให้รับรู้สิทธิ์รายบริษัท =====
drop policy if exists cl_sel on clients;
create policy cl_sel on clients for select using (private.can_view_client(id));
drop policy if exists sb_sel on service_branches;
create policy sb_sel on service_branches for select using (private.can_view_service(id));

-- ===== Audit: บันทึกการให้/แก้/ยกเลิกสิทธิ์รายบริษัท (action = client_perm_insert/update/delete) =====
create or replace function private.log_client_perm() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into audit_log(action, record_id, detail) values('client_perm_' || lower(tg_op),
    coalesce(new.user_id, old.user_id), to_jsonb(coalesce(new, old)));
  return coalesce(new, old); end $$;
drop trigger if exists log_client_perm on user_clients;
create trigger log_client_perm after insert or update or delete on user_clients for each row execute function private.log_client_perm();

-- =====================================================================================
-- (ไม่รันอัตโนมัติ) ตรวจสอบสิทธิ์ที่ถูก "ขยาย" จากการย้ายข้อมูลใน 007
-- 007 แปลงสิทธิ์เดิมรายบริษัท (user_branches) เป็นสิทธิ์ทั้งสาขา VTA : ผู้ใช้ที่เคยเห็นแค่บางบริษัทของสาขา จะเห็นทุกบริษัทของสาขานั้น
-- รันคำสั่งนี้ใน SQL editor เพื่อดูรายชื่อที่ควรทบทวน (ผู้ใช้ที่ไม่มีแถวใน user_branches เลย เช่น เพิ่มหลัง 007 จะไม่ถูกนับ)
--
-- select p.full_name, p.email, s.code, s.name as service_branch,
--        count(distinct b.client_id) as companies_now,
--        count(distinct b.client_id) filter (where exists(
--          select 1 from user_branches ub where ub.user_id = u.user_id and ub.branch_id = b.id)) as companies_before
-- from user_service_branches u
-- join profiles p on p.id = u.user_id and p.role <> 'admin'
-- join service_branches s on s.id = u.service_branch_id
-- join branches b on b.service_branch_id = s.id
-- where exists(select 1 from user_branches x where x.user_id = u.user_id)
-- group by p.full_name, p.email, s.code, s.name, u.user_id, u.service_branch_id
-- having count(distinct b.client_id) > count(distinct b.client_id) filter (where exists(
--          select 1 from user_branches ub where ub.user_id = u.user_id and ub.branch_id = b.id))
-- order by p.full_name, s.code;
--
-- ถ้าต้องการลดสิทธิ์ผู้ใช้คนหนึ่งให้เหลือเฉพาะบริษัทเดิม ทำที่หน้า Admin จะง่ายที่สุด:
-- เอาติ๊ก "เข้าถึง" ของสาขา VTA นั้นออก แล้วไปติ๊กรายบริษัทในส่วน "สิทธิ์รายบริษัท" แทน
-- =====================================================================================
