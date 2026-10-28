"use client";
import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import AppShell from "@/components/AppShell";
import PageHead from "@/components/PageHead";
import { sb } from "@/lib/supabase";
import { parseBlacklist, BLStat } from "@/lib/blacklistParse";

type Tab = "check" | "list" | "import";
const CAN_CHECK = ["admin", "multi_branch_manager", "branch_officer"], PER = 50;
const EMPTY = { title_th: "", first_name_th: "", last_name_th: "", employee_code: "", national_id: "", reason: "", listed_on: "", note: "" };

export default function Blacklist() {
  const [role, setRole] = useState<string | null>(null), [tab, setTab] = useState<Tab>("check"), [msg, setMsg] = useState(""), [bad, setBad] = useState(false);
  const say = (m: string, b = false) => { setMsg(m); setBad(b); };
  // check
  const [ck, setCk] = useState({ nid: "", first: "", last: "", code: "" }), [hits, setHits] = useState<any[] | null>(null), [busy, setBusy] = useState(false);
  // list
  const [rows, setRows] = useState<any[]>([]), [total, setTotal] = useState(0), [q, setQ] = useState(""), [st, setSt] = useState("active"), [pg, setPg] = useState(0), [tick, setTick] = useState(0);
  const [form, setForm] = useState<any>(null), [shown, setShown] = useState<Record<string, string>>({});
  // import
  const buf = useRef<ArrayBuffer | null>(null), [names, setNames] = useState<string[]>([]), [sheet, setSheet] = useState(""), [prev, setPrev] = useState<{ rows: any[]; st: BLStat; err: string } | null>(null), [pct, setPct] = useState(0), [res, setRes] = useState<any>(null);

  useEffect(() => { sb.auth.getUser().then(async ({ data }) => { if (!data.user) return setRole("");
    const { data: p } = await sb.from("profiles").select("role,active").eq("id", data.user.id).single(); setRole(p?.active ? p.role : ""); }); }, []);
  useEffect(() => { setPg(0); }, [q, st]);
  useEffect(() => { if (role !== "admin" || tab !== "list") return;
    let x: any = sb.from("blacklist").select("id,title_th,first_name_th,last_name_th,employee_code,national_id_last4,reason,listed_on,note,status,removed_reason,source", { count: "exact" }).order("first_name_th").range(pg * PER, pg * PER + PER - 1);
    if (st) x = x.eq("status", st);
    q.replace(/[%,()]/g, " ").split(/\s+/).filter(Boolean).forEach(t => { x = x.or(`first_name_th.ilike.%${t}%,last_name_th.ilike.%${t}%,employee_code.ilike.%${t}%${/^\d{4}$/.test(t) ? `,national_id_last4.eq.${t}` : ""}`); });
    x.then(({ data, count }: any) => { setRows(data ?? []); setTotal(count ?? 0); }); }, [role, tab, q, st, pg, tick]);

  if (role === null) return null;
  if (!CAN_CHECK.includes(role)) return <AppShell><p className="err">คุณไม่มีสิทธิ์ใช้งานเมนูนี้ ติดต่อ Admin</p></AppShell>;
  const admin = role === "admin";

  const check = async () => {
    const nid = ck.nid.replace(/\D/g, ""); setHits(null);
    if (ck.nid && nid.length !== 13) return say("เลขบัตรประชาชนต้องมี 13 หลัก", true);
    if (!nid && !ck.first.trim() && !ck.last.trim() && !ck.code.trim()) return say("กรอกอย่างน้อย 1 ช่อง (เลขบัตร ชื่อ นามสกุล หรือรหัสพนักงาน)", true);
    setBusy(true); say("");
    const { data, error } = await sb.rpc("check_blacklist", { p_national_id: nid || null, p_first: ck.first.trim() || null, p_last: ck.last.trim() || null, p_code: ck.code.trim() || null });
    setBusy(false); if (error) return say("ตรวจสอบไม่สำเร็จ: " + error.message, true); setHits(data ?? []); };
  const save = async () => {
    const f = form; const { data, error } = await sb.rpc("upsert_blacklist", { p_id: f.id ?? null, p_row: { ...f, listed_on: f.listed_on || null } });
    if (error) return say("บันทึกไม่สำเร็จ: " + error.message, true);
    say(data?.merged ? "มีรายการนี้อยู่แล้ว ระบบรวมข้อมูลเข้ากับรายการเดิม" : "บันทึกแล้ว"); setForm(null); setTick(t => t + 1); };
  const setStatus = async (r: any, status: "active" | "removed") => {
    let reason: string | null = null;
    if (status === "removed") { reason = window.prompt("เหตุผลที่ถอนออกจาก Blacklist (เช่น ตรวจสอบแล้วเป็นคนละคน)"); if (reason === null) return; }
    const { error } = await sb.rpc("set_blacklist_status", { p_id: r.id, p_status: status, p_reason: reason }); error ? say("ไม่สำเร็จ: " + error.message, true) : (say(status === "removed" ? "ถอนออกแล้ว" : "นำกลับแล้ว"), setTick(t => t + 1)); };
  const reveal = async (r: any) => { const { data, error } = await sb.rpc("reveal_blacklist_id", { p_id: r.id });
    if (error) return say("ดูไม่ได้: " + error.message, true); setShown(s => ({ ...s, [r.id]: data ?? "(ไม่มีเลขบัตร)" })); setTimeout(() => setShown(s => { const n = { ...s }; delete n[r.id]; return n; }), 30000); };
  const edit = async (r: any) => setForm({ ...EMPTY, ...r, title_th: r.title_th ?? "", last_name_th: r.last_name_th ?? "", employee_code: r.employee_code ?? "", reason: r.reason ?? "", listed_on: r.listed_on ?? "", note: r.note ?? "", national_id: "" });

  const pick = async (f?: File) => { if (!f) return; setPrev(null); setRes(null); say("กำลังอ่านไฟล์...");
    buf.current = await f.arrayBuffer(); const wb = XLSX.read(buf.current, { type: "array", bookSheets: true }); setNames(wb.SheetNames);
    setSheet(wb.SheetNames.find(n => ["backlist", "blacklist"].includes(n.trim().toLowerCase())) ?? ""); say(""); };
  const checkFile = async () => { setBusy(true); say("กำลังตรวจสอบ..."); await new Promise(r => setTimeout(r, 30));
    try { const wb = XLSX.read(buf.current!, { type: "array", sheets: [sheet] }); setPrev(parseBlacklist(wb.Sheets[sheet])); say(""); } catch (e: any) { say("อ่านไฟล์ไม่สำเร็จ: " + e.message, true); } setBusy(false); };
  const run = async () => { if (!prev) return; setBusy(true); setPct(0); let ins = 0, mrg = 0;
    for (let i = 0; i < prev.rows.length; i += 200) {
      const { data, error } = await sb.rpc("import_blacklist", { p_rows: prev.rows.slice(i, i + 200) });
      if (error) { say(`หยุดที่แถว ${i + 1}: ${error.message} (ที่นำเข้าแล้วคงอยู่ รันซ้ำได้ ระบบจะรวมกับรายการเดิม)`, true); setBusy(false); return; }
      ins += data.inserted; mrg += data.merged; setPct(Math.round(Math.min(i + 200, prev.rows.length) / prev.rows.length * 100)); }
    setRes({ ins, mrg }); setPrev(null); setBusy(false); say(""); };

  return <AppShell><PageHead title="Blacklist" subtitle="ตรวจสอบบุคคลก่อนรับเข้าทำงาน ข้อมูลอ่อนไหว เปิดดูเท่าที่จำเป็นและบันทึกประวัติทุกครั้ง" />
    <div className="row">{([["check", "ตรวจสอบบุคคล"], ...(admin ? [["list", "รายการทั้งหมด"], ["import", "นำเข้า Blacklist จาก Excel"]] : [])] as [Tab, string][]).map(([k, t]) =>
      <button key={k} className={tab === k ? "tab on" : "tab"} onClick={() => { setTab(k); say(""); }}>{t}</button>)}</div>
    {msg && <p className={bad ? "err" : "ok"} role="status">{msg}</p>}

    {tab === "check" && <><div className="card"><h2>ตรวจสอบบุคคล</h2>
      <p className="mut" style={{ marginTop: 0 }}>กรอกเท่าที่มี ค้นด้วยชื่อ หรือนามสกุลอย่างเดียว หรือบางส่วนของชื่อก็ได้ (ไม่สนคำนำหน้า) ระบบเทียบกับเลขบัตรประชาชน รหัสพนักงาน และชื่อ-สกุล และแสดงเฉพาะรายการที่ตรงกัน</p>
      <div className="grid">
        <label>เลขบัตรประชาชน (13 หลัก)<input inputMode="numeric" maxLength={13} value={ck.nid} onKeyDown={e => e.key === "Enter" && check()} onChange={e => setCk({ ...ck, nid: e.target.value })} /></label>
        <label>ชื่อ<input value={ck.first} onKeyDown={e => e.key === "Enter" && check()} onChange={e => setCk({ ...ck, first: e.target.value })} /></label>
        <label>นามสกุล<input value={ck.last} onKeyDown={e => e.key === "Enter" && check()} onChange={e => setCk({ ...ck, last: e.target.value })} /></label>
        <label>รหัสพนักงาน<input value={ck.code} onKeyDown={e => e.key === "Enter" && check()} onChange={e => setCk({ ...ck, code: e.target.value })} /></label></div>
      <p><button disabled={busy} onClick={check}>ตรวจสอบ</button></p></div>
      {hits && (hits.length ? <div className="card" style={{ borderColor: "#e3a3a3" }}><h2 className="err">⚠ พบ {hits[0]?.total ?? hits.length} รายการที่ตรงกัน{(hits[0]?.total ?? 0) > hits.length ? ` (แสดง ${hits.length} รายการแรก ลองระบุชื่อ/นามสกุลให้ครบเพื่อจำกัดผล)` : ""}</h2>
        {hits.map(h => <div key={h.bl_id} style={{ padding: "10px 0", borderTop: "1px solid #e2e8e5" }}>
          <b>{h.full_name}</b> {h.match_by.map((m: string) => <span key={m} className="badge draft" style={{ marginLeft: 6 }}>{m}</span>)}
          <div className="mut">รหัสพนักงาน: {h.emp_code ?? "-"} · เลขบัตร: {h.id_last4 ? `•••••••••${h.id_last4}` : "ไม่มีในรายการ"}{h.listed_on ? ` · ขึ้นรายการเมื่อ ${new Date(h.listed_on).toLocaleDateString("th-TH")}` : ""}</div>
          <div>เหตุผล: {h.reason ?? "-"}</div>
          {!h.match_by.some((m: string) => m.startsWith("เลขบัตร") || m.startsWith("รหัสพนักงาน")) && <small className="mut">จับคู่ด้วยชื่ออย่างเดียว อาจเป็นคนละคน ควรตรวจสอบเลขบัตรหรือเอกสารเพิ่มเติม</small>}</div>)}</div>
        : <div className="card"><h2 className="ok">ไม่พบรายการที่ตรงกัน</h2><p className="mut" style={{ margin: 0 }}>ผลนี้ไม่ได้ยืนยันว่าไม่เคยมีประวัติ เพราะบางรายการในรายชื่อไม่มีเลขบัตรหรือรหัสพนักงาน ถ้ากรอกเลขบัตรไม่ครบทุกช่อง ระบบเทียบได้เฉพาะช่องที่กรอก</p></div>)}</>}

    {tab === "list" && admin && <>
      {form && <div className="card"><h2>{form.id ? "แก้ไขรายชื่อ" : "เพิ่มรายชื่อ Blacklist"}</h2><div className="grid">
        <label>คำนำหน้า<input value={form.title_th} onChange={e => setForm({ ...form, title_th: e.target.value })} /></label>
        <label>ชื่อ<input value={form.first_name_th} onChange={e => setForm({ ...form, first_name_th: e.target.value })} /></label>
        <label>นามสกุล<input value={form.last_name_th} onChange={e => setForm({ ...form, last_name_th: e.target.value })} /></label>
        <label>รหัสพนักงาน<input value={form.employee_code} onChange={e => setForm({ ...form, employee_code: e.target.value })} /></label>
        <label>เลขบัตรประชาชน{form.id ? " (เว้นว่าง = ไม่เปลี่ยน)" : ""}<input inputMode="numeric" maxLength={13} value={form.national_id} onChange={e => setForm({ ...form, national_id: e.target.value })} /></label>
        <label>วันที่ขึ้นรายการ<input type="date" value={form.listed_on} onChange={e => setForm({ ...form, listed_on: e.target.value })} /></label>
        <label>เหตุผล<input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></label>
        <label>หมายเหตุ<input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label></div>
        <div className="row" style={{ marginTop: 12 }}><button onClick={save}>บันทึก</button><button className="sec" onClick={() => setForm(null)}>ยกเลิก</button></div></div>}
      <div className="card"><div className="row" style={{ marginBottom: 0 }}>
        <input placeholder="ค้นหาชื่อ นามสกุล รหัสพนักงาน หรือเลขท้ายบัตร 4 หลัก (พิมพ์ได้หลายคำ)" value={q} onChange={e => setQ(e.target.value)} />
        <select value={st} onChange={e => setSt(e.target.value)} aria-label="สถานะ"><option value="active">ใช้งาน</option><option value="removed">ถอนออกแล้ว</option><option value="">ทั้งหมด</option></select>
        <button onClick={() => setForm({ ...EMPTY })}>เพิ่มรายชื่อ</button></div></div>
      <div className="card flush"><table><thead><tr><th>ชื่อ-สกุล</th><th>รหัสพนักงาน</th><th>เลขบัตร</th><th>เหตุผล</th><th>สถานะ</th><th></th></tr></thead><tbody>
        {rows.map(r => <tr key={r.id}><td>{[r.title_th, r.first_name_th, r.last_name_th].filter(Boolean).join(" ")}</td><td>{r.employee_code ?? "-"}</td>
          <td>{shown[r.id] ?? (r.national_id_last4 ? `•••••••••${r.national_id_last4}` : "ไม่มี")}</td><td>{r.reason}{r.status === "removed" && r.removed_reason ? <small> (ถอนออก: {r.removed_reason})</small> : null}</td>
          <td><span className={r.status === "active" ? "badge draft" : "badge"}>{r.status === "active" ? "ใช้งาน" : "ถอนออก"}</span></td>
          <td><div className="row" style={{ marginBottom: 0 }}><button className="sec" onClick={() => edit(r)}>แก้ไข</button>
            {r.national_id_last4 && !shown[r.id] && <button className="sec" onClick={() => reveal(r)}>ดูเลขบัตรเต็ม</button>}
            <button className="sec" onClick={() => setStatus(r, r.status === "active" ? "removed" : "active")}>{r.status === "active" ? "ถอนออก" : "นำกลับ"}</button></div></td></tr>)}
        {!rows.length && <tr><td colSpan={6}>ไม่พบรายการ</td></tr>}</tbody></table></div>
      <div className="row"><button className="sec" disabled={pg === 0} onClick={() => setPg(pg - 1)}>ก่อนหน้า</button><span className="mut">หน้า {pg + 1} / {Math.max(1, Math.ceil(total / PER))} · {total.toLocaleString()} รายการ</span><button className="sec" disabled={(pg + 1) * PER >= total} onClick={() => setPg(pg + 1)}>ถัดไป</button></div></>}

    {tab === "import" && admin && <><div className="card"><h2>1. เลือกไฟล์และชีต</h2>
      <input type="file" accept=".xlsx" onChange={e => pick(e.target.files?.[0])} />
      {!!names.length && <p><label>ชีตที่เป็นรายชื่อ Blacklist<select value={sheet} onChange={e => { setSheet(e.target.value); setPrev(null); }}><option value="">เลือกชีต</option>{names.map(n => <option key={n}>{n}</option>)}</select></label></p>}
      <p className="mut">ไม่ต้องมีรหัสหรือเลขบัตรครบ ระบบรวมแถวที่เป็นคนเดียวกัน (เลขบัตรเดียวกัน หรือชื่อเดียวกันที่ไม่มีข้อมูลขัดแย้ง) และไม่ทับข้อมูลเดิม นำเข้าซ้ำได้</p>
      <button disabled={busy || !sheet} onClick={checkFile}>ตรวจสอบก่อนนำเข้า</button></div>
      {prev && <div className="card"><h2>2. ผลตรวจสอบ</h2>{prev.err && <p className="err">{prev.err}</p>}
        <div className="tbl"><table><tbody>
          <tr><td>รายชื่อที่อ่านได้</td><td className="num"><b>{prev.st.total.toLocaleString()}</b></td></tr>
          <tr><td>มีเลขบัตรประชาชน</td><td className="num">{prev.st.withId.toLocaleString()}</td></tr>
          <tr><td>มีรหัสพนักงาน</td><td className="num">{prev.st.withCode.toLocaleString()}</td></tr>
          <tr><td>มีเฉพาะชื่อ (ไม่มีรหัส/เลขบัตร)</td><td className="num">{prev.st.nameOnly.toLocaleString()}</td></tr>
          <tr><td>เลขบัตรซ้ำกันในไฟล์ (จะรวมเป็นรายการเดียว)</td><td className="num">{prev.st.dupId.toLocaleString()}</td></tr>
          <tr><td>เลขบัตรไม่ครบ 13 หลัก (นำเข้าโดยไม่มีเลขบัตร)</td><td className="num">{prev.st.badId.toLocaleString()}</td></tr>
          <tr><td>เลขบัตรครบ 13 หลักแต่ตัวเลขตรวจสอบไม่ผ่าน (นำเข้า เพราะใช้เทียบอย่างเดียว)</td><td className="num">{prev.st.checksumBad.toLocaleString()}</td></tr>
          <tr><td>แถวที่ไม่มีชื่อ (ข้าม)</td><td className="num">{prev.st.skipped.toLocaleString()}</td></tr></tbody></table></div>
        {busy && <div className="bar"><i style={{ width: pct + "%" }} /></div>}
        <p><button disabled={busy || !prev.rows.length} onClick={run}>นำเข้า {prev.rows.length.toLocaleString()} แถว</button></p></div>}
      {res && <div className="card"><h2>นำเข้าเสร็จแล้ว</h2><p className="ok">เพิ่มรายการใหม่ {res.ins.toLocaleString()} · รวมกับรายการเดิม {res.mrg.toLocaleString()}</p></div>}</>}
  </AppShell>;
}
