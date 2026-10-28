-- ค้นหาพนักงานและ Blacklist: รองรับ "ชื่อ นามสกุล" หลายคำ ค้นบางส่วนได้ ไม่สนตัวพิมพ์/ช่องว่างพิเศษ และเร็วขึ้น (ไม่ตรวจ RLS ทีละแถว)

-- ปรับข้อความสำหรับเทียบ: ตัวพิมพ์เล็ก + ตัดช่องว่างพิเศษ/อักขระล่องหน (NBSP, zero-width) ที่มักติดมากับข้อมูลจาก Excel
create or replace function private.srch(t text) returns text language sql immutable as $$
  select lower(regexp_replace(coalesce(t, ''), '[\u00a0\u200b\u200c\u200d\ufeff]', '', 'g')) $$;

create or replace function search_employees(p_q text default null, p_status text default null, p_branch uuid default null, p_limit int default 50, p_offset int default 0)
returns table(id uuid, employee_code text, title_th text, first_name_th text, last_name_th text, "position" text, status text, resigned_at date, resign_reason text, branch_id uuid, branch_name text, client_name text, total bigint)
language plpgsql stable security definer set search_path=public as $$
declare toks text[];
begin
  if not exists(select 1 from profiles p where p.id = auth.uid() and p.active) then raise exception 'ไม่มีสิทธิ์'; end if;
  select array_agg(x) into toks from regexp_split_to_table(btrim(private.srch(p_q)), '\s+') x where x <> '';
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 2000); p_offset := greatest(coalesce(p_offset, 0), 0);
  return query
    with vb as materialized (
      select b.id, b.name, c.name cname from branches b join clients c on c.id = b.client_id
      where private.can_view(b.id) and (p_branch is null or b.id = p_branch)),
    m as (
      select e.id, e.employee_code, e.title_th, e.first_name_th, e.last_name_th, e."position", e.status::text st, e.resigned_at, e.resign_reason, e.branch_id,
             private.srch(concat_ws(' ', e.employee_code, coalesce(e.title_th,'') || coalesce(e.first_name_th,''), e.last_name_th, coalesce(e.first_name_th,'') || coalesce(e.last_name_th,''),
                                   e.nickname, e.first_name_en, e.last_name_en, coalesce(e.first_name_en,'') || coalesce(e.last_name_en,''))) as hay
      from employees e join vb on vb.id = e.branch_id
      where (p_status is null or p_status = '' or e.status::text = p_status))
    select m.id, m.employee_code, m.title_th, m.first_name_th, m.last_name_th, m."position", m.st, m.resigned_at, m.resign_reason, m.branch_id, vb.name, vb.cname, count(*) over ()
    from m join vb on vb.id = m.branch_id
    where toks is null or not exists (select 1 from unnest(toks) tk where m.hay not like '%' || replace(replace(replace(tk, '\', '\\'), '%', '\%'), '_', '\_') || '%')
    order by (case when toks is not null and private.srch(m.employee_code) = toks[1] then 0 else 1 end), m.employee_code
    limit p_limit offset p_offset;
end $$;
revoke all on function search_employees(text, text, uuid, int, int) from public; grant execute on function search_employees(text, text, uuid, int, int) to authenticated;

-- ตรวจสอบ Blacklist: ค้นด้วยชื่อ/นามสกุล "บางส่วน" ได้ (กรอกแค่ชื่อ หรือแค่นามสกุลก็ได้) เรียงผลตรงมากไปน้อย
drop function if exists check_blacklist(text, text, text, text);
create or replace function check_blacklist(p_national_id text default null, p_first text default null, p_last text default null, p_code text default null)
returns table(bl_id uuid, match_by text[], full_name text, emp_code text, id_last4 text, reason text, listed_on date, total bigint)
language plpgsql security definer set search_path=public,extensions as $$
declare nid text:=nullif(regexp_replace(coalesce(p_national_id,''),'\D','','g'),''); h text; c text:=private.norm_code(p_code);
        fn text:=private.norm_name(p_first); ln text:=private.norm_name(p_last); n int;
begin
  if not exists(select 1 from profiles p where p.id=auth.uid() and p.active and p.role in ('admin','multi_branch_manager','branch_officer')) then raise exception 'ไม่มีสิทธิ์ตรวจสอบ Blacklist'; end if;
  if nid is not null and length(nid)=13 then h:=private.nid_hash(nid); end if;
  fn := nullif(fn,''); ln := nullif(ln,'');
  -- ชื่อที่สั้นเกินไปให้ค้นเฉพาะแบบตรงทั้งชื่อ-สกุล ไม่ค้นบางส่วน (กันผลลัพธ์ท่วม)
  return query
    with c as (
      select b.*,
        (h is not null and b.national_id_hash = h) as m_id,
        (c is not null and b.employee_code = c) as m_code,
        (fn is not null and ln is not null and b.name_key = fn || ln) or (fn is not null and ln is null and b.name_key = fn) as m_name,
        (fn is not null and ln is not null and b.name_key like fn || '%' || ln || '%')
          or (fn is not null and ln is null and length(fn) >= 3 and b.name_key like '%' || fn || '%')
          or (fn is null and ln is not null and length(ln) >= 3 and b.name_key like '%' || ln || '%') as m_part
      from blacklist b where b.status = 'active')
    select c.id,
      array_remove(array[case when c.m_id then 'เลขบัตรประชาชนตรงกัน' end, case when c.m_code then 'รหัสพนักงานตรงกัน' end,
                         case when c.m_name then 'ชื่อ-สกุลตรงกัน' when c.m_part then 'ชื่อ/นามสกุลบางส่วนตรงกัน' end], null),
      btrim(coalesce(c.title_th,'')||' '||c.first_name_th||' '||coalesce(c.last_name_th,'')), c.employee_code, c.national_id_last4, c.reason, c.listed_on, count(*) over ()
    from c where c.m_id or c.m_code or c.m_name or c.m_part
    order by (c.m_id)::int desc, (c.m_code)::int desc, (c.m_name)::int desc, c.first_name_th, c.last_name_th
    limit 50;
  get diagnostics n = row_count;
  insert into audit_log(action,detail) values('blacklist_check',jsonb_build_object('hits',n));
end $$;
revoke all on function check_blacklist(text,text,text,text) from public; grant execute on function check_blacklist(text,text,text,text) to authenticated;
