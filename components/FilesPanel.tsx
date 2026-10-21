"use client";
import { useCallback, useEffect, useState } from "react";
import { sb } from "@/lib/supabase";

const BUCKET = "namelist-files", MAX = 20 * 1024 * 1024;
const EXT: Record<string, string> = {
  "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx" };
const fmt = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

type P = { scope: "employee" | "client"; ownerId: string; branchId?: string; categories: string[]; pdfOnly?: boolean };

export default function FilesPanel({ scope, ownerId, branchId, categories, pdfOnly }: P) {
  const [docs, setDocs] = useState<any[]>([]), [canEdit, setCanEdit] = useState(false), [canSens, setCanSens] = useState(false);
  const [file, setFile] = useState<File | null>(null), [cat, setCat] = useState(categories[0]), [title, setTitle] = useState(""), [sens, setSens] = useState(false);
  const [msg, setMsg] = useState(""), [bad, setBad] = useState(false), [busy, setBusy] = useState(false), [filter, setFilter] = useState(""), [key, setKey] = useState(0);
  const say = (m: string, b = false) => { setMsg(m); setBad(b); };
  const col = scope === "employee" ? "employee_id" : "client_id";

  const load = useCallback(async () => {
    const { data } = await sb.from("documents").select("*").eq(col, ownerId).order("created_at", { ascending: false });
    setDocs(data ?? []);
  }, [col, ownerId]);

  useEffect(() => {
    load();
    if (scope === "employee" && branchId) {
      sb.rpc("my_can_edit_branch", { b: branchId }).then(({ data }) => setCanEdit(!!data));
      sb.rpc("my_can_sensitive", { b: branchId }).then(({ data }) => setCanSens(!!data));
    }
    if (scope === "client") sb.rpc("my_can_edit_client", { c: ownerId }).then(({ data }) => setCanEdit(!!data));
  }, [load, scope, branchId, ownerId]);

  const upload = async () => {
    if (!file) return say("เลือกไฟล์ก่อน", true);
    const mime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
    if (pdfOnly ? mime !== "application/pdf" : !EXT[mime]) return say(pdfOnly ? "รองรับเฉพาะไฟล์ PDF" : "รองรับ PDF, Word (.docx), Excel (.xlsx), PNG, JPG", true);
    if (file.size > MAX) return say("ไฟล์ใหญ่เกิน 20 MB", true);
    setBusy(true); say("");
    const path = `${scope === "employee" ? "employees" : "clients"}/${ownerId}/${crypto.randomUUID()}.${EXT[mime]}`;
    const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: mime, upsert: false });
    if (up.error) { setBusy(false); return say("อัปโหลดไม่สำเร็จ: " + up.error.message, true); }
    const ins = await sb.from("documents").insert({ scope, [col]: ownerId, category: cat, title: title.trim() || file.name, file_path: path,
      file_name: file.name, mime, size: file.size, sensitive: scope === "employee" && sens });
    if (ins.error) { await sb.storage.from(BUCKET).remove([path]); setBusy(false); return say("บันทึกรายการไม่สำเร็จ: " + ins.error.message, true); }
    setFile(null); setTitle(""); setSens(false); setKey(k => k + 1); setBusy(false); say("อัปโหลดแล้ว"); load();
  };

  const log = (d: any, action: string) => { sb.from("audit_log").insert({ action, record_id: d.id, detail: { title: d.title } }).then(() => {}); };
  const signed = async (d: any, download?: boolean) => {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(d.file_path, 120, download ? { download: d.file_name } : undefined);
    if (error || !data) { say("เปิดไฟล์ไม่สำเร็จ: " + (error?.message ?? ""), true); return null; }
    return data.signedUrl;
  };
  const view = async (d: any) => {
    const w = window.open("", "_blank"); const u = await signed(d);
    if (!u) return w?.close(); if (w) w.location.href = u; else window.location.href = u; log(d, "open_file");
  };
  const download = async (d: any) => { const u = await signed(d, true); if (u) { window.location.href = u; log(d, "download_file"); } };
  const remove = async (d: any) => {
    if (!window.confirm(`ลบไฟล์ "${d.title}" ถาวรใช่หรือไม่?`)) return;
    // ลบไฟล์ใน Storage ก่อน (ไฟล์มองเห็นได้เฉพาะตอนที่ยังมีแถวเอกสาร) แล้วค่อยลบแถวเอกสาร
    const f = await sb.storage.from(BUCKET).remove([d.file_path]);
    if (f.error || !f.data?.length) return say("ลบไม่สำเร็จ (ไม่มีสิทธิ์แก้ไข)", true);
    const r = await sb.from("documents").delete().eq("id", d.id).select("id");
    if (r.error || !r.data?.length) return say("ลบรายการไม่สำเร็จ กรุณาแจ้ง Admin", true);
    say("ลบแล้ว"); load();
  };

  const shown = filter ? docs.filter(d => d.category === filter) : docs;
  return <div className="card"><h2>เอกสารแนบ{pdfOnly ? " (PDF)" : ""}</h2>
    {categories.length > 1 && <div className="row"><select value={filter} onChange={e => setFilter(e.target.value)} aria-label="กรองประเภทเอกสาร"><option value="">ทุกประเภท</option>{categories.map(c => <option key={c}>{c}</option>)}</select></div>}
    <div className="tbl"><table><thead><tr><th>ชื่อเอกสาร</th><th>ประเภท</th><th>ขนาด</th><th>วันที่แนบ</th><th></th></tr></thead><tbody>
      {shown.map(d => <tr key={d.id}><td>{d.title} {d.sensitive && <span className="badge draft">อ่อนไหว</span>}<br /><small>{d.file_name}</small></td>
        <td>{d.category}</td><td>{fmt(d.size)}</td><td>{new Date(d.created_at).toLocaleDateString("th-TH")}</td>
        <td><div className="row" style={{ marginBottom: 0 }}><button className="sec" onClick={() => view(d)}>เปิดดู</button><button className="sec" onClick={() => download(d)}>ดาวน์โหลด</button>
          {canEdit && <button className="sec" onClick={() => remove(d)}>ลบ</button>}</div></td></tr>)}
      {!shown.length && <tr><td colSpan={5}>ยังไม่มีเอกสาร</td></tr>}</tbody></table></div>
    {canEdit ? <div style={{ marginTop: 16 }}><h2 style={{ fontSize: 16 }}>แนบเอกสารใหม่</h2><div className="grid">
      <label>ไฟล์ (ไม่เกิน 20 MB){!pdfOnly && <small> PDF, Word, Excel, PNG, JPG</small>}<input key={key} type="file" accept={pdfOnly ? ".pdf,application/pdf" : ".pdf,.docx,.xlsx,.png,.jpg,.jpeg"} onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
      <label>ประเภท<select value={cat} onChange={e => setCat(e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
      <label>ชื่อเอกสาร (ไม่กรอก = ใช้ชื่อไฟล์)<input value={title} onChange={e => setTitle(e.target.value)} /></label></div>
      {scope === "employee" && canSens && <label style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><input type="checkbox" checked={sens} onChange={e => setSens(e.target.checked)} />
        ไฟล์อ่อนไหว (เช่น สำเนาบัตรประชาชน/สมุดบัญชี) เห็นได้เฉพาะผู้มีสิทธิ์ดูเลขเต็ม</label>}
      <p><button disabled={busy || !file} onClick={upload}>{busy ? "กำลังอัปโหลด..." : "อัปโหลด"}</button></p></div>
      : <p className="mut">คุณมีสิทธิ์ดูและดาวน์โหลดเท่านั้น</p>}
    {msg && <p className={bad ? "err" : "ok"} role="status">{msg}</p>}
  </div>;
}
