-- VTA Namelist: schema + RLS + PII protection. Run in Supabase SQL editor.
create extension if not exists pgcrypto;
create schema if not exists private;

create type app_role as enum ('admin','multi_branch_manager','branch_officer','viewer');
create type emp_status as enum ('pending','active','on_leave','resigned','blacklisted');

create table clients (            -- บริษัทลูกค้า (ชีต SUM VTA)
  id uuid primary key default gen_random_uuid(),
  code text unique not null, name text not null, tax_id text,
  pay_cycle text, pay_date text, address text, active boolean default true);

create table branches (           -- สาขา/พื้นที่
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  code text not null, name text not null, area text, active boolean default true,
  unique (client_id, code));

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text, role app_role not null default 'viewer', active boolean default true);

create table user_branches (       -- สิทธิ์รายบุคคลต่อสาขา
  user_id uuid references profiles(id) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,
  can_edit boolean default false,
  can_view_sensitive boolean default false,
  primary key (user_id, branch_id));

create table employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text unique not null,
  branch_id uuid not null references branches(id),
  title_th text, first_name_th text not null, last_name_th text,
  first_name_en text, last_name_en text, nickname text, gender text,
  birth_date date, phone text, email text,
  hire_date date, position text, section text, cost_center text,
  current_address text, registered_address text,
  emergency_name text, emergency_relation text, emergency_phone text,
  status emp_status not null default 'active',
  national_id_last4 text, bank_last4 text,
  created_by uuid default auth.uid(),
  created_at timestamptz default now(), updated_at timestamptz default now());
create index on employees(branch_id); create index on employees(status);

create table employee_sensitive ( -- เข้าถึงผ่าน RPC เท่านั้น
  employee_id uuid primary key references employees(id) on delete cascade,
  national_id_enc bytea, bank_name text, bank_account_enc bytea);

create table employment_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  branch_id uuid references branches(id),
  event_type text not null, effective_date date default current_date,
  reason text, created_by uuid default auth.uid(), created_at timestamptz default now());

create table audit_log (
  id bigserial primary key, user_id uuid default auth.uid(),
  action text not null, record_id uuid, detail jsonb, at timestamptz default now());

-- ===== permission helpers =====
create function private.is_admin() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and role='admin' and active) $$;
create function private.can_view(b uuid) returns boolean language sql stable security definer set search_path=public as
$$ select private.is_admin() or exists(select 1 from user_branches ub join profiles p on p.id=ub.user_id
   where ub.user_id=auth.uid() and ub.branch_id=b and p.active) $$;
create function private.can_edit(b uuid) returns boolean language sql stable security definer set search_path=public as
$$ select private.is_admin() or exists(select 1 from user_branches ub join profiles p on p.id=ub.user_id
   where ub.user_id=auth.uid() and ub.branch_id=b and ub.can_edit and p.active and p.role<>'viewer') $$;
create function private.can_sensitive(b uuid) returns boolean language sql stable security definer set search_path=public as
$$ select private.is_admin() or exists(select 1 from user_branches ub join profiles p on p.id=ub.user_id
   where ub.user_id=auth.uid() and ub.branch_id=b and ub.can_view_sensitive and p.active) $$;
grant usage on schema private to authenticated;

-- ===== RLS =====
alter table clients enable row level security; alter table branches enable row level security;
alter table profiles enable row level security; alter table user_branches enable row level security;
alter table employees enable row level security; alter table employee_sensitive enable row level security;
alter table employment_history enable row level security; alter table audit_log enable row level security;

create policy br_sel on branches for select using (private.can_view(id));
create policy cl_sel on clients for select using (private.is_admin() or exists(select 1 from branches b where b.client_id=clients.id and private.can_view(b.id)));
create policy cl_adm on clients for all using (private.is_admin()) with check (private.is_admin());
create policy br_adm on branches for all using (private.is_admin()) with check (private.is_admin());
create policy pr_self on profiles for select using (id=auth.uid() or private.is_admin());
create policy pr_adm on profiles for all using (private.is_admin()) with check (private.is_admin());
create policy ub_self on user_branches for select using (user_id=auth.uid() or private.is_admin());
create policy ub_adm on user_branches for all using (private.is_admin()) with check (private.is_admin());
create policy em_sel on employees for select using (private.can_view(branch_id));
create policy em_ins on employees for insert with check (private.can_edit(branch_id));
create policy em_upd on employees for update using (private.can_edit(branch_id)) with check (private.can_edit(branch_id));
-- ไม่มี delete policy: ลบไม่ได้ ใช้สถานะ resigned แทน
create policy hi_sel on employment_history for select using (exists(select 1 from employees e where e.id=employee_id and private.can_view(e.branch_id)));
create policy al_sel on audit_log for select using (private.is_admin());
-- employee_sensitive: ไม่มี policy = ปฏิเสธทุกคน ต้องผ่าน RPC

-- ===== history + updated_at trigger =====
create function private.emp_trg() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into employment_history(employee_id,branch_id,event_type,effective_date)
      values(new.id,new.branch_id,'hire',coalesce(new.hire_date,current_date));
  else
    new.updated_at=now();
    if new.branch_id<>old.branch_id then
      insert into employment_history(employee_id,branch_id,event_type) values(new.id,new.branch_id,'transfer'); end if;
    if new.status<>old.status then
      insert into employment_history(employee_id,branch_id,event_type,reason)
        values(new.id,new.branch_id,case when new.status='resigned' then 'resign' else 'status_change' end,
               old.status::text||' -> '||new.status::text); end if;
  end if; return new; end $$;
create trigger emp_ins after insert on employees for each row execute function private.emp_trg();
create trigger emp_upd before update on employees for each row execute function private.emp_trg();

-- ===== PII: ตรวจเลขบัตร + เข้ารหัส + audit =====
-- ก่อนใช้: select vault.create_secret('<random-32+chars>','pii_key');
create function private.pii_key() returns text language sql security definer as
$$ select decrypted_secret from vault.decrypted_secrets where name='pii_key' $$;

create function private.valid_thai_id(n text) returns boolean language plpgsql immutable as $$
declare s int:=0; i int;
begin
  if n !~ '^[0-9]{13}$' then return false; end if;
  for i in 1..12 loop s:=s+substr(n,i,1)::int*(14-i); end loop;
  return (11-(s%11))%10 = substr(n,13,1)::int; end $$;

create function set_sensitive(p_emp uuid, p_nid text, p_bank_name text, p_bank_acct text)
returns void language plpgsql security definer set search_path=public,extensions as $$
declare b uuid; k text:=private.pii_key();
begin
  select branch_id into b from employees where id=p_emp;
  if not private.can_edit(b) or not private.can_sensitive(b) then raise exception 'ไม่มีสิทธิ์'; end if;
  if p_nid is not null and p_nid<>'' and not private.valid_thai_id(p_nid) then raise exception 'เลขบัตรประชาชนไม่ถูกต้อง'; end if;
  insert into employee_sensitive(employee_id,national_id_enc,bank_name,bank_account_enc)
    values(p_emp, case when p_nid<>'' then pgp_sym_encrypt(p_nid,k) end, nullif(p_bank_name,''),
           case when p_bank_acct<>'' then pgp_sym_encrypt(p_bank_acct,k) end)
  on conflict(employee_id) do update set
    national_id_enc=coalesce(excluded.national_id_enc,employee_sensitive.national_id_enc),
    bank_name=coalesce(excluded.bank_name,employee_sensitive.bank_name),
    bank_account_enc=coalesce(excluded.bank_account_enc,employee_sensitive.bank_account_enc);
  update employees set national_id_last4=coalesce(nullif(right(p_nid,4),''),national_id_last4),
                       bank_last4=coalesce(nullif(right(p_bank_acct,4),''),bank_last4) where id=p_emp;
  insert into audit_log(action,record_id,detail) values('set_sensitive',p_emp,'{}');
end $$;

create function reveal_sensitive(p_emp uuid) returns table(national_id text, bank_name text, bank_account text)
language plpgsql security definer set search_path=public,extensions as $$
declare b uuid; k text:=private.pii_key();
begin
  select branch_id into b from employees where id=p_emp;
  if not private.can_sensitive(b) then raise exception 'ไม่มีสิทธิ์ดูข้อมูลเต็ม'; end if;
  insert into audit_log(action,record_id) values('reveal_sensitive',p_emp);
  return query select pgp_sym_decrypt(s.national_id_enc,k), s.bank_name, pgp_sym_decrypt(s.bank_account_enc,k)
    from employee_sensitive s where s.employee_id=p_emp; end $$;
revoke all on function set_sensitive(uuid,text,text,text), reveal_sensitive(uuid) from public;
grant execute on function set_sensitive(uuid,text,text,text), reveal_sensitive(uuid) to authenticated;

-- ผู้ใช้ใหม่ -> profile role=viewer (ไม่มีสาขา = มองไม่เห็นอะไร จนกว่า Admin กำหนดสิทธิ์)
create function private.new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into profiles(id,full_name) values(new.id,new.raw_user_meta_data->>'full_name'); return new; end $$;
create trigger on_signup after insert on auth.users for each row execute function private.new_user();
