-- ไฟล์แนบ: เอกสารพนักงาน (PDF) + เอกสารรายบริษัท + Storage แบบ private ตามสิทธิ์สาขา
-- ===== helper: สิทธิ์ระดับบริษัท (มีสิทธิ์อย่างน้อย 1 สาขาของบริษัทนั้น) =====
create or replace function private.can_view_client(c uuid) returns boolean language sql stable security definer set search_path=public as
$$ select private.is_admin() or exists(select 1 from user_branches ub join branches b on b.id=ub.branch_id join profiles p on p.id=ub.user_id
   where ub.user_id=auth.uid() and b.client_id=c and p.active) $$;
create or replace function private.can_edit_client(c uuid) returns boolean language sql stable security definer set search_path=public as
$$ select private.is_admin() or exists(select 1 from user_branches ub join branches b on b.id=ub.branch_id join profiles p on p.id=ub.user_id
   where ub.user_id=auth.uid() and b.client_id=c and ub.can_edit and p.active and p.role<>'viewer') $$;

-- ให้หน้าเว็บถามว่ามีสิทธิ์อะไรบ้าง (ใช้ซ่อน/แสดงปุ่ม; การบังคับจริงอยู่ที่ RLS)
create or replace function my_can_edit_branch(b uuid) returns boolean language sql stable security definer set search_path=public as $$ select private.can_edit(b) $$;
create or replace function my_can_sensitive(b uuid)  returns boolean language sql stable security definer set search_path=public as $$ select private.can_sensitive(b) $$;
create or replace function my_can_edit_client(c uuid) returns boolean language sql stable security definer set search_path=public as $$ select private.can_edit_client(c) $$;
revoke all on function my_can_edit_branch(uuid), my_can_sensitive(uuid), my_can_edit_client(uuid) from public;
grant execute on function my_can_edit_branch(uuid), my_can_sensitive(uuid), my_can_edit_client(uuid) to authenticated;

-- ===== ตารางเอกสาร =====
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('employee','client')),
  employee_id uuid references employees(id),
  client_id uuid references clients(id),
  category text not null, title text not null,
  file_path text not null unique, file_name text not null, mime text not null, size bigint not null check (size > 0 and size <= 20971520),
  sensitive boolean not null default false,
  uploaded_by uuid default auth.uid(), created_at timestamptz default now(),
  check ((scope='employee' and employee_id is not null and client_id is null and mime='application/pdf')
      or (scope='client'   and client_id   is not null and employee_id is null)));
create index if not exists documents_emp on documents(employee_id); create index if not exists documents_cli on documents(client_id);
alter table documents enable row level security;

drop policy if exists doc_sel on documents; drop policy if exists doc_ins on documents; drop policy if exists doc_upd on documents; drop policy if exists doc_del on documents;
create policy doc_sel on documents for select using (
  (scope='employee' and exists(select 1 from employees e where e.id=employee_id and private.can_view(e.branch_id) and (not sensitive or private.can_sensitive(e.branch_id))))
  or (scope='client' and private.can_view_client(client_id)));
create policy doc_ins on documents for insert with check (
  (scope='employee' and exists(select 1 from employees e where e.id=employee_id and private.can_edit(e.branch_id) and (not sensitive or private.can_sensitive(e.branch_id))))
  or (scope='client' and private.can_edit_client(client_id)));
create policy doc_upd on documents for update using (
  (scope='employee' and exists(select 1 from employees e where e.id=employee_id and private.can_edit(e.branch_id) and (not sensitive or private.can_sensitive(e.branch_id))))
  or (scope='client' and private.can_edit_client(client_id)))
  with check (
  (scope='employee' and exists(select 1 from employees e where e.id=employee_id and private.can_edit(e.branch_id) and (not sensitive or private.can_sensitive(e.branch_id))))
  or (scope='client' and private.can_edit_client(client_id)));
create policy doc_del on documents for delete using (
  (scope='employee' and exists(select 1 from employees e where e.id=employee_id and private.can_edit(e.branch_id) and (not sensitive or private.can_sensitive(e.branch_id))))
  or (scope='client' and private.can_edit_client(client_id)));

-- ===== Storage (private bucket) =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('namelist-files','namelist-files', false, 20971520, array['application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/png','image/jpeg'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists nl_obj_sel on storage.objects; drop policy if exists nl_obj_ins on storage.objects; drop policy if exists nl_obj_del on storage.objects;
-- ตรวจว่ามีแถวเอกสารชี้ไฟล์นี้หรือไม่ (ข้าม RLS) ใช้แยกไฟล์ที่ยังไม่มีแถวเอกสาร (เช่น อัปโหลดค้างระหว่างบันทึก)
create or replace function private.has_doc(p text) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from documents where file_path = p) $$;
-- อ่านไฟล์ได้เมื่อมองเห็นแถวเอกสารที่ชี้ไฟล์นั้น (ผ่าน RLS ของ documents)
-- หรือเป็นไฟล์ที่ตัวเองอัปโหลดและยังไม่มีแถวเอกสาร (ไว้ล้างไฟล์ค้างเมื่อบันทึกรายการไม่สำเร็จ)
create policy nl_obj_sel on storage.objects for select to authenticated
  using (bucket_id='namelist-files' and (
    exists(select 1 from public.documents d where d.file_path = objects.name)
    or (objects.owner_id = auth.uid()::text and not private.has_doc(objects.name))));
-- อัปโหลด/ลบ ได้เมื่อมีสิทธิ์แก้ไขของเจ้าของ path (employees/<id>/..., clients/<id>/...)
create policy nl_obj_ins on storage.objects for insert to authenticated with check (bucket_id='namelist-files' and (
  ((storage.foldername(objects.name))[1]='employees' and exists(select 1 from public.employees e where e.id::text=(storage.foldername(objects.name))[2] and private.can_edit(e.branch_id)))
  or ((storage.foldername(objects.name))[1]='clients' and exists(select 1 from public.clients c where c.id::text=(storage.foldername(objects.name))[2] and private.can_edit_client(c.id)))));
create policy nl_obj_del on storage.objects for delete to authenticated using (bucket_id='namelist-files' and (
  ((storage.foldername(objects.name))[1]='employees' and exists(select 1 from public.employees e where e.id::text=(storage.foldername(objects.name))[2] and private.can_edit(e.branch_id)))
  or ((storage.foldername(objects.name))[1]='clients' and exists(select 1 from public.clients c where c.id::text=(storage.foldername(objects.name))[2] and private.can_edit_client(c.id)))));

-- ===== Audit: บันทึกการเปิด/ดาวน์โหลดไฟล์ และการแก้ไขบริษัท/สาขา =====
drop policy if exists al_ins on audit_log;
create policy al_ins on audit_log for insert to authenticated
  with check (user_id = auth.uid() and action in ('open_file','download_file'));

create or replace function private.log_org_edit() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into audit_log(action,record_id,detail) values('edit_'||tg_table_name,new.id,jsonb_build_object('name',new.name)); return new; end $$;
drop trigger if exists log_client_edit on clients; create trigger log_client_edit after update on clients for each row execute function private.log_org_edit();
drop trigger if exists log_branch_edit on branches; create trigger log_branch_edit after update on branches for each row execute function private.log_org_edit();
