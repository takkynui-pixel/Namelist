-- นำเข้าพนักงานจาก Excel (Admin เท่านั้น) : ไม่เขียนทับรหัสที่มีอยู่แล้ว / เข้ารหัสเลขบัตร-บัญชีในฟังก์ชัน
create or replace function import_employees(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r jsonb; k text:=private.pii_key(); eid uuid; ins int:=0; skipped text[]:='{}'; nid text; ba text; br uuid;
begin
  if not private.is_admin() then raise exception 'ต้องเป็น Admin'; end if;
  if k is null then raise exception 'ยังไม่ได้ตั้งค่า pii_key ใน Vault'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    eid:=null; br:=(r->>'branch_id')::uuid;
    nid:=nullif(r->>'national_id',''); ba:=nullif(r->>'bank_account','');
    if nid is not null and not private.valid_thai_id(nid) then nid:=null; end if;
    insert into employees(employee_code,branch_id,status,title_th,first_name_th,last_name_th,first_name_en,last_name_en,nickname,
        birth_date,hire_date,position,section,cost_center,phone,emergency_name,emergency_relation,emergency_phone,national_id_last4,bank_last4)
    values(r->>'code',br,coalesce(nullif(r->>'status',''),'active')::emp_status,r->>'title_th',r->>'first_name_th',r->>'last_name_th',
        r->>'first_name_en',r->>'last_name_en',r->>'nickname',nullif(r->>'birth_date','')::date,nullif(r->>'hire_date','')::date,
        r->>'position',r->>'section',r->>'cost_center',r->>'phone',r->>'emergency_name',r->>'emergency_relation',r->>'emergency_phone',
        right(nid,4),right(ba,4))
    on conflict(employee_code) do nothing returning id into eid;
    if eid is null then skipped:=skipped||(r->>'code'); continue; end if;
    ins:=ins+1;
    if nid is not null or ba is not null then
      insert into employee_sensitive(employee_id,national_id_enc,bank_name,bank_account_enc)
      values(eid,case when nid is not null then pgp_sym_encrypt(nid,k) end,nullif(r->>'bank_name',''),case when ba is not null then pgp_sym_encrypt(ba,k) end);
    end if;
    if nullif(r->>'resign_date','') is not null then
      insert into employment_history(employee_id,branch_id,event_type,effective_date,reason)
      values(eid,br,'resign',(r->>'resign_date')::date,'นำเข้าจาก Excel');
    end if;
  end loop;
  insert into audit_log(action,detail) values('import_employees',jsonb_build_object('inserted',ins,'skipped',cardinality(skipped)));
  return jsonb_build_object('inserted',ins,'skipped',to_jsonb(skipped));
end $$;
revoke all on function import_employees(jsonb) from public;
grant execute on function import_employees(jsonb) to authenticated;
