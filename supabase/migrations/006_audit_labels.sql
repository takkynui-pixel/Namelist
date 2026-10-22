-- บันทึกประวัติเพิ่มเติมเพื่อให้หน้า "ประวัติการใช้งาน" อธิบายเป็นภาษาไทยได้ครบ
-- (เพิ่ม/แก้ไขบริษัท-สาขา เก็บรหัส/ชื่อ/บริษัทไว้ใน detail, เปลี่ยนบทบาท/เปิด-ปิดบัญชีผู้ใช้)
create or replace function private.log_org_edit() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into audit_log(action,record_id,detail) values(
    case tg_op when 'INSERT' then 'add_' else 'edit_' end || tg_table_name, new.id,
    jsonb_build_object('name',to_jsonb(new)->>'name','code',to_jsonb(new)->>'code','client_id',to_jsonb(new)->>'client_id'));
  return new; end $$;
drop trigger if exists log_client_add on clients; create trigger log_client_add after insert on clients for each row execute function private.log_org_edit();
drop trigger if exists log_branch_add on branches; create trigger log_branch_add after insert on branches for each row execute function private.log_org_edit();

create or replace function private.log_profile_change() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then return new; end if;   -- ข้ามการแก้ไขโดยระบบ (เช่น ตอนเชิญผู้ใช้ ซึ่งมีบันทึก invite_user อยู่แล้ว)
  if new.role is distinct from old.role then insert into audit_log(action,record_id,detail) values('change_role',new.id,jsonb_build_object('from',old.role,'to',new.role)); end if;
  if new.active is distinct from old.active then insert into audit_log(action,record_id,detail) values('change_active',new.id,jsonb_build_object('to',new.active)); end if;
  return new; end $$;
drop trigger if exists log_profile_change on profiles; create trigger log_profile_change after update on profiles for each row execute function private.log_profile_change();
