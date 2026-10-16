-- หน้า Admin: เก็บอีเมลใน profiles + กันแก้ไขตัวเองผิดพลาด
alter table profiles add column if not exists email text;
update profiles p set email=u.email from auth.users u where u.id=p.id and p.email is null;
create or replace function private.new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into profiles(id,full_name,email) values(new.id,new.raw_user_meta_data->>'full_name',new.email); return new; end $$;

-- ห้ามปิด/ลดสิทธิ์ Admin คนสุดท้าย
create or replace function private.keep_admin() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.role='admin' and old.active and (new.role<>'admin' or not new.active)
     and (select count(*) from profiles where role='admin' and active and id<>old.id)=0
  then raise exception 'ต้องมี Admin ที่ใช้งานอยู่อย่างน้อย 1 คน'; end if;
  return new; end $$;
drop trigger if exists keep_admin on profiles;
create trigger keep_admin before update on profiles for each row execute function private.keep_admin();

-- บันทึกการเปลี่ยนสิทธิ์ลง audit_log
create or replace function private.log_perm() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into audit_log(action,record_id,detail) values('perm_'||lower(tg_op),
    coalesce(new.user_id,old.user_id), to_jsonb(coalesce(new,old)));
  return coalesce(new,old); end $$;
drop trigger if exists log_perm on user_branches;
create trigger log_perm after insert or update or delete on user_branches for each row execute function private.log_perm();
