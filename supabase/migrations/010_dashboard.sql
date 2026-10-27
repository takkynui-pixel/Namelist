-- ภาพรวม (Dashboard): สรุปข้อมูลพนักงานตามสิทธิ์ของผู้ใช้ ประมวลผลในฐานข้อมูล ส่งกลับเฉพาะตัวเลขรวม (ไม่มีข้อมูลรายบุคคล)
-- ใช้ security definer เพื่อความเร็ว (ไม่ตรวจ RLS ทีละแถว) แต่จำกัดเฉพาะสาขาที่ผู้ใช้มองเห็นผ่าน private.can_view() เหมือนหน้ารายชื่อพนักงาน

-- จัดกลุ่มเหตุผลการลาออก (ข้อความอิสระ) ด้วยคำสำคัญ — เป็นการประมาณเพื่อดูภาพรวม ไม่ใช่การจัดหมวดที่แม่นยำ 100%
create or replace function private.resign_category(r text) returns text language sql immutable as $$
  select case
    when r is null or btrim(r) = '' then 'ไม่ระบุเหตุผล'
    when r ~* 'ไม่ผ่านทดลอง|ไม่ผ่านประเมิน|ปลดออก|ไล่ออก|ทุจริต|ผลงาน|ประพฤติ|วินัย|blacklist' then 'ผลงาน / วินัย'
    when r ~* 'ไม่มาเริ่มงาน|ไม่มารายงานตัว' then 'ไม่มาเริ่มงาน'
    when r ~* 'ขาดงาน|ติดต่อไม่ได้|พ้นสภาพ' then 'ขาดงาน / ติดต่อไม่ได้'
    when r ~* 'ได้งานใหม่|งานใหม่|ย้ายงาน' then 'ได้งานใหม่'
    when r ~* 'บรรจุ|ส่งคืน|หมดสัญญา|ครบสัญญา|ครบกำหนด|เลิกจ้าง|ปิดไลน์|ลดคน' then 'บรรจุ / ส่งคืน / หมดสัญญา'
    when r ~* 'กลับบ้าน|ภูมิลำเนา|ต่างจังหวัด|ย้ายที่อยู่|ย้ายบ้าน' then 'กลับภูมิลำเนา'
    when r ~* 'สุขภาพ|ป่วย|ครอบครัว|ดูแล|ลาคลอด|ตั้งครรภ์|เรียนต่อ|ศึกษา' then 'สุขภาพ / ครอบครัว / ศึกษาต่อ'
    else 'อื่นๆ' end $$;

create or replace function dashboard_overview(p_service_branch uuid default null, p_client uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare t date := current_date; r jsonb;
begin
  if not exists(select 1 from profiles p where p.id = auth.uid() and p.active) then raise exception 'ไม่มีสิทธิ์'; end if;
  with vb as materialized (
    select b.id, b.client_id, b.service_branch_id, coalesce(nullif(b.area,''), nullif(s.area,''), 'ไม่ระบุ') as area
    from branches b join service_branches s on s.id = b.service_branch_id
    where private.can_view(b.id) and (p_service_branch is null or b.service_branch_id = p_service_branch) and (p_client is null or b.client_id = p_client)),
  e as materialized (
    select x.status, x.hire_date, x.resigned_at, x.resign_reason, x.birth_date, x.national_id_last4, x.bank_last4, x.phone, x.emergency_phone,
           vb.client_id cid, vb.service_branch_id sid, vb.area,
           (x.status in ('active','on_leave')) as working,
           (x.hire_date is not null and x.hire_date <= t - 365 and x.status <> 'pending' and (x.status in ('active','on_leave') or x.resigned_at > t - 365)) as hc12,
           (x.resigned_at > t - 365 and x.resigned_at <= t) as res12, (x.resigned_at > t - 30 and x.resigned_at <= t) as res30,
           (x.hire_date > t - 365 and x.hire_date <= t) as hire12, (x.hire_date > t - 30 and x.hire_date <= t) as hire30
    from employees x join vb on vb.id = x.branch_id
    -- ผู้ลาออกก่อนช่วง 12 เดือนล่าสุด ไม่เกี่ยวกับตัวเลขที่แสดง ตัดออกเพื่อความเร็ว (ยอดรวมผู้ลาออกทั้งหมดนับแยกใน st)
    where x.status in ('active','on_leave','pending') or (x.status in ('resigned','blacklisted') and x.resigned_at >= date_trunc('month', t) - interval '12 months')),
  st as (select count(*) filter (where x.status = 'resigned') rs, count(*) filter (where x.status = 'blacklisted') bl from employees x join vb on vb.id = x.branch_id),
  k as (select count(*) filter (where working) w, count(*) filter (where status = 'active') a, count(*) filter (where status = 'on_leave') l, count(*) filter (where status = 'pending') p,
               count(*) filter (where hc12) hc12,
               count(*) filter (where hire30) hire30, count(*) filter (where res30) res30, count(*) filter (where hire12) hire12, count(*) filter (where res12) res12,
               count(*) filter (where res12 and hire_date is not null and resigned_at - hire_date <= 90) early, count(*) filter (where res12 and hire_date is not null) res12_dated,
               avg((t - hire_date) / 365.25) filter (where working and hire_date is not null and hire_date <= t) tenure
        from e)
  select jsonb_build_object(
    'generated_at', now(), 'scope', jsonb_build_object('branches', (select count(*) from vb), 'companies', (select count(distinct client_id) from vb), 'service_branches', (select count(distinct service_branch_id) from vb)),
    'kpi', (select to_jsonb(k) || (select to_jsonb(st) from st) || jsonb_build_object('turnover_12m', case when (k.w + k.hc12) > 0 then round(k.res12 * 100.0 / ((k.w + k.hc12) / 2.0), 1) end) from k),
    'monthly', (select coalesce(jsonb_agg(jsonb_build_object('m', to_char(m, 'YYYY-MM'), 'hires', x.h, 'resigns', x.r, 'headcount', x.hc) order by m), '[]'::jsonb)
                from generate_series(date_trunc('month', t) - interval '11 months', date_trunc('month', t), interval '1 month') m
                cross join lateral (select count(*) filter (where hire_date >= m and hire_date < m + interval '1 month') h,
                                           count(*) filter (where resigned_at >= m and resigned_at < m + interval '1 month') r,
                                           count(*) filter (where hire_date is not null and hire_date < m + interval '1 month' and status <> 'pending'
                                                              and (status in ('active','on_leave') or resigned_at >= m + interval '1 month')) hc from e) x),
    'by_service', (select coalesce(jsonb_agg(z order by (z->>'working')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'area', s.area, 'working', count(*) filter (where e.working), 'res12', count(*) filter (where e.res12), 'hc12', count(*) filter (where e.hc12),
               'companies', count(distinct e.cid) filter (where e.working)) z from e join service_branches s on s.id = e.sid group by s.id) q),
    'by_client', (select coalesce(jsonb_agg(z order by (z->>'working')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'working', count(*) filter (where e.working), 'res12', count(*) filter (where e.res12), 'hc12', count(*) filter (where e.hc12)) z
        from e join clients c on c.id = e.cid group by c.id having count(*) filter (where e.working or e.res12) > 0 order by count(*) filter (where e.working) desc limit 50) q),
    'by_area', (select coalesce(jsonb_agg(z order by (z->>'working')::int desc), '[]'::jsonb) from (
        select jsonb_build_object('area', e.area, 'working', count(*) filter (where e.working), 'res12', count(*) filter (where e.res12), 'hc12', count(*) filter (where e.hc12)) z
        from e group by e.area having count(*) filter (where e.working or e.res12) > 0) q),
    'reasons', (select coalesce(jsonb_agg(jsonb_build_object('name', cat, 'n', n) order by n desc), '[]'::jsonb) from (
        select private.resign_category(resign_reason) cat, count(*) n from e where res12 group by 1) q),
    'tenure', (select jsonb_build_object('lt3m', count(*) filter (where d <= 92), 'm3_6', count(*) filter (where d > 92 and d <= 183), 'm6_12', count(*) filter (where d > 183 and d <= 365),
                  'y1_3', count(*) filter (where d > 365 and d <= 1095), 'y3_5', count(*) filter (where d > 1095 and d <= 1825), 'y5p', count(*) filter (where d > 1825), 'unknown', (select count(*) from e where working and (hire_date is null or hire_date > t)))
               from (select (t - hire_date) d from e where working and hire_date is not null and hire_date <= t) q),
    'age', (select jsonb_build_object('lt25', count(*) filter (where a < 25), 'a25_34', count(*) filter (where a >= 25 and a < 35), 'a35_44', count(*) filter (where a >= 35 and a < 45),
                  'a45_54', count(*) filter (where a >= 45 and a < 55), 'a55p', count(*) filter (where a >= 55), 'unknown', (select count(*) from e where working and birth_date is null))
            from (select extract(year from age(t, birth_date)) a from e where working and birth_date is not null) q),
    'quality', (select jsonb_build_object('total', count(*), 'no_nid', count(*) filter (where national_id_last4 is null), 'no_bank', count(*) filter (where bank_last4 is null),
                  'no_hire', count(*) filter (where hire_date is null), 'no_birth', count(*) filter (where birth_date is null), 'no_phone', count(*) filter (where phone is null),
                  'no_emergency', count(*) filter (where emergency_phone is null)) from e where working),
    'blacklist', case when private.is_admin() then (select count(*) from blacklist where status = 'active') end
  ) into r;
  return r; end $$;
revoke all on function dashboard_overview(uuid, uuid) from public; grant execute on function dashboard_overview(uuid, uuid) to authenticated;
