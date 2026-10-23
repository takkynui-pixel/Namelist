-- สาขา VTA (สำนักงานที่ให้บริการ) 1 สาขา ดูแลได้หลายบริษัทลูกค้า
-- โครงสร้าง: service_branches (สาขา VTA) --< branches (สาขา x บริษัท ที่ดูแล) >-- clients
-- employees.branch_id ยังชี้ที่ branches เหมือนเดิม (= พนักงานของบริษัท X ภายใต้สาขา VTA Y)
create table if not exists service_branches (
  id uuid primary key default gen_random_uuid(),
  code text unique not null, name text not null, area text, active boolean not null default true);

alter table branches add column if not exists service_branch_id uuid references service_branches(id);
-- ย้ายข้อมูลเดิม: รวมสาขาที่รหัสซ้ำกันข้ามบริษัทให้เป็นสาขา VTA เดียว
-- ถ้ารหัสเดียวกันมีชื่อ/พื้นที่หลายแบบ ให้เลือกแบบที่พบบ่อยที่สุด (ชื่อและพื้นที่นับแยกกัน)
with nm as (select code, name, row_number() over (partition by code order by count(*) desc, name) rn from branches group by code, name),
     ar as (select code, area, row_number() over (partition by code order by count(*) desc, area) rn from branches where area is not null group by code, area)
insert into service_branches(code, name, area)
  select nm.code, nm.name, ar.area from nm left join ar on ar.code = nm.code and ar.rn = 1 where nm.rn = 1
  on conflict (code) do nothing;
update branches b set service_branch_id = s.id from service_branches s where s.code = b.code and b.service_branch_id is null;
update branches b set name = s.name from service_branches s where s.id = b.service_branch_id;
alter table branches alter column service_branch_id set not null;
create index if not exists branches_svc on branches(service_branch_id);
create unique index if not exists branches_client_svc on branches(client_id, service_branch_id);

-- code/name ของ branches ดึงจากสาขา VTA เสมอ (หน้าเว็บเดิมที่อ่าน branches.code/name ยังใช้ได้)
create or replace function private.branch_sync() returns trigger language plpgsql security definer set search_path=public as $$
declare s service_branches;
begin
  select * into s from service_branches where id = new.service_branch_id;
  new.code := s.code; new.name := s.name;
  if tg_op = 'INSERT' and new.area is null then new.area := s.area; end if;
  return new; end $$;
drop trigger if exists branch_sync on branches;
create trigger branch_sync before insert or update on branches for each row execute function private.branch_sync();

create or replace function private.service_sync() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.code is distinct from old.code or new.name is distinct from old.name then
    update branches set service_branch_id = service_branch_id where service_branch_id = new.id;  -- ให้ branch_sync ทำงาน
  end if; return new; end $$;
drop trigger if exists service_sync on service_branches;
create trigger service_sync after update on service_branches for each row execute function private.service_sync();

-- ===== สิทธิ์ผู้ใช้ผูกกับสาขา VTA (ครอบคลุมทุกบริษัทที่สาขานั้นดูแล รวมบริษัทที่เพิ่มภายหลัง) =====
create table if not exists user_service_branches (
  user_id uuid references profiles(id) on delete cascade,
  service_branch_id uuid references service_branches(id) on delete cascade,
  can_edit boolean default false, can_view_sensitive boolean default false,
  primary key (user_id, service_branch_id));
-- ย้ายสิทธิ์เดิม (รายบริษัท x สาขา) มาเป็นรายสาขา VTA : ผู้ใช้ที่เคยมีสิทธิ์ในบางบริษัทของสาขา จะได้สิทธิ์ทั้งสาขา ควรตรวจซ้ำหลังรัน
insert into user_service_branches(user_id, service_branch_id, can_edit, can_view_sensitive)
  select ub.user_id, b.service_branch_id, bool_or(coalesce(ub.can_edit,false)), bool_or(coalesce(ub.can_view_sensitive,false))
  from user_branches ub join branches b on b.id = ub.branch_id group by 1,2
  on conflict do nothing;

alter table service_branches enable row level security; alter table user_service_branches enable row level security;
drop policy if exists sb_sel on service_branches; drop policy if exists sb_adm on service_branches; drop policy if exists usb_self on user_service_branches; drop policy if exists usb_adm on user_service_branches;
create policy sb_sel on service_branches for select using (private.is_admin() or exists(select 1 from user_service_branches u join profiles p on p.id=u.user_id where u.service_branch_id=service_branches.id and u.user_id=auth.uid() and p.active));
create policy sb_adm on service_branches for all using (private.is_admin()) with check (private.is_admin());
create policy usb_self on user_service_branches for select using (user_id = auth.uid() or private.is_admin());
create policy usb_adm on user_service_branches for all using (private.is_admin()) with check (private.is_admin());

-- ===== ฟังก์ชันสิทธิ์ (เดิมอ่านจาก user_branches → ตอนนี้อ่านจาก user_service_branches) =====
create or replace function private.can_view(b uuid) returns boolean language sql stable security definer set search_path=public as
$$ select private.is_admin() or exists(select 1 from branches br join user_service_branches u on u.service_branch_id=br.service_branch_id join profiles p on p.id=u.user_id
   where br.id=b and u.user_id=auth.uid() and p.active) $$;
create or replace function private.can_edit(b uuid) returns boolean language sql stable security definer set search_path=public as
$$ select private.is_admin() or exists(select 1 from branches br join user_service_branches u on u.service_branch_id=br.service_branch_id join profiles p on p.id=u.user_id
   where br.id=b and u.user_id=auth.uid() and u.can_edit and p.active and p.role<>'viewer') $$;
create or replace function private.can_sensitive(b uuid) returns boolean language sql stable security definer set search_path=public as
$$ select private.is_admin() or exists(select 1 from branches br join user_service_branches u on u.service_branch_id=br.service_branch_id join profiles p on p.id=u.user_id
   where br.id=b and u.user_id=auth.uid() and u.can_view_sensitive and p.active) $$;
create or replace function private.can_view_client(c uuid) returns boolean language sql stable security definer set search_path=public as
$$ select private.is_admin() or exists(select 1 from branches br join user_service_branches u on u.service_branch_id=br.service_branch_id join profiles p on p.id=u.user_id
   where br.client_id=c and u.user_id=auth.uid() and p.active) $$;
create or replace function private.can_edit_client(c uuid) returns boolean language sql stable security definer set search_path=public as
$$ select private.is_admin() or exists(select 1 from branches br join user_service_branches u on u.service_branch_id=br.service_branch_id join profiles p on p.id=u.user_id
   where br.client_id=c and u.user_id=auth.uid() and u.can_edit and p.active and p.role<>'viewer') $$;

-- ===== Audit =====
drop trigger if exists log_perm_svc on user_service_branches;
create trigger log_perm_svc after insert or update or delete on user_service_branches for each row execute function private.log_perm();
create or replace function private.log_org_edit() returns trigger language plpgsql security definer set search_path=public as $$
declare r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_log(action,record_id,detail) values(
    case tg_op when 'INSERT' then 'add_' when 'UPDATE' then 'edit_' else 'remove_' end || tg_table_name, (r->>'id')::uuid,
    jsonb_build_object('name',r->>'name','code',r->>'code','client_id',r->>'client_id','service_branch_id',r->>'service_branch_id'));
  return coalesce(new, old); end $$;
drop trigger if exists log_branch_edit on branches;      -- branches ถูกแก้ผ่านสาขา VTA เท่านั้น ไม่ต้องบันทึกซ้ำรายแถว
drop trigger if exists log_branch_del on branches;  create trigger log_branch_del after delete on branches for each row execute function private.log_org_edit();
drop trigger if exists log_service_edit on service_branches; create trigger log_service_edit after insert or update on service_branches for each row execute function private.log_org_edit();
