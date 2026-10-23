-- เก็บวันที่ลาออกและเหตุผลการลาออกในทะเบียนพนักงานโดยตรง (เดิมมีแค่ในประวัติการจ้างและไม่มีเหตุผล)
alter table employees add column if not exists resigned_at date, add column if not exists resign_reason text;
create index if not exists employees_resigned_at on employees(resigned_at) where status = 'resigned';

-- เติมวันที่ลาออกให้พนักงานที่เคยนำเข้าไว้แล้ว จากประวัติการจ้างเดิม
update employees e set resigned_at = h.effective_date
from (select distinct on (employee_id) employee_id, effective_date from employment_history where event_type = 'resign' and effective_date is not null order by employee_id, created_at desc) h
where h.employee_id = e.id and e.status = 'resigned' and e.resigned_at is null;

-- เปลี่ยนสถานะเป็นพ้นสภาพ: ตั้งวันที่ลาออก (ถ้าไม่กรอก = วันนี้) และบันทึกประวัติพร้อมเหตุผล / กลับมาทำงาน: บันทึก rehire และล้างข้อมูลลาออก (ประวัติยังอยู่)
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
      if new.status='resigned' then
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

-- นำเข้า: รับ resign_date / resign_reason, และเติมข้อมูลลาออกให้พนักงานที่มีอยู่แล้วและเป็น "พ้นสภาพ" (เติมเฉพาะช่องที่ยังว่าง ไม่เขียนทับ)
create or replace function import_employees(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare r jsonb; k text:=private.pii_key(); eid uuid; ins int:=0; upd int:=0; n int; skipped text[]:='{}'; nid text; ba text; br uuid;
begin
  if not private.is_admin() then raise exception 'ต้องเป็น Admin'; end if;
  if k is null then raise exception 'ยังไม่ได้ตั้งค่า pii_key ใน Vault'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    eid:=null; br:=(r->>'branch_id')::uuid;
    nid:=nullif(r->>'national_id',''); ba:=nullif(r->>'bank_account','');
    if nid is not null and not private.valid_thai_id(nid) then nid:=null; end if;
    insert into employees(employee_code,branch_id,status,title_th,first_name_th,last_name_th,first_name_en,last_name_en,nickname,
        birth_date,hire_date,position,section,cost_center,phone,emergency_name,emergency_relation,emergency_phone,national_id_last4,bank_last4,resigned_at,resign_reason)
    values(r->>'code',br,coalesce(nullif(r->>'status',''),'active')::emp_status,r->>'title_th',r->>'first_name_th',r->>'last_name_th',
        r->>'first_name_en',r->>'last_name_en',r->>'nickname',nullif(r->>'birth_date','')::date,nullif(r->>'hire_date','')::date,
        r->>'position',r->>'section',r->>'cost_center',r->>'phone',r->>'emergency_name',r->>'emergency_relation',r->>'emergency_phone',
        right(nid,4),right(ba,4),nullif(r->>'resign_date','')::date,nullif(r->>'resign_reason',''))
    on conflict(employee_code) do nothing returning id into eid;
    if eid is null then
      if nullif(r->>'resign_date','') is not null or nullif(r->>'resign_reason','') is not null then
        update employees set resigned_at=coalesce(resigned_at,nullif(r->>'resign_date','')::date), resign_reason=coalesce(resign_reason,nullif(r->>'resign_reason',''))
        where employee_code=r->>'code' and status='resigned' and (resigned_at is null or resign_reason is null);
        get diagnostics n = row_count; upd:=upd+n;
      end if;
      skipped:=skipped||(r->>'code'); continue;
    end if;
    ins:=ins+1;
    if nid is not null or ba is not null then
      insert into employee_sensitive(employee_id,national_id_enc,bank_name,bank_account_enc)
      values(eid,case when nid is not null then pgp_sym_encrypt(nid,k) end,nullif(r->>'bank_name',''),case when ba is not null then pgp_sym_encrypt(ba,k) end);
    end if;
    if coalesce(nullif(r->>'status',''),'active')='resigned' then
      insert into employment_history(employee_id,branch_id,event_type,effective_date,reason)
      values(eid,br,'resign',nullif(r->>'resign_date','')::date,coalesce(nullif(r->>'resign_reason',''),'นำเข้าจาก Excel'));
    end if;
  end loop;
  insert into audit_log(action,detail) values('import_employees',jsonb_build_object('inserted',ins,'skipped',cardinality(skipped),'updated',upd));
  return jsonb_build_object('inserted',ins,'updated',upd,'skipped',to_jsonb(skipped));
end $$;
revoke all on function import_employees(jsonb) from public;
grant execute on function import_employees(jsonb) to authenticated;
