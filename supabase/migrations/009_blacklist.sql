-- Blacklist: รายชื่อบุคคลแยกจากทะเบียนพนักงาน (รับข้อมูลไม่ครบได้: ไม่มีรหัส/ไม่มีเลขบัตร)
-- สิทธิ์: จัดการ/ดูรายการทั้งหมด = Admin | ตรวจสอบ (ผ่านฟังก์ชัน ได้เฉพาะผลที่ตรงกัน) = Admin, ผู้จัดการหลายสาขา, เจ้าหน้าที่สาขา
-- เลขบัตรเข้ารหัสเหมือนข้อมูลพนักงาน และเก็บค่าแฮชไว้ใช้จับคู่โดยไม่ต้องถอดรหัส

create or replace function private.norm_name(t text) returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(regexp_replace(lower(coalesce(t,'')), '^\s*(นางสาว|น\.ส\.|นส\.|mr\.|mrs\.|miss\.?|ms\.)\s*', ''),
                          '^\s*(นาย|นาง|mr|mrs|miss|ms)\s+', ''),
           '[\s\.\-]+', '', 'g') $$;
create or replace function private.norm_code(t text) returns text language sql immutable as $$
  select nullif(nullif(upper(regexp_replace(coalesce(t,''), '\s+', '', 'g')), ''), '#N/A') $$;
create or replace function private.nid_hash(n text) returns text language sql stable security definer set search_path=public,extensions as $$
  select encode(hmac(n::bytea, private.pii_key()::bytea, 'sha256'), 'hex') $$;

create table if not exists blacklist (
  id uuid primary key default gen_random_uuid(),
  title_th text, first_name_th text not null, last_name_th text,
  employee_code text, national_id_enc bytea, national_id_hash text, national_id_last4 text,
  name_key text generated always as (private.norm_name(first_name_th || ' ' || coalesce(last_name_th, ''))) stored,
  reason text, listed_on date, note text,
  status text not null default 'active' check (status in ('active','removed')),
  removed_reason text, removed_at timestamptz,
  source text not null default 'manual',
  created_by uuid default auth.uid(), created_at timestamptz default now(), updated_at timestamptz default now());
create index if not exists blacklist_hash on blacklist(national_id_hash) where national_id_hash is not null;
create index if not exists blacklist_code on blacklist(employee_code) where employee_code is not null;
create index if not exists blacklist_name on blacklist(name_key);
alter table blacklist enable row level security;
drop policy if exists bl_adm on blacklist;
create policy bl_adm on blacklist for all using (private.is_admin()) with check (private.is_admin());

-- รวม/เพิ่มรายการ: คนเดียวกัน = เลขบัตรเดียวกัน หรือ (ชื่อ-สกุลเดียวกัน และไม่มีเลขบัตร/รหัสที่ขัดแย้งกัน) -> เติมช่องที่ว่างและต่อเหตุผล
create or replace function private.bl_merge(p_title text, p_first text, p_last text, p_code text, p_nid text, p_reason text, p_listed date, p_source text, out o_id uuid, out o_new boolean)
language plpgsql security definer set search_path=public,extensions as $$
declare k text:=private.pii_key(); nid text:=nullif(regexp_replace(coalesce(p_nid,''),'\D','','g'),''); h text; c text:=private.norm_code(p_code);
        fn text:=nullif(btrim(p_first),''); ln text:=nullif(btrim(p_last),''); rsn text:=nullif(btrim(p_reason),''); nk text;
begin
  if nid is not null and length(nid)<>13 then nid:=null; end if;
  h := case when nid is not null then private.nid_hash(nid) end;
  nk := private.norm_name(fn||' '||coalesce(ln,''));
  if h is not null then select b.id into o_id from blacklist b where b.national_id_hash=h limit 1; end if;
  if o_id is null then
    select b.id into o_id from blacklist b where b.name_key=nk and (b.national_id_hash is null or h is null) and (b.employee_code is null or c is null or b.employee_code=c) limit 1;
  end if;
  if o_id is not null then
    update blacklist set employee_code=coalesce(employee_code,c),
      national_id_enc=case when national_id_enc is null and nid is not null then pgp_sym_encrypt(nid,k) else national_id_enc end,
      national_id_hash=coalesce(national_id_hash,h), national_id_last4=coalesce(national_id_last4,right(nid,4)),
      title_th=coalesce(title_th,nullif(btrim(p_title),'')), listed_on=coalesce(listed_on,p_listed),
      reason=case when rsn is null then reason when reason is null then rsn when position(rsn in reason)>0 then reason else reason||' | '||rsn end,
      status='active', removed_reason=null, removed_at=null, updated_at=now()
    where id=o_id;
    o_new:=false;
  else
    insert into blacklist(title_th,first_name_th,last_name_th,employee_code,national_id_enc,national_id_hash,national_id_last4,reason,listed_on,source)
    values(nullif(btrim(p_title),''),fn,ln,c,case when nid is not null then pgp_sym_encrypt(nid,k) end,h,right(nid,4),rsn,p_listed,coalesce(p_source,'manual'))
    returning id into o_id;
    o_new:=true;
  end if; end $$;

create or replace function import_blacklist(p_rows jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare r jsonb; ins int:=0; mrg int:=0; res record;
begin
  if not private.is_admin() then raise exception 'ต้องเป็น Admin'; end if;
  if private.pii_key() is null then raise exception 'ยังไม่ได้ตั้งค่า pii_key ใน Vault'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if nullif(btrim(r->>'first_name_th'),'') is null then continue; end if;
    select * into res from private.bl_merge(r->>'title_th', r->>'first_name_th', r->>'last_name_th', r->>'employee_code', r->>'national_id', r->>'reason', null, 'excel');
    if res.o_new then ins:=ins+1; else mrg:=mrg+1; end if;
  end loop;
  insert into audit_log(action,detail) values('import_blacklist',jsonb_build_object('inserted',ins,'merged',mrg));
  return jsonb_build_object('inserted',ins,'merged',mrg); end $$;

-- เพิ่ม/แก้ไขรายการจากหน้าจอ (Admin)
create or replace function upsert_blacklist(p_id uuid, p_row jsonb) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare k text:=private.pii_key(); nid text:=nullif(regexp_replace(coalesce(p_row->>'national_id',''),'\D','','g'),''); res record; ln text;
begin
  if not private.is_admin() then raise exception 'ต้องเป็น Admin'; end if;
  if nullif(btrim(p_row->>'first_name_th'),'') is null then raise exception 'กรอกชื่อ'; end if;
  if nid is not null and length(nid)<>13 then raise exception 'เลขบัตรประชาชนต้องมี 13 หลัก'; end if;
  if p_id is null then
    select * into res from private.bl_merge(p_row->>'title_th', p_row->>'first_name_th', p_row->>'last_name_th', p_row->>'employee_code', nid, p_row->>'reason', nullif(p_row->>'listed_on','')::date, 'manual');
    if nullif(p_row->>'note','') is not null then update blacklist set note=p_row->>'note' where id=res.o_id; end if;
    insert into audit_log(action,record_id) values(case when res.o_new then 'blacklist_add' else 'blacklist_merge' end, res.o_id);
    return jsonb_build_object('id',res.o_id,'merged',not res.o_new);
  end if;
  update blacklist set title_th=nullif(btrim(p_row->>'title_th'),''), first_name_th=btrim(p_row->>'first_name_th'), last_name_th=nullif(btrim(p_row->>'last_name_th'),''),
    employee_code=private.norm_code(p_row->>'employee_code'), reason=nullif(btrim(p_row->>'reason'),''), listed_on=nullif(p_row->>'listed_on','')::date, note=nullif(p_row->>'note',''),
    national_id_enc=case when nid is not null then pgp_sym_encrypt(nid,k) else national_id_enc end,
    national_id_hash=case when nid is not null then private.nid_hash(nid) else national_id_hash end,
    national_id_last4=case when nid is not null then right(nid,4) else national_id_last4 end, updated_at=now()
  where id=p_id;
  if not found then raise exception 'ไม่พบรายการ'; end if;
  insert into audit_log(action,record_id) values('blacklist_edit',p_id);
  return jsonb_build_object('id',p_id,'merged',false); end $$;

-- ถอนออกจาก Blacklist (ไม่ลบ เก็บเหตุผลและเวลา) / นำกลับ
create or replace function set_blacklist_status(p_id uuid, p_status text, p_reason text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not private.is_admin() then raise exception 'ต้องเป็น Admin'; end if;
  if p_status not in ('active','removed') then raise exception 'สถานะไม่ถูกต้อง'; end if;
  update blacklist set status=p_status, removed_reason=case when p_status='removed' then nullif(btrim(p_reason),'') end, removed_at=case when p_status='removed' then now() end, updated_at=now() where id=p_id;
  insert into audit_log(action,record_id,detail) values(case when p_status='removed' then 'blacklist_remove' else 'blacklist_restore' end,p_id,'{}'); end $$;

create or replace function reveal_blacklist_id(p_id uuid) returns text language plpgsql security definer set search_path=public,extensions as $$
declare v text;
begin
  if not private.is_admin() then raise exception 'ต้องเป็น Admin'; end if;
  select pgp_sym_decrypt(national_id_enc, private.pii_key()) into v from blacklist where id=p_id;
  insert into audit_log(action,record_id) values('reveal_blacklist_id',p_id);
  return v; end $$;

-- ตรวจสอบบุคคล: คืนเฉพาะรายการ active ที่ "ตรงกัน" ไม่เปิดเผยทั้งรายการ และไม่คืนเลขบัตรเต็ม
create or replace function check_blacklist(p_national_id text default null, p_first text default null, p_last text default null, p_code text default null)
returns table(bl_id uuid, match_by text[], full_name text, emp_code text, id_last4 text, reason text, listed_on date)
language plpgsql security definer set search_path=public,extensions as $$
declare nid text:=nullif(regexp_replace(coalesce(p_national_id,''),'\D','','g'),''); h text; c text:=private.norm_code(p_code); nk text; n int;
begin
  if not exists(select 1 from profiles p where p.id=auth.uid() and p.active and p.role in ('admin','multi_branch_manager','branch_officer')) then raise exception 'ไม่มีสิทธิ์ตรวจสอบ Blacklist'; end if;
  if nid is not null and length(nid)=13 then h:=private.nid_hash(nid); end if;
  if nullif(btrim(coalesce(p_first,'')||coalesce(p_last,'')),'') is not null then nk:=private.norm_name(coalesce(p_first,'')||' '||coalesce(p_last,'')); if length(nk)<4 then nk:=null; end if; end if;
  return query
    select b.id,
      array_remove(array[case when h is not null and b.national_id_hash=h then 'เลขบัตรประชาชนตรงกัน' end,
                         case when c is not null and b.employee_code=c then 'รหัสพนักงานตรงกัน' end,
                         case when nk is not null and b.name_key=nk then 'ชื่อ-สกุลตรงกัน' end], null),
      btrim(coalesce(b.title_th,'')||' '||b.first_name_th||' '||coalesce(b.last_name_th,'')), b.employee_code, b.national_id_last4, b.reason, b.listed_on
    from blacklist b where b.status='active' and ((h is not null and b.national_id_hash=h) or (c is not null and b.employee_code=c) or (nk is not null and b.name_key=nk));
  get diagnostics n = row_count;
  insert into audit_log(action,detail) values('blacklist_check',jsonb_build_object('hits',n)); end $$;

-- ขึ้น Blacklist จากพนักงานในระบบ (Admin) : ดึงชื่อ/รหัส/เลขบัตรจากทะเบียน เปลี่ยนสถานะเป็น blacklisted
create or replace function blacklist_employee(p_emp uuid, p_reason text) returns uuid language plpgsql security definer set search_path=public,extensions as $$
declare e employees; nid text; res record;
begin
  if not private.is_admin() then raise exception 'ต้องเป็น Admin'; end if;
  select * into e from employees where id=p_emp; if not found then raise exception 'ไม่พบพนักงาน'; end if;
  select pgp_sym_decrypt(s.national_id_enc, private.pii_key()) into nid from employee_sensitive s where s.employee_id=p_emp;
  select * into res from private.bl_merge(e.title_th, e.first_name_th, e.last_name_th, e.employee_code, nid, p_reason, current_date, 'employee');
  update employees set status='blacklisted' where id=p_emp and status<>'blacklisted';
  insert into audit_log(action,record_id,detail) values('blacklist_employee',p_emp,jsonb_build_object('blacklist_id',res.o_id));
  return res.o_id; end $$;

revoke all on function import_blacklist(jsonb), upsert_blacklist(uuid,jsonb), set_blacklist_status(uuid,text,text), reveal_blacklist_id(uuid), check_blacklist(text,text,text,text), blacklist_employee(uuid,text) from public;
grant execute on function import_blacklist(jsonb), upsert_blacklist(uuid,jsonb), set_blacklist_status(uuid,text,text), reveal_blacklist_id(uuid), check_blacklist(text,text,text,text), blacklist_employee(uuid,text) to authenticated;

-- ประวัติการจ้าง: ขึ้น Blacklist จากพนักงานที่ลาออกแล้ว ไม่ถือเป็นการกลับมาทำงาน (คงวันที่/เหตุผลลาออกไว้)
create or replace function private.emp_trg() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into employment_history(employee_id,branch_id,event_type,effective_date)
      values(new.id,new.branch_id,'hire',coalesce(new.hire_date,current_date));
  else
    new.updated_at=now();
    if new.branch_id<>old.branch_id then
      insert into employment_history(employee_id,branch_id,event_type) values(new.id,new.branch_id,'transfer'); end if;
    if new.status<>old.status then
      if new.status='blacklisted' then
        insert into employment_history(employee_id,branch_id,event_type,reason) values(new.id,new.branch_id,'blacklist','ขึ้น Blacklist (สถานะเดิม '||old.status::text||')');
      elsif new.status='resigned' then
        new.resigned_at := coalesce(new.resigned_at, current_date);
        insert into employment_history(employee_id,branch_id,event_type,effective_date,reason)
          values(new.id,new.branch_id,'resign',new.resigned_at,new.resign_reason);
      elsif old.status='resigned' then
        insert into employment_history(employee_id,branch_id,event_type,reason)
          values(new.id,new.branch_id,'rehire','เดิมลาออก '||coalesce(old.resigned_at::text,'-')||coalesce(' ('||old.resign_reason||')',''));
        new.resigned_at := null; new.resign_reason := null;
      else
        insert into employment_history(employee_id,branch_id,event_type,reason)
          values(new.id,new.branch_id,'status_change',old.status::text||' -> '||new.status::text);
      end if;
    end if;
  end if; return new; end $$;
