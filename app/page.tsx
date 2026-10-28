"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import PageHead from "@/components/PageHead";
import { sb, STATUS } from "@/lib/supabase";

const PER = 50;
const BADGE: Record<string, string> = { active: "badge", pending: "badge approved", on_leave: "badge draft", resigned: "badge draft", blacklisted: "badge draft" };

export default function Home() {
  const [rows, setRows] = useState<any[]>([]), [total, setTotal] = useState(0), [branches, setBranches] = useState<any[]>([]), [err, setErr] = useState(""), [loading, setLoading] = useState(true);
  const [q, setQ] = useState(""), [dq, setDq] = useState(""), [st, setSt] = useState("active"), [stTouched, setStTouched] = useState(false), [br, setBr] = useState(""), [pg, setPg] = useState(0), [tick, setTick] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set()), [target, setTarget] = useState(""), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const req = useRef(0);
  const searching = dq.trim() !== "";
  // ถ้ากำลังค้นหาด้วยข้อความและผู้ใช้ยังไม่ได้เลือกสถานะเอง ให้ค้นทุกสถานะ (คนที่ค้นหาอาจลาออกแล้ว)
  const effSt = searching && !stTouched ? "" : st;

  useEffect(() => { sb.from("branches").select("id,name,clients(name)").order("name").then(({ data }) => setBranches(data ?? [])); }, []);
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);   // หน่วงการค้นหา ไม่ยิงทุกตัวอักษร
  useEffect(() => { setPg(0); setSel(new Set()); }, [dq, effSt, br]);

  const args = (limit: number, offset: number) => ({ p_q: dq.trim() || null, p_status: effSt || null, p_branch: br || null, p_limit: limit, p_offset: offset });
  useEffect(() => {
    const id = ++req.current; setLoading(true);
    sb.rpc("search_employees", args(PER, pg * PER)).then(({ data, error }: any) => {
      if (id !== req.current) return;          // ทิ้งคำตอบเก่าที่มาช้ากว่าคำค้นล่าสุด
      setLoading(false);
      if (error) { setErr("ค้นหาไม่สำเร็จ: " + error.message); setRows([]); setTotal(0); return; }
      setErr(""); if (!data?.length && pg > 0) { setPg(0); return; }
      setRows(data ?? []); setTotal(data?.[0]?.total ?? 0); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq, effSt, br, pg, tick]);

  const pageAll = rows.length > 0 && rows.every(r => sel.has(r.id));
  const togglePage = () => { const n = new Set(sel); rows.forEach(r => pageAll ? n.delete(r.id) : n.add(r.id)); setSel(n); };
  const toggle = (id: string) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  const selectAllMatching = async () => {
    setBusy(true); const ids = new Set<string>();
    for (let f = 0; ; f += 2000) { const { data, error } = await sb.rpc("search_employees", args(2000, f)); if (error) { setMsg("ไม่สำเร็จ: " + error.message); break; } (data ?? []).forEach((r: any) => ids.add(r.id)); if ((data?.length ?? 0) < 2000) break; }
    setSel(ids); setBusy(false);
  };
  const move = async () => {
    const b = branches.find(x => x.id === target); if (!b) return;
    if (!window.confirm(`ย้ายพนักงาน ${sel.size.toLocaleString()} คน ไปที่\n${b.clients?.name} / ${b.name}\nใช่หรือไม่?`)) return;
    setBusy(true); setMsg("");
    const { data, error } = await sb.rpc("bulk_move_employees", { p_ids: [...sel], p_branch: target });
    setBusy(false);
    if (error) return setMsg("ย้ายไม่สำเร็จ: " + error.message);
    setMsg(`ย้ายสำเร็จ ${data} คน`); setSel(new Set()); setTarget(""); setTick(t => t + 1);
  };

  return <AppShell><PageHead title="รายชื่อพนักงาน" subtitle={loading ? "กำลังค้นหา..." : `พบ ${total.toLocaleString()} รายการ`} />
    <div className="card"><div className="row">
      <input type="search" placeholder="ค้นหา ชื่อ นามสกุล หรือรหัสพนักงาน (พิมพ์ได้หลายคำ)" aria-label="ค้นหาพนักงาน" value={q} onChange={e => setQ(e.target.value)} />
      <select value={effSt} onChange={e => { setSt(e.target.value); setStTouched(true); }} aria-label="สถานะ"><option value="">ทุกสถานะ</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <select value={br} onChange={e => setBr(e.target.value)} aria-label="สาขา"><option value="">ทุกสาขา</option>{branches.map(b => <option key={b.id} value={b.id}>{b.clients?.name} / {b.name}</option>)}</select>
      <Link href="/employee/new" className="btn">เพิ่มพนักงาน</Link></div>
      {searching && !stTouched && <small className="mut">กำลังค้นหาในทุกสถานะ (รวมที่ลาออกแล้ว) เลือกสถานะเพื่อจำกัดผลได้</small>}</div>
    {err && <p className="err" role="alert">{err}</p>}

    {(sel.size > 0 || msg) && <div className="card" role="region" aria-label="ย้ายพนักงานที่เลือก">
      {sel.size > 0 && <><div className="row" style={{ marginBottom: 0 }}>
        <b>เลือกแล้ว {sel.size.toLocaleString()} คน</b>
        {pageAll && sel.size < total && <button className="sec" disabled={busy} onClick={selectAllMatching}>เลือกทั้งหมด {total.toLocaleString()} รายการที่ตรงตัวกรอง</button>}
        <select value={target} onChange={e => setTarget(e.target.value)} aria-label="บริษัท/สาขาปลายทาง" style={{ maxWidth: 420 }}><option value="">ย้ายไปบริษัท / สาขา...</option>{branches.map(b => <option key={b.id} value={b.id}>{b.clients?.name} / {b.name}</option>)}</select>
        <button disabled={busy || !target} onClick={move}>ย้ายที่เลือก</button>
        <button className="sec" disabled={busy} onClick={() => setSel(new Set())}>ยกเลิกการเลือก</button></div></>}
      {msg && <p className={msg.includes("ไม่สำเร็จ") ? "err" : "ok"} style={{ margin: sel.size ? "12px 0 0" : 0 }}>{msg}</p>}</div>}

    <div className="card flush"><table><thead><tr>
      <th style={{ width: 44 }}><input type="checkbox" aria-label="เลือกทั้งหน้า" checked={pageAll} onChange={togglePage} /></th>
      <th>รหัส</th><th>ชื่อ-สกุล</th><th>ตำแหน่ง</th><th>บริษัท / สาขา</th><th>สถานะ</th>{effSt === "resigned" && <><th>วันที่ลาออก</th><th>เหตุผลการลาออก</th></>}</tr></thead><tbody>
      {rows.map(r => <tr key={r.id}><td><input type="checkbox" aria-label={`เลือก ${r.employee_code}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
        <td><Link href={`/employee/${r.id}`}>{r.employee_code}</Link></td>
        <td>{r.title_th}{r.first_name_th} {r.last_name_th}</td><td>{r.position}</td>
        <td>{r.client_name} / {r.branch_name}</td><td><span className={BADGE[r.status]}>{STATUS[r.status]}</span></td>
        {effSt === "resigned" && <><td style={{ whiteSpace: "nowrap" }}>{r.resigned_at ? new Date(r.resigned_at).toLocaleDateString("th-TH") : "-"}</td><td>{r.resign_reason ?? "-"}</td></>}</tr>)}
      {!rows.length && !loading && <tr><td colSpan={8}>{searching ? "ไม่พบพนักงานที่ตรงกับคำค้น ลองพิมพ์เฉพาะบางส่วนของชื่อ หรือเปลี่ยนตัวกรองสถานะ/สาขา" : "ไม่พบพนักงาน หากยังไม่เห็นสาขาใดเลย ให้ติดต่อ Admin เพื่อกำหนดสิทธิ์"}</td></tr>}
    </tbody></table></div>
    <div className="row"><button className="sec" disabled={pg === 0} onClick={() => setPg(pg - 1)}>ก่อนหน้า</button>
      <span className="mut">หน้า {pg + 1} / {Math.max(1, Math.ceil(total / PER))}</span>
      <button className="sec" disabled={(pg + 1) * PER >= total} onClick={() => setPg(pg + 1)}>ถัดไป</button></div>
  </AppShell>;
}
