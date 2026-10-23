"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { sb, STATUS } from "@/lib/supabase";
import AppShell from "@/components/AppShell";
import PageHead from "@/components/PageHead";
import FilesPanel from "@/components/FilesPanel";

const F: [string, string][] = [["employee_code","รหัสพนักงาน"],["title_th","คำนำหน้า"],["first_name_th","ชื่อ"],["last_name_th","นามสกุล"],["first_name_en","First name"],["last_name_en","Last name"],["nickname","ชื่อเล่น"],["birth_date","วันเกิด"],["hire_date","วันเริ่มงาน"],["phone","โทรศัพท์"],["position","ตำแหน่ง"],["section","Section"],["cost_center","Cost center"],["emergency_name","ผู้ติดต่อฉุกเฉิน"],["emergency_phone","โทรฉุกเฉิน"]];

export default function Emp() {
  const { id } = useParams<{ id: string }>(), router = useRouter(), isNew = id === "new";
  const [e, setE] = useState<any>({ status: "active" }), [branches, setBranches] = useState<any[]>([]), [hist, setHist] = useState<any[]>([]);
  const [msg, setMsg] = useState(""), [pii, setPii] = useState<any>(null), [nid, setNid] = useState(""), [bank, setBank] = useState(""), [bn, setBn] = useState("");

  useEffect(() => { sb.from("branches").select("id,name,clients(name)").then(({ data }) => setBranches(data ?? []));
    if (!isNew) { sb.from("employees").select("*").eq("id", id).single().then(({ data }) => data && setE(data));
      sb.from("employment_history").select("*").eq("employee_id", id).order("created_at", { ascending: false }).then(({ data }) => setHist(data ?? [])); } }, [id]);

  const save = async () => {
    const { id: _i, created_at, updated_at, created_by, ...body } = e;
    if (body.status !== "resigned") { body.resigned_at = null; body.resign_reason = null; }
    else if (!body.resigned_at) return setMsg("กรอกวันที่ลาออก");
    for (const k in body) if (body[k] === "") body[k] = null;
    const r = isNew ? await sb.from("employees").insert(body).select("id").single() : await sb.from("employees").update(body).eq("id", id).select("id").single();
    if (r.error) return setMsg("บันทึกไม่สำเร็จ: " + r.error.message);
    if (nid || bank) { const p = await sb.rpc("set_sensitive", { p_emp: r.data.id, p_nid: nid, p_bank_name: bn, p_bank_acct: bank });
      if (p.error) return setMsg("บันทึกข้อมูลสำคัญไม่สำเร็จ: " + p.error.message); }
    setMsg("บันทึกแล้ว"); if (isNew) router.replace(`/employee/${r.data.id}`);
  };
  const reveal = async () => { const { data, error } = await sb.rpc("reveal_sensitive", { p_emp: id });
    if (error) return setMsg("ไม่สามารถดูได้: " + error.message);
    setPii(data?.[0] ?? {}); setTimeout(() => setPii(null), 30000); };

  return <AppShell><PageHead back={{ href: "/", label: "กลับรายชื่อ" }} title={isNew ? "เพิ่มพนักงาน" : `${e.first_name_th ?? ""} ${e.last_name_th ?? ""}`} subtitle={isNew ? undefined : e.employee_code} />
    <div className="card"><div className="grid">
      <label>สาขา<select value={e.branch_id ?? ""} onChange={x => setE({ ...e, branch_id: x.target.value })}><option value="">เลือกสาขา</option>{branches.map(b => <option key={b.id} value={b.id}>{b.clients?.name} / {b.name}</option>)}</select></label>
      <label>สถานะ<select value={e.status} onChange={x => setE({ ...e, status: x.target.value, ...(x.target.value === "resigned" && !e.resigned_at ? { resigned_at: new Date().toISOString().slice(0, 10) } : {}) })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {F.map(([k, t]) => <label key={k}>{t}<input type={k.includes("date") ? "date" : "text"} value={e[k] ?? ""} onChange={x => setE({ ...e, [k]: x.target.value })} /></label>)}
    </div></div>
    {e.status === "resigned" && <div className="card"><h2>การลาออก / พ้นสภาพ</h2><div className="grid">
      <label>วันที่ลาออก<input type="date" value={e.resigned_at ?? ""} onChange={x => setE({ ...e, resigned_at: x.target.value })} /></label>
      <label>เหตุผลการลาออก<input value={e.resign_reason ?? ""} onChange={x => setE({ ...e, resign_reason: x.target.value })} /></label></div></div>}
    <div className="card"><h2>ข้อมูลสำคัญ</h2>
      {!isNew && <p>เลขบัตรประชาชน: {pii ? pii.national_id : `•••••••••${e.national_id_last4 ?? ""}`} · บัญชี: {pii ? `${pii.bank_name ?? ""} ${pii.bank_account}` : `••••••${e.bank_last4 ?? ""}`}
        {" "}{pii ? <button className="sec" onClick={() => setPii(null)}>ซ่อน</button> : <button className="sec" onClick={reveal}>ดูข้อมูลเต็ม (ระบบบันทึกการดู)</button>}</p>}
      <div className="grid"><label>เลขบัตรประชาชน (กรอกเมื่อต้องการตั้งหรือแก้)<input inputMode="numeric" maxLength={13} value={nid} onChange={x => setNid(x.target.value)} /></label>
      <label>ธนาคาร<input value={bn} onChange={x => setBn(x.target.value)} /></label>
      <label>เลขบัญชี<input inputMode="numeric" value={bank} onChange={x => setBank(x.target.value)} /></label></div></div>
    <button onClick={save}>บันทึก</button> <span className={msg.includes("ไม่") ? "err" : ""}>{msg}</span>
    {!!hist.length && <div className="card"><h2>ประวัติการจ้าง</h2><table><tbody>{hist.map(h => <tr key={h.id}><td>{h.effective_date}</td><td>{h.event_type}</td><td>{h.reason}</td></tr>)}</tbody></table></div>}
    {!isNew && e.branch_id && <FilesPanel scope="employee" ownerId={id} branchId={e.branch_id} categories={["ประวัติพนักงาน", "สัญญาจ้าง", "เอกสารส่วนตัว", "อื่นๆ"]} pdfOnly />}
  </AppShell>;
}
