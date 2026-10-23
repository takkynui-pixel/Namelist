"use client";
import { useEffect, useState } from "react";
import { sb } from "@/lib/supabase";
import AppShell from "@/components/AppShell";
import PageHead from "@/components/PageHead";

const ROLES: Record<string, string> = { admin: "Admin", multi_branch_manager: "ผู้จัดการหลายสาขา", branch_officer: "เจ้าหน้าที่สาขา", viewer: "ดูอย่างเดียว" };
type Tab = "users" | "orgs" | "audit";
const ACT: Record<string, string> = { reveal_sensitive: "ดูเลขบัตรประชาชน/บัญชีธนาคารแบบเต็ม", set_sensitive: "บันทึกเลขบัตรประชาชน/บัญชีธนาคาร", import_employees: "นำเข้าพนักงานจาก Excel",
  bulk_move: "ย้ายพนักงานหลายคนไปสาขาใหม่", perm_insert: "ให้สิทธิ์เข้าถึงสาขา", perm_update: "แก้ไขสิทธิ์รายสาขา", perm_delete: "ยกเลิกสิทธิ์เข้าถึงสาขา", invite_user: "เชิญผู้ใช้ใหม่",
  admin_set_password: "ตั้งรหัสผ่านให้ผู้ใช้", admin_send_reset: "ส่งลิงก์ตั้งรหัสผ่านให้ผู้ใช้", open_file: "เปิดดูไฟล์แนบ", download_file: "ดาวน์โหลดไฟล์แนบ",
  add_clients: "เพิ่มบริษัทใหม่", edit_clients: "แก้ไขข้อมูลบริษัท", add_service_branches: "เพิ่มสาขา VTA ใหม่", edit_service_branches: "แก้ไขข้อมูลสาขา VTA",
  add_branches: "ให้สาขา VTA ดูแลบริษัท", remove_branches: "ยกเลิกการดูแลบริษัทของสาขา VTA", edit_branches: "แก้ไขข้อมูลสาขา", change_role: "เปลี่ยนบทบาทผู้ใช้", change_active: "เปิด/ปิดการใช้งานบัญชี" };

export default function Admin() {
  const [ok, setOk] = useState<boolean | null>(null), [tab, setTab] = useState<Tab>("users"), [msg, setMsg] = useState("");
  const [users, setUsers] = useState<any[]>([]), [clients, setClients] = useState<any[]>([]), [svcs, setSvcs] = useState<any[]>([]), [units, setUnits] = useState<any[]>([]);
  const [perms, setPerms] = useState<any[]>([]), [sel, setSel] = useState<any>(null), [logs, setLogs] = useState<any[]>([]), [look, setLook] = useState<Record<string, string>>({});
  const [inv, setInv] = useState({ email: "", full_name: "", role: "viewer" }), [pwFor, setPwFor] = useState<any>(null), [pw, setPw] = useState("");
  const [nc, setNc] = useState({ code: "", name: "", tax_id: "" }), [ncSvc, setNcSvc] = useState<Set<string>>(new Set());
  const [ns, setNs] = useState({ code: "", name: "", area: "" }), [editC, setEditC] = useState<any>(null), [editS, setEditS] = useState<any>(null), [panelS, setPanelS] = useState<any>(null), [q, setQ] = useState("");

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 4500); };
  const loadUsers = () => sb.from("profiles").select("*").order("full_name").then(({ data }) => setUsers(data ?? []));
  const loadOrgs = async () => {
    setClients((await sb.from("clients").select("*").order("name")).data ?? []);
    setSvcs((await sb.from("service_branches").select("*").order("code")).data ?? []);
    setUnits((await sb.from("branches").select("id,client_id,service_branch_id,code,name,area").order("code")).data ?? []); };
  const loadPerms = async (uid: string) => setPerms((await sb.from("user_service_branches").select("*").eq("user_id", uid)).data ?? []);

  useEffect(() => { if (new URLSearchParams(window.location.search).get("tab") === "orgs") setTab("orgs"); }, []);
  useEffect(() => { sb.auth.getUser().then(async ({ data }) => {
    if (!data.user) return setOk(false);
    const { data: p } = await sb.from("profiles").select("role").eq("id", data.user.id).single();
    setOk(p?.role === "admin"); if (p?.role === "admin") { loadUsers(); loadOrgs(); } }); }, []);
  useEffect(() => { if (!(ok && tab === "audit")) return; (async () => {
    const { data } = await sb.from("audit_log").select("*").order("at", { ascending: false }).limit(200); const L = data ?? []; setLogs(L);
    const ids = (acts: string[]) => [...new Set(L.filter((l: any) => acts.includes(l.action) && l.record_id).map((l: any) => l.record_id as string))];
    const m: Record<string, string> = {}, e = ids(["reveal_sensitive", "set_sensitive"]), d = ids(["open_file", "download_file"]);
    if (e.length) ((await sb.from("employees").select("id,employee_code,title_th,first_name_th,last_name_th").in("id", e)).data ?? []).forEach((x: any) => { m[x.id] = `${x.employee_code} ${x.title_th ?? ""}${x.first_name_th} ${x.last_name_th ?? ""}`.trim(); });
    if (d.length) ((await sb.from("documents").select("id,title").in("id", d)).data ?? []).forEach((x: any) => { m[x.id] = x.title; });
    setLook(m); })(); }, [tab, ok]);

  if (ok === null) return null;
  if (!ok) return <AppShell><p className="err">หน้านี้สำหรับ Admin เท่านั้น</p></AppShell>;

  // ---------- helpers ----------
  const cName = (id: string) => clients.find(c => c.id === id)?.name ?? "";
  const sLabel = (id: string) => { const s = svcs.find(x => x.id === id); return s ? `${s.code} ${s.name}` : ""; };
  const unitOf = (sid: string, cid: string) => units.find(u => u.service_branch_id === sid && u.client_id === cid);
  const clientsOf = (sid: string) => units.filter(u => u.service_branch_id === sid);
  const svcsOf = (cid: string) => units.filter(u => u.client_id === cid);
  const userName = (id: string) => { const u = users.find(x => x.id === id); return u ? (u.full_name || u.email) : (id ?? "").slice(0, 8); };
  const brName = (id: string) => { const b = units.find(x => x.id === id); return b ? `${cName(b.client_id)} / ${b.code} ${b.name}` : "(ไม่พบสาขา)"; };
  const describe = (l: any) => { const d = l.detail ?? {};
    switch (l.action) {
      case "reveal_sensitive": case "set_sensitive": return `พนักงาน ${look[l.record_id] ?? "-"}`;
      case "import_employees": return `เพิ่ม ${d.inserted ?? 0} คน, ข้าม ${d.skipped ?? 0} รหัสที่มีอยู่แล้ว`;
      case "bulk_move": return `ย้าย ${d.count ?? 0} คน ไปที่ ${brName(l.record_id)}`;
      case "perm_insert": case "perm_update": return `ผู้ใช้ ${userName(l.record_id)} · สาขา ${d.service_branch_id ? sLabel(d.service_branch_id) : brName(d.branch_id)} · ${d.can_edit ? "แก้ไขได้" : "ดูอย่างเดียว"}${d.can_view_sensitive ? " · ดูเลขบัตร/บัญชีเต็มได้" : ""}`;
      case "perm_delete": return `ผู้ใช้ ${userName(l.record_id)} · สาขา ${d.service_branch_id ? sLabel(d.service_branch_id) : brName(d.branch_id)}`;
      case "invite_user": return `${d.email ?? ""} · บทบาท ${ROLES[d.role] ?? d.role ?? ""}`;
      case "admin_set_password": case "admin_send_reset": return `ผู้ใช้ ${userName(l.record_id)}`;
      case "open_file": case "download_file": return `ไฟล์: ${d.title ?? look[l.record_id] ?? "-"}`;
      case "add_clients": case "edit_clients": return `บริษัท ${d.name ?? ""}`;
      case "add_service_branches": case "edit_service_branches": return `สาขา ${d.code ?? ""} ${d.name ?? ""}`;
      case "add_branches": case "remove_branches": case "edit_branches": return `สาขา ${d.code ?? ""} ${d.name ?? ""} · บริษัท ${d.client_id ? cName(d.client_id) : ""}`;
      case "change_role": return `ผู้ใช้ ${userName(l.record_id)}: ${ROLES[d.from] ?? d.from} → ${ROLES[d.to] ?? d.to}`;
      case "change_active": return `ผู้ใช้ ${userName(l.record_id)}: ${d.to ? "เปิดใช้งาน" : "ปิดใช้งาน"}`;
      default: return ""; } };

  // ---------- users ----------
  const upd = async (id: string, patch: any) => { const { error } = await sb.from("profiles").update(patch).eq("id", id); error ? flash("ไม่สำเร็จ: " + error.message) : (flash("บันทึกแล้ว"), loadUsers()); };
  const act = async (body: any) => { const { data: s } = await sb.auth.getSession();
    const r = await fetch("/api/admin/user-action", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s.session?.access_token}` }, body: JSON.stringify(body) });
    return { ok: r.ok, j: await r.json() }; };
  const sendReset = async (u: any) => { const x = await act({ user_id: u.id, action: "send_reset" }); flash(x.ok ? `ส่งลิงก์ตั้งรหัสผ่านไปที่ ${u.email} แล้ว` : "ไม่สำเร็จ: " + x.j.error); };
  const savePw = async () => { const x = await act({ user_id: pwFor.id, action: "set_password", password: pw });
    if (x.ok) { flash("ตั้งรหัสผ่านแล้ว แจ้งผู้ใช้ให้เข้าสู่ระบบและเปลี่ยนรหัสเอง"); setPwFor(null); setPw(""); } else flash("ไม่สำเร็จ: " + x.j.error); };
  const gen = () => { const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; setPw([...crypto.getRandomValues(new Uint32Array(12))].map(n => c[n % c.length]).join("") + "#7"); };
  const invite = async () => { const { data: s } = await sb.auth.getSession();
    const r = await fetch("/api/admin/invite", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s.session?.access_token}` }, body: JSON.stringify(inv) });
    const j = await r.json(); if (!r.ok) return flash("ไม่สำเร็จ: " + j.error); flash("ส่งคำเชิญทางอีเมลแล้ว"); setInv({ email: "", full_name: "", role: "viewer" }); loadUsers(); };
  const setPerm = async (sid: string, k: string, v: boolean) => {
    const cur = perms.find(p => p.service_branch_id === sid);
    const next = { user_id: sel.id, service_branch_id: sid, can_edit: false, can_view_sensitive: false, ...cur, [k]: v };
    const { error } = await sb.from("user_service_branches").upsert(next); error ? flash("ไม่สำเร็จ: " + error.message) : loadPerms(sel.id); };
  const toggleAccess = async (sid: string, on: boolean) => { if (on) return setPerm(sid, "can_edit", false);
    const { error } = await sb.from("user_service_branches").delete().eq("user_id", sel.id).eq("service_branch_id", sid); error ? flash("ไม่สำเร็จ: " + error.message) : loadPerms(sel.id); };

  // ---------- companies / VTA branches ----------
  const toggleUnit = async (sid: string, cid: string, on: boolean) => {
    if (on) { const { error } = await sb.from("branches").insert({ service_branch_id: sid, client_id: cid }); if (error) return flash("ไม่สำเร็จ: " + error.message); }
    else { const u = unitOf(sid, cid); if (!u) return;
      const { error } = await sb.from("branches").delete().eq("id", u.id);
      if (error) return flash(error.message.includes("foreign key") ? "ยกเลิกไม่ได้: มีพนักงานสังกัดบริษัทนี้ในสาขานี้อยู่ ให้ย้ายพนักงานออกก่อน" : "ไม่สำเร็จ: " + error.message); }
    loadOrgs(); };
  const addService = async () => { if (!ns.code.trim() || !ns.name.trim()) return flash("กรอกรหัสและชื่อสาขา");
    const { error } = await sb.from("service_branches").insert({ code: ns.code.trim(), name: ns.name.trim(), area: ns.area || null });
    error ? flash("ไม่สำเร็จ: " + (error.message.includes("duplicate") ? "รหัสสาขานี้มีอยู่แล้ว" : error.message)) : (flash("เพิ่มสาขาแล้ว"), setNs({ code: "", name: "", area: "" }), loadOrgs()); };
  const saveS = async () => { const s = editS; if (!s.code?.trim() || !s.name?.trim()) return flash("กรอกรหัสและชื่อสาขา");
    const { error } = await sb.from("service_branches").update({ code: s.code.trim(), name: s.name.trim(), area: s.area || null, active: !!s.active }).eq("id", s.id);
    error ? flash("ไม่สำเร็จ: " + (error.message.includes("duplicate") ? "รหัสสาขานี้มีอยู่แล้ว" : error.message)) : (flash("บันทึกสาขาแล้ว"), setEditS(null), loadOrgs()); };
  const addClient = async () => { if (!nc.code.trim() || !nc.name.trim()) return flash("กรอกรหัสและชื่อบริษัท");
    const { data, error } = await sb.from("clients").insert({ code: nc.code.trim(), name: nc.name.trim(), tax_id: nc.tax_id || null }).select("id").single();
    if (error || !data) return flash("ไม่สำเร็จ: " + (error?.message.includes("duplicate") ? "รหัสบริษัทนี้มีอยู่แล้ว" : error?.message));
    if (ncSvc.size) { const { error: e2 } = await sb.from("branches").insert([...ncSvc].map(sid => ({ service_branch_id: sid, client_id: data.id }))); if (e2) flash("เพิ่มบริษัทแล้ว แต่ผูกสาขาไม่สำเร็จ: " + e2.message); else flash(`เพิ่มบริษัทแล้ว และให้ ${ncSvc.size} สาขาดูแล`); } else flash("เพิ่มบริษัทแล้ว");
    setNc({ code: "", name: "", tax_id: "" }); setNcSvc(new Set()); loadOrgs(); };
  const saveC = async () => { const c = editC; if (!c.code?.trim() || !c.name?.trim()) return flash("กรอกรหัสและชื่อบริษัท");
    const { error } = await sb.from("clients").update({ code: c.code.trim(), name: c.name.trim(), tax_id: c.tax_id || null, pay_cycle: c.pay_cycle || null, pay_date: c.pay_date || null, address: c.address || null, active: !!c.active }).eq("id", c.id);
    error ? flash("ไม่สำเร็จ: " + error.message) : (flash("บันทึกบริษัทแล้ว"), setEditC(null), loadOrgs()); };
  const up = () => window.scrollTo({ top: 0, behavior: "smooth" });

  return <AppShell><PageHead title="จัดการระบบ" subtitle="ผู้ใช้ สิทธิ์ และโครงสร้างสาขา VTA / บริษัทลูกค้า" />
    <div className="row">{([["users", "ผู้ใช้และสิทธิ์"], ["orgs", "สาขาและบริษัท"], ["audit", "ประวัติการใช้งาน"]] as [Tab, string][]).map(([k, t]) =>
      <button key={k} className={tab === k ? "tab on" : "tab"} onClick={() => setTab(k)}>{t}</button>)}<span role="status">{msg}</span></div>

    {tab === "users" && <>
      <div className="card"><h2>เชิญผู้ใช้ใหม่</h2><div className="grid">
        <label>อีเมล<input value={inv.email} onChange={e => setInv({ ...inv, email: e.target.value })} /></label>
        <label>ชื่อ-สกุล<input value={inv.full_name} onChange={e => setInv({ ...inv, full_name: e.target.value })} /></label>
        <label>บทบาท<select value={inv.role} onChange={e => setInv({ ...inv, role: e.target.value })}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
        <p><button onClick={invite}>ส่งคำเชิญ</button></p></div>
      <div className="tbl"><table><thead><tr><th>ผู้ใช้</th><th>บทบาท</th><th>ใช้งาน</th><th></th></tr></thead><tbody>
        {users.map(u => <tr key={u.id}><td>{u.full_name}<br /><small>{u.email}</small></td>
          <td><select value={u.role} onChange={e => upd(u.id, { role: e.target.value })}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
          <td><input type="checkbox" checked={u.active} aria-label="เปิดใช้งานบัญชี" onChange={e => upd(u.id, { active: e.target.checked })} /></td>
          <td><div className="row" style={{ marginBottom: 0 }}><button className="sec" onClick={() => { setSel(u); loadPerms(u.id); }}>กำหนดสาขา</button><button className="sec" onClick={() => sendReset(u)}>ส่งลิงก์ตั้งรหัสผ่าน</button><button className="sec" onClick={() => { setPwFor(u); setPw(""); }}>ตั้งรหัสผ่าน</button></div></td></tr>)}</tbody></table></div>
      {pwFor && <div className="card"><h2>ตั้งรหัสผ่านให้ {pwFor.full_name ?? pwFor.email}</h2>
        <div className="row"><input value={pw} onChange={e => setPw(e.target.value)} placeholder="อย่างน้อย 10 ตัวอักษร" autoComplete="off" /><button className="sec" onClick={gen}>สุ่มรหัส</button><button onClick={savePw}>บันทึกรหัสผ่าน</button><button className="sec" onClick={() => setPwFor(null)}>ยกเลิก</button></div>
        <p className="mut" style={{ margin: 0 }}>ส่งรหัสให้ผู้ใช้ทางช่องทางส่วนตัว และให้เปลี่ยนรหัสเองหลังเข้าสู่ระบบ (เมนู "เปลี่ยนรหัสผ่าน")</p></div>}
      {sel && <div className="card"><h2>สิทธิ์รายสาขา: {sel.full_name ?? sel.email}</h2>
        {sel.role === "admin" ? <p>Admin เห็นและแก้ไขได้ทุกสาขาอยู่แล้ว</p> : sel.role === "viewer" && <p><small>บทบาท "ดูอย่างเดียว" จะแก้ไขไม่ได้ แม้ติ๊กสิทธิ์แก้ไข</small></p>}
        <p className="mut">สิทธิ์ผูกกับสาขา VTA ครอบคลุมทุกบริษัทที่สาขานั้นดูแล รวมบริษัทที่เพิ่มในภายหลัง</p>
        <div className="tbl"><table><thead><tr><th>สาขา VTA</th><th>บริษัทที่ดูแล</th><th>เข้าถึง</th><th>แก้ไข</th><th>ดูเลขบัตร/บัญชีเต็ม</th></tr></thead><tbody>
          {svcs.map(s => { const p = perms.find(x => x.service_branch_id === s.id), cs = clientsOf(s.id);
            return <tr key={s.id}><td>{s.code} {s.name}</td><td><small>{cs.length ? `${cs.length} บริษัท: ${cs.slice(0, 3).map(u => cName(u.client_id)).join(", ")}${cs.length > 3 ? " ..." : ""}` : "ยังไม่มี"}</small></td>
              <td><input type="checkbox" aria-label="เข้าถึง" checked={!!p} onChange={e => toggleAccess(s.id, e.target.checked)} /></td>
              <td><input type="checkbox" aria-label="แก้ไข" disabled={!p} checked={!!p?.can_edit} onChange={e => setPerm(s.id, "can_edit", e.target.checked)} /></td>
              <td><input type="checkbox" aria-label="ดูข้อมูลเต็ม" disabled={!p} checked={!!p?.can_view_sensitive} onChange={e => setPerm(s.id, "can_view_sensitive", e.target.checked)} /></td></tr>; })}
          {!svcs.length && <tr><td colSpan={5}>ยังไม่มีสาขา VTA ไปสร้างที่แท็บ "สาขาและบริษัท"</td></tr>}</tbody></table></div></div>}
    </>}

    {tab === "orgs" && <>
      <div className="card"><h2>เพิ่มสาขา VTA</h2><p className="mut" style={{ marginTop: 0 }}>สร้างสาขาครั้งเดียว แล้วเลือกบริษัทที่สาขานั้นดูแลจากรายการ (1 สาขาดูแลได้หลายบริษัท)</p><div className="grid">
        <label>รหัสสาขา (เช่น VTA0001)<input value={ns.code} onChange={e => setNs({ ...ns, code: e.target.value })} /></label>
        <label>ชื่อสาขา (เช่น สาขาลำพูน)<input value={ns.name} onChange={e => setNs({ ...ns, name: e.target.value })} /></label>
        <label>พื้นที่<input value={ns.area} onChange={e => setNs({ ...ns, area: e.target.value })} /></label></div>
        <p><button onClick={addService}>เพิ่มสาขา</button></p></div>

      {editS && <div className="card"><h2>แก้ไขสาขา VTA</h2><div className="grid">
        <label>รหัสสาขา<input value={editS.code ?? ""} onChange={e => setEditS({ ...editS, code: e.target.value })} /></label>
        <label>ชื่อสาขา<input value={editS.name ?? ""} onChange={e => setEditS({ ...editS, name: e.target.value })} /></label>
        <label>พื้นที่<input value={editS.area ?? ""} onChange={e => setEditS({ ...editS, area: e.target.value })} /></label></div>
        <label style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><input type="checkbox" checked={!!editS.active} onChange={e => setEditS({ ...editS, active: e.target.checked })} /> เปิดใช้งานสาขา</label>
        <p className="mut">การเปลี่ยนรหัสหรือชื่อสาขา จะเปลี่ยนในทุกบริษัทที่สาขานี้ดูแลและในรายชื่อพนักงานทันที</p>
        <div className="row"><button onClick={saveS}>บันทึก</button><button className="sec" onClick={() => setEditS(null)}>ยกเลิก</button></div></div>}

      {panelS && <div className="card" id="svc-panel"><h2>บริษัทที่ {panelS.code} {panelS.name} ดูแล</h2>
        <p className="mut" style={{ marginTop: 0 }}>ติ๊กเพื่อให้สาขานี้ดูแลบริษัท / เอาติ๊กออกเพื่อยกเลิก (ยกเลิกไม่ได้ถ้ามีพนักงานสังกัดอยู่) · ดูแลอยู่ {clientsOf(panelS.id).length} จาก {clients.length} บริษัท</p>
        <div className="row"><input placeholder="ค้นหาบริษัท" value={q} onChange={e => setQ(e.target.value)} /><button className="sec" onClick={() => { setPanelS(null); setQ(""); }}>ปิด</button></div>
        <div className="tbl" style={{ maxHeight: 360, overflowY: "auto", border: "1px solid #dfe5f3", borderRadius: 12 }}><table><tbody>
          {clients.filter(c => !q.trim() || `${c.name} ${c.code}`.toLowerCase().includes(q.trim().toLowerCase())).map(c =>
            <tr key={c.id}><td style={{ width: 44 }}><input type="checkbox" aria-label={c.name} checked={!!unitOf(panelS.id, c.id)} onChange={e => toggleUnit(panelS.id, c.id, e.target.checked)} /></td>
              <td>{c.name}<br /><small>{c.code}{c.tax_id ? ` · ${c.tax_id}` : ""}</small></td><td><small>{svcsOf(c.id).filter(u => u.service_branch_id !== panelS.id).map(u => u.code).join(", ")}</small></td></tr>)}
          {!clients.length && <tr><td>ยังไม่มีบริษัท ไปเพิ่มด้านล่าง</td></tr>}</tbody></table></div></div>}

      <h2>สาขา VTA</h2><div className="tbl"><table><thead><tr><th>สาขา</th><th>พื้นที่</th><th className="num">บริษัทที่ดูแล</th><th>สถานะ</th><th></th></tr></thead><tbody>
        {svcs.map(s => <tr key={s.id}><td>{s.code} {s.name}</td><td>{s.area}</td><td className="num">{clientsOf(s.id).length}</td><td>{s.active ? "ใช้งาน" : "ปิด"}</td>
          <td><div className="row" style={{ marginBottom: 0 }}><button className="sec" onClick={() => { setPanelS(s); setQ(""); setTimeout(() => document.getElementById("svc-panel")?.scrollIntoView({ behavior: "smooth" }), 50); }}>บริษัทที่ดูแล</button>
            <button className="sec" onClick={() => { setEditS({ ...s }); up(); }}>แก้ไข</button></div></td></tr>)}
        {!svcs.length && <tr><td colSpan={5}>ยังไม่มีสาขา VTA</td></tr>}</tbody></table></div>

      <div className="card"><h2>เพิ่มบริษัทลูกค้า</h2><div className="grid">
        <label>รหัส<input value={nc.code} onChange={e => setNc({ ...nc, code: e.target.value })} /></label>
        <label>ชื่อบริษัท<input value={nc.name} onChange={e => setNc({ ...nc, name: e.target.value })} /></label>
        <label>เลขผู้เสียภาษี<input value={nc.tax_id} onChange={e => setNc({ ...nc, tax_id: e.target.value })} /></label></div>
        {!!svcs.length && <><p style={{ marginBottom: 6 }}><b>สาขา VTA ที่ดูแลบริษัทนี้</b> <small>(เลือกได้หลายสาขา)</small></p>
          <div className="row">{svcs.map(s => <label key={s.id} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><input type="checkbox" checked={ncSvc.has(s.id)} onChange={e => { const n = new Set(ncSvc); e.target.checked ? n.add(s.id) : n.delete(s.id); setNcSvc(n); }} />{s.code} {s.name}</label>)}</div></>}
        <p><button onClick={addClient}>เพิ่มบริษัท</button></p></div>

      {editC && <div className="card"><h2>แก้ไขบริษัท</h2><div className="grid">
        <label>รหัส<input value={editC.code ?? ""} onChange={e => setEditC({ ...editC, code: e.target.value })} /></label>
        <label>ชื่อบริษัท<input value={editC.name ?? ""} onChange={e => setEditC({ ...editC, name: e.target.value })} /></label>
        <label>เลขผู้เสียภาษี<input value={editC.tax_id ?? ""} onChange={e => setEditC({ ...editC, tax_id: e.target.value })} /></label>
        <label>รอบจ่ายค่าจ้าง<input value={editC.pay_cycle ?? ""} onChange={e => setEditC({ ...editC, pay_cycle: e.target.value })} /></label>
        <label>วันจ่าย<input value={editC.pay_date ?? ""} onChange={e => setEditC({ ...editC, pay_date: e.target.value })} /></label>
        <label>ที่อยู่<input value={editC.address ?? ""} onChange={e => setEditC({ ...editC, address: e.target.value })} /></label></div>
        <label style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><input type="checkbox" checked={!!editC.active} onChange={e => setEditC({ ...editC, active: e.target.checked })} /> เปิดใช้งานบริษัท</label>
        <div className="row"><button onClick={saveC}>บันทึกข้อมูลบริษัท</button><button className="sec" onClick={() => setEditC(null)}>ปิด</button></div>
        <p style={{ marginBottom: 6 }}><b>สาขา VTA ที่ดูแลบริษัทนี้</b> <small>(ติ๊ก/เอาติ๊กออกมีผลทันที)</small></p>
        <div className="row">{svcs.map(s => <label key={s.id} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><input type="checkbox" checked={!!unitOf(s.id, editC.id)} onChange={e => toggleUnit(s.id, editC.id, e.target.checked)} />{s.code} {s.name}</label>)}</div></div>}

      <h2>บริษัท</h2><div className="tbl"><table><thead><tr><th>บริษัท</th><th>เลขผู้เสียภาษี</th><th>สาขา VTA ที่ดูแล</th><th>สถานะ</th><th></th></tr></thead><tbody>
        {clients.map(c => <tr key={c.id}><td>{c.name}<br /><small>{c.code}</small></td><td>{c.tax_id}</td><td>{svcsOf(c.id).map(u => u.code).join(", ") || <small>ยังไม่มี</small>}</td><td>{c.active ? "ใช้งาน" : "ปิด"}</td>
          <td><div className="row" style={{ marginBottom: 0 }}><button className="sec" onClick={() => { setEditC({ ...c }); up(); }}>แก้ไข</button><a className="btn btn-outline" href={`/companies/${c.id}`}>เอกสาร</a></div></td></tr>)}
        {!clients.length && <tr><td colSpan={5}>ยังไม่มีบริษัท</td></tr>}</tbody></table></div>
    </>}

    {tab === "audit" && <div className="tbl"><table><thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>รายละเอียด</th></tr></thead><tbody>
      {logs.map(l => <tr key={l.id}><td style={{ whiteSpace: "nowrap" }}>{new Date(l.at).toLocaleString("th-TH")}</td><td>{l.user_id ? userName(l.user_id) : "ระบบ"}</td>
        <td>{ACT[l.action] ?? l.action}</td><td>{describe(l)}</td></tr>)}
      {!logs.length && <tr><td colSpan={4}>ยังไม่มีประวัติ</td></tr>}</tbody></table></div>}
  </AppShell>;
}
