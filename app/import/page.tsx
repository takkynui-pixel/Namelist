"use client";
import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import AppShell from "@/components/AppShell";
import PageHead from "@/components/PageHead";
import { sb } from "@/lib/supabase";

const MAIN = ["VTA", "O", "โบทานี่", "ไพร์มแอ็กซิส", "ตรวจประวัติ", "ลาออก"];
const norm = (v: any) => String(v ?? "").replace(/\s+/g, "");
const str = (v: any) => { if (v == null) return null; const s = String(v).trim(); return !s || s.startsWith("#") || s === "-" ? null : s; };
const digits = (v: any, min: number) => { if (v == null) return null; const s = (typeof v === "number" ? String(Math.round(v)) : String(v)).replace(/\D/g, ""); return s.length >= min ? s : null; };
const dt = (v: any, a: number, b: number) => { if (!(v instanceof Date) || isNaN(+v)) return null; const x = new Date(+v + 12 * 3600e3), y = x.getUTCFullYear(); return y >= a && y <= b ? x.toISOString().slice(0, 10) : null; };
const thaiId = (n: string | null) => { if (!n || !/^\d{13}$/.test(n)) return false; let s = 0; for (let i = 0; i < 12; i++) s += +n[i] * (13 - i); return (11 - (s % 11)) % 10 === +n[12]; };

type Stat = { sheet: string; total: number; ok: number; noName: number; badId: number; badBirth: number; badHire: number; dup: number; noResign: number; why: number; dupCodes: string[] };

function parse(ws: XLSX.WorkSheet, sheet: string, branch_id: string, seen: Set<string>, bank: Map<string, any>) {
  const g: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  const hi = g.slice(0, 8).findIndex(r => norm(r[1]).startsWith("รหัสพนักงาน"));
  const st: Stat = { sheet, total: 0, ok: 0, noName: 0, badId: 0, badBirth: 0, badHire: 0, dup: 0, noResign: 0, why: 0, dupCodes: [] };
  if (hi < 0) return { rows: [], st, err: "ไม่พบแถวหัวตาราง (คอลัมน์ B ต้องเป็น \"รหัสพนักงาน\")" };
  const h = g[hi], col = (f: (t: string, i: number) => boolean) => h.findIndex((x, i) => f(norm(x), i));
  const cPhone = col(t => t.startsWith("เบอร์โทรศัพท์")), cEn = col((t, i) => i > 20 && t.startsWith("ชื่อ-สกุล") && t.includes("ติดต่อฉุก")),
    cRel = col((t, i) => i > 20 && t.startsWith("ความสัมพันธ์")), cEp = col(t => t.startsWith("เบอร์โทรฉุกเฉิน")),
    cBank = col(t => t.startsWith("บัญชีธนาคาร")), cRes = col(t => t.startsWith("วันที่ลาออก")), cWhy = col(t => t.startsWith("เหตุผลการลาออก"));
  const posIsTitle = norm(h[17]).includes("ตำแหน่ง"), resigned = sheet === "ลาออก", rows: any[] = [];
  for (const r of g.slice(hi + 2)) {
    const code = str(r[1]); if (!code || code.length > 20 || norm(code).startsWith("รหัสพนักงาน")) continue;
    st.total++;
    const first = str(r[7]); if (!first) { st.noName++; continue; }
    if (seen.has(code)) { st.dup++; if (st.dupCodes.length < 20) st.dupCodes.push(code); continue; } seen.add(code);
    let nid = digits(r[5], 13)?.slice(0, 13) ?? null; if (nid && !thaiId(nid)) { st.badId++; nid = null; } else if (!nid && r[5] != null && str(r[5])) st.badId++;
    const birth = dt(r[23], 1930, 2012), hire = dt(r[13], 1980, 2030);
    if (r[23] instanceof Date && !birth) st.badBirth++; if (r[13] instanceof Date && !hire) st.badHire++;
    const rd = resigned && cRes >= 0 ? dt(r[cRes], 1990, 2030) : null, why = resigned && cWhy >= 0 ? (str(r[cWhy])?.slice(0, 500) ?? null) : null;
    if (resigned) { if (!rd) st.noResign++; if (why) st.why++; }
    const b = bank.get(code), v17 = str(r[17]);
    rows.push({ code, branch_id, status: resigned ? "resigned" : "active", title_th: str(r[6]), first_name_th: first, last_name_th: str(r[8]),
      first_name_en: str(r[10]), last_name_en: str(r[11]), nickname: str(r[12]), birth_date: birth, hire_date: hire,
      position: posIsTitle ? v17 : null, section: posIsTitle ? null : v17, cost_center: str(r[18]),
      phone: cPhone >= 0 ? str(r[cPhone]) : null, emergency_name: cEn >= 0 ? str(r[cEn]) : null, emergency_relation: cRel >= 0 ? str(r[cRel]) : null,
      emergency_phone: cEp >= 0 ? str(r[cEp]) : null, national_id: nid,
      bank_account: (cBank >= 0 ? digits(r[cBank], 6) : null) ?? b?.acct ?? null, bank_name: b?.name ?? null,
      resign_date: rd, resign_reason: why });
    st.ok++;
  }
  return { rows, st, err: "" };
}

export default function Import() {
  const [ok, setOk] = useState<boolean | null>(null), buf = useRef<ArrayBuffer | null>(null);
  const [branches, setBranches] = useState<any[]>([]), [names, setNames] = useState<string[]>([]), [sel, setSel] = useState<Record<string, boolean>>({}), [map, setMap] = useState<Record<string, string>>({});
  const [useBank, setUseBank] = useState(true), [prev, setPrev] = useState<{ rows: any[]; stats: Stat[]; errs: string[] } | null>(null);
  const [busy, setBusy] = useState(false), [pct, setPct] = useState(0), [res, setRes] = useState<{ inserted: number; updated: number; skipped: string[] } | null>(null), [msg, setMsg] = useState("");

  useEffect(() => { sb.auth.getUser().then(async ({ data }) => { if (!data.user) return setOk(false);
    const { data: p } = await sb.from("profiles").select("role").eq("id", data.user.id).single(); setOk(p?.role === "admin");
    if (p?.role === "admin") sb.from("branches").select("id,name,clients(name)").order("name").then(({ data }) => setBranches(data ?? [])); }); }, []);
  if (ok === null) return null;
  if (!ok) return <AppShell><p className="err">หน้านี้สำหรับ Admin เท่านั้น</p></AppShell>;

  const pick = async (f?: File) => { if (!f) return; setPrev(null); setRes(null); setMsg("กำลังอ่านไฟล์...");
    buf.current = await f.arrayBuffer(); const wb = XLSX.read(buf.current, { type: "array", bookSheets: true });
    setNames(wb.SheetNames); setSel(Object.fromEntries(wb.SheetNames.map(n => [n, MAIN.includes(n)]))); setMsg(""); };
  const chosen = names.filter(n => sel[n]), needBranch = chosen.filter(n => !map[n]);

  const check = async () => { setBusy(true); setMsg("กำลังตรวจสอบ (ไฟล์ใหญ่อาจใช้เวลาสักครู่)..."); setRes(null);
    await new Promise(r => setTimeout(r, 50));
    try { const want = [...chosen, ...(useBank && names.includes("BANK") ? ["BANK"] : [])];
      const wb = XLSX.read(buf.current!, { type: "array", cellDates: true, sheets: want });
      const bank = new Map<string, any>();
      if (wb.Sheets["BANK"]) for (const r of (XLSX.utils.sheet_to_json(wb.Sheets["BANK"], { header: 1, raw: true, defval: null, blankrows: false }) as any[][]).slice(1)) { const c = str(r[0]), a = digits(r[4], 6); if (c && a && !bank.has(c)) bank.set(c, { acct: a, name: str(r[5]) }); }
      const seen = new Set<string>(), rows: any[] = [], stats: Stat[] = [], errs: string[] = [];
      const order = [...chosen.filter(n => n !== "ลาออก"), ...chosen.filter(n => n === "ลาออก")];
      for (const n of order) { const x = parse(wb.Sheets[n], n, map[n], seen, bank); rows.push(...x.rows); stats.push(x.st); if (x.err) errs.push(`${n}: ${x.err}`); }
      setPrev({ rows, stats, errs }); setMsg("");
    } catch (e: any) { setMsg("อ่านไฟล์ไม่สำเร็จ: " + e.message); } setBusy(false); };

  const run = async () => { if (!prev) return; setBusy(true); setPct(0); let ins = 0, upd = 0; const skipped: string[] = [], B = 150;
    for (let i = 0; i < prev.rows.length; i += B) {
      const { data, error } = await sb.rpc("import_employees", { p_rows: prev.rows.slice(i, i + B) });
      if (error) { setMsg(`หยุดที่แถว ${i + 1}: ${error.message} (ที่นำเข้าไปแล้วคงอยู่ รันซ้ำได้ ระบบจะข้ามรหัสที่มีแล้ว)`); setBusy(false); return; }
      ins += data.inserted; upd += data.updated ?? 0; skipped.push(...data.skipped); setPct(Math.round(Math.min(i + B, prev.rows.length) / prev.rows.length * 100)); }
    setRes({ inserted: ins, updated: upd, skipped }); setPrev(null); setBusy(false); setMsg(""); };

  return <AppShell><PageHead title="นำเข้าพนักงานจาก Excel" subtitle="ไฟล์ถูกอ่านในเบราว์เซอร์ของคุณ ข้อมูลส่งตรงเข้า Supabase และเลขบัตร/บัญชีถูกเข้ารหัสทันที" />
    <div className="card"><h2>1. เลือกไฟล์</h2><input type="file" accept=".xlsx" onChange={e => pick(e.target.files?.[0])} />
      <p className="mut">ไม่ทับข้อมูลเดิม: รหัสพนักงานที่มีในระบบแล้วจะถูกข้าม ชีต <b>backlist</b> และ <b>บช Backlist</b> ยังไม่นำเข้าเพราะไม่มีรหัสพนักงานครบ</p></div>
    {!!names.length && <div className="card"><h2>2. เลือกชีตและสาขาปลายทาง</h2>
      {!branches.length && <p className="err">ยังไม่มีสาขา ไปสร้างที่ จัดการระบบ → บริษัทและสาขา ก่อน</p>}
      <table><thead><tr><th></th><th>ชีต</th><th>สาขาปลายทาง</th></tr></thead><tbody>{names.filter(n => n !== "BANK").map(n => <tr key={n}>
        <td><input type="checkbox" aria-label={n} checked={!!sel[n]} onChange={e => setSel({ ...sel, [n]: e.target.checked })} /></td><td>{n}{n === "ลาออก" && <small> (ตั้งสถานะพ้นสภาพ พร้อมวันที่และเหตุผลการลาออก)</small>}</td>
        <td>{sel[n] && <select value={map[n] ?? ""} onChange={e => setMap({ ...map, [n]: e.target.value })}><option value="">เลือกสาขา</option>{branches.map(b => <option key={b.id} value={b.id}>{b.clients?.name} / {b.name}</option>)}</select>}</td></tr>)}</tbody></table>
      {names.includes("BANK") && <p><label style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}><input type="checkbox" checked={useBank} onChange={e => setUseBank(e.target.checked)} /> ใช้ชีต BANK เติมชื่อธนาคารและเลขบัญชี</label></p>}
      <p className="mut">ชีตแต่ละชีตเป็นระดับนายจ้าง ไม่ได้ระบุบริษัทลูกค้า จึงต้องเลือกสาขาให้แต่ละชีตก่อน แล้วค่อยย้ายสาขารายคนในหน้าพนักงาน</p>
      <button disabled={busy || !chosen.length || !!needBranch.length} onClick={check}>ตรวจสอบก่อนนำเข้า</button></div>}
    {msg && <p className={msg.includes("ไม่สำเร็จ") || msg.includes("หยุด") ? "err" : "mut"}>{msg}</p>}
    {prev && <div className="card"><h2>3. ผลตรวจสอบ</h2>{prev.errs.map(e => <p key={e} className="err">{e}</p>)}
      <div className="tbl"><table><thead><tr><th>ชีต</th><th className="num">พบ</th><th className="num">พร้อมนำเข้า</th><th className="num">ไม่มีชื่อ</th><th className="num">รหัสซ้ำในไฟล์</th><th className="num">เลขบัตรผิด (นำเข้าโดยไม่มีเลข)</th><th className="num">วันเกิด/เริ่มงานผิด (ปล่อยว่าง)</th><th className="num">ไม่มีวันที่ลาออก</th><th className="num">มีเหตุผลการลาออก</th></tr></thead><tbody>
        {prev.stats.map(s => <tr key={s.sheet}><td>{s.sheet}</td><td className="num">{s.total}</td><td className="num">{s.ok}</td><td className="num">{s.noName}</td><td className="num">{s.dup}</td><td className="num">{s.badId}</td><td className="num">{s.badBirth + s.badHire}</td><td className="num">{s.sheet === "ลาออก" ? s.noResign : "-"}</td><td className="num">{s.sheet === "ลาออก" ? s.why : "-"}</td></tr>)}</tbody></table></div>
      {prev.stats.some(s => s.dupCodes.length > 0) && <p className="mut">รหัสที่ซ้ำกับชีตอื่น จะใช้ข้อมูลจากชีตที่อยู่ก่อน (ตัวอย่าง): <small>{[...new Set(prev.stats.flatMap(s => s.dupCodes))].slice(0, 20).join(", ")}</small></p>}
      <p>รวมนำเข้า <b>{prev.rows.length.toLocaleString()}</b> คน</p>
      {busy && <div className="bar"><i style={{ width: pct + "%" }} /></div>}
      <button disabled={busy || !prev.rows.length} onClick={run}>นำเข้า {prev.rows.length.toLocaleString()} คน</button></div>}
    {res && <div className="card"><h2>นำเข้าเสร็จแล้ว</h2><p className="ok">เพิ่มสำเร็จ {res.inserted.toLocaleString()} คน</p>
      {res.updated > 0 && <p className="ok">เติมวันที่/เหตุผลการลาออกให้พนักงานที่มีอยู่แล้ว {res.updated.toLocaleString()} คน</p>}
      {!!res.skipped.length && <p>ข้าม {res.skipped.length} รหัสที่มีในระบบอยู่แล้ว: <small>{res.skipped.slice(0, 30).join(", ")}{res.skipped.length > 30 ? " ..." : ""}</small></p>}</div>}
  </AppShell>;
}
