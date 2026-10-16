"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { sb, STATUS } from "@/lib/supabase";

export default function Home() {
  const [user, setUser] = useState<any>(null), [ready, setReady] = useState(false);
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [err, setErr] = useState("");
  const [rows, setRows] = useState<any[]>([]), [branches, setBranches] = useState<any[]>([]);
  const [q, setQ] = useState(""), [st, setSt] = useState("active"), [br, setBr] = useState("");

  useEffect(() => { sb.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); setReady(true); });
    const { data: l } = sb.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null)); return () => l.subscription.unsubscribe(); }, []);
  useEffect(() => { if (!user) return;
    sb.from("branches").select("id,name,clients(name)").order("name").then(({ data }) => setBranches(data ?? [])); }, [user]);
  useEffect(() => { if (!user) return;
    let x = sb.from("employees").select("id,employee_code,title_th,first_name_th,last_name_th,position,status,branches(name,clients(name))").order("employee_code").limit(200);
    if (st) x = x.eq("status", st); if (br) x = x.eq("branch_id", br);
    if (q) x = x.or(`first_name_th.ilike.%${q}%,last_name_th.ilike.%${q}%,employee_code.ilike.%${q}%`);
    x.then(({ data }) => setRows(data ?? [])); }, [user, q, st, br]);

  if (!ready) return null;
  if (!user) return <main style={{ maxWidth: 360 }}><h1>VTA Namelist</h1>
    <div className="grid"><label>อีเมล<input value={email} onChange={e => setEmail(e.target.value)} /></label>
    <label>รหัสผ่าน<input type="password" value={pw} onChange={e => setPw(e.target.value)} /></label>
    <button className="p" onClick={async () => { const { error } = await sb.auth.signInWithPassword({ email, password: pw }); setErr(error ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : ""); }}>เข้าสู่ระบบ</button>
    <span className="err">{err}</span></div></main>;

  return <><header><b>VTA Namelist</b><span><a href="/admin" style={{ color: "#fff", marginRight: 16 }}>จัดการระบบ</a><button onClick={() => sb.auth.signOut()}>ออกจากระบบ</button></span></header>
    <main><div className="row">
      <input placeholder="ค้นหาชื่อ หรือรหัสพนักงาน" value={q} onChange={e => setQ(e.target.value)} />
      <select value={st} onChange={e => setSt(e.target.value)}><option value="">ทุกสถานะ</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <select value={br} onChange={e => setBr(e.target.value)}><option value="">ทุกสาขา</option>{branches.map(b => <option key={b.id} value={b.id}>{b.clients?.name} / {b.name}</option>)}</select>
      <Link href="/employee/new"><button className="p">เพิ่มพนักงาน</button></Link></div>
    <div className="tbl"><table><thead><tr><th>รหัส</th><th>ชื่อ-สกุล</th><th>ตำแหน่ง</th><th>บริษัท / สาขา</th><th>สถานะ</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.id}><td><Link href={`/employee/${r.id}`}>{r.employee_code}</Link></td>
        <td>{r.title_th}{r.first_name_th} {r.last_name_th}</td><td>{r.position}</td>
        <td>{r.branches?.clients?.name} / {r.branches?.name}</td><td>{STATUS[r.status]}</td></tr>)}
      {!rows.length && <tr><td colSpan={5}>ไม่พบพนักงาน หากยังไม่เห็นสาขาใดเลย ให้ติดต่อ Admin เพื่อกำหนดสิทธิ์</td></tr>}
    </tbody></table></div></main></>;
}
