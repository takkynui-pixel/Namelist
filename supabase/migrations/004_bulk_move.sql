-- ย้ายพนักงานหลายคนไปบริษัท/สาขาใหม่ในครั้งเดียว (ตรวจสิทธิ์ทั้งสาขาต้นทางและปลายทาง)
create or replace function bulk_move_employees(p_ids uuid[], p_branch uuid) returns int
language plpgsql security definer set search_path=public as $$
declare n int;
begin
  if not private.can_edit(p_branch) then raise exception 'ไม่มีสิทธิ์แก้ไขในสาขาปลายทาง'; end if;
  if exists(select 1 from employees e where e.id = any(p_ids) and not private.can_edit(e.branch_id)) then
    raise exception 'มีพนักงานที่คุณไม่มีสิทธิ์แก้ไข'; end if;
  update employees set branch_id = p_branch where id = any(p_ids) and branch_id <> p_branch;
  get diagnostics n = row_count;
  insert into audit_log(action, record_id, detail) values('bulk_move', p_branch, jsonb_build_object('count', n));
  return n;
end $$;
revoke all on function bulk_move_employees(uuid[], uuid) from public;
grant execute on function bulk_move_employees(uuid[], uuid) to authenticated;
