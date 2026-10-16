"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import PageHead from "@/components/PageHead";
import { sb, STATUS } from "@/lib/supabase";

const PER = 50;
const BADGE: Record<string, string> = { active: "badge", pending: "badge approved", on_leave: "badge draft", resigned: "badge draft", blacklisted: "badge draft" };

export default function Home() {
  const [rows, setRows] = useState<any[]>([]), [total, setTotal] = useState(0), [branches, setBranches] = useState<any[]>([]);
  const [q, setQ] = useState(""), [st, setSt] = useState("active"), [br, setBr] = useState(""), [pg, setPg] = useState(0);
  useEffect(() => { sb.from("branches").select("id,name,clients(name)").order("name").then(({ data }) => setBranches(data ?? [])); }, []);
  useEffect(() => { setPg(0); }, [q, st, br]);
  useEffect(() => {
    let x = sb.from("employees").select("id,employee_code,title_th,first_name_th,last_name_th,position,status,branches(name,clients(name))", { count: "exact" }).order("employee_code").range(pg * PER, pg * PER + PER - 1);
    if (st) x = x.eq("status", st); if (br) x = x.eq("branch_id", br);
    const s = q.replace(/[%,()]/g, "").trim();
    if (s) x = x.or(`first_name_th.ilike.%${s}%,last_name_th.ilike.%${s}%,employee_code.ilike.%${s}%`);
    x.then(({ data, count }) => { setRows(data ?? []); setTotal(count ?? 0); });
  }, [q, st, br, pg]);
  return <AppShell><PageHead title="รายชื่อพนักงาน" subtitle={`พบ ${total.toLocaleString()} รายการ`} />
    <div className="card"><div className="row">
      <input placeholder="ค้นหาชื่อ หรือรหัสพนักงาน" value={q} onChange={e => setQ(e.target.value)} />
      <select value={st} onChange={e => setSt(e.target.value)} aria-label="สถานะ"><option value="">ทุกสถานะ</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <select value={br} onChange={e => setBr(e.target.value)} aria-label="สาขา"><option value="">ทุกสาขา</option>{branches.map(b => <option key={b.id} value={b.id}>{b.clients?.name} / {b.name}</option>)}</select>
      <Link href="/employee/new" className="btn">เพิ่มพนักงาน</Link></div></div>
    <div className="card flush"><table><thead><tr><th>รหัส</th><th>ชื่อ-สกุล</th><th>ตำแหน่ง</th><th>บริษัท / สาขา</th><th>สถานะ</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.id}><td><Link href={`/employee/${r.id}`}>{r.employee_code}</Link></td>
        <td>{r.title_th}{r.first_name_th} {r.last_name_th}</td><td>{r.position}</td>
        <td>{r.branches?.clients?.name} / {r.branches?.name}</td><td><span className={BADGE[r.status]}>{STATUS[r.status]}</span></td></tr>)}
      {!rows.length && <tr><td colSpan={5}>ไม่พบพนักงาน หากยังไม่เห็นสาขาใดเลย ให้ติดต่อ Admin เพื่อกำหนดสิทธิ์</td></tr>}
    </tbody></table></div>
    <div className="row"><button className="sec" disabled={pg === 0} onClick={() => setPg(pg - 1)}>ก่อนหน้า</button>
      <span className="mut">หน้า {pg + 1} / {Math.max(1, Math.ceil(total / PER))}</span>
      <button className="sec" disabled={(pg + 1) * PER >= total} onClick={() => setPg(pg + 1)}>ถัดไป</button></div>
  </AppShell>;
}
