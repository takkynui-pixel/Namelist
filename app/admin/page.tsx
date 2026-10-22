"use client";
import { useEffect, useState } from "react";
import { sb } from "@/lib/supabase";
import AppShell from "@/components/AppShell";
import PageHead from "@/components/PageHead";

const ROLES: Record<string, string> = { admin: "Admin", multi_branch_manager: "ผู้จัดการหลายสาขา", branch_officer: "เจ้าหน้าที่สาขา", viewer: "ดูอย่างเดียว" };
type Tab = "users" | "orgs" | "audit";

export default function Admin() {
  const [ok, setOk] = useState<boolean | null>(null), [tab, setTab] = useState<Tab>("users"), [msg, setMsg] = useState("");
  const [users, setUsers] = useState<any[]>([]), [clients, setClients] = useState<any[]>([]), [branches, setBranches] = useState<any[]>([]);
  const [perms, setPerms] = useState<any[]>([]), [sel, setSel] = useState<any>(null), [logs, setLogs] = useState<any[]>([]);
  const [inv, setInv] = useState({ email: "", full_name: "", role: "viewer" });
  const [pwFor, setPwFor] = useState<any>(null), [pw, setPw] = useState("");
  const [editC, setEditC] = useState<any>(null), [editB, setEditB] = useState<any>(null);
  const [pick, setPick] = useState<Set<string>>(new Set()), [look, setLook] = useState<Record<string, string>>({});
  const [nc, setNc] = useState({ code: "", name: "", tax_id: "" }), [nb, setNb] = useState({ client_id: "", code: "", name: "", area: "" });

  const loadUsers = () => sb.from("profiles").select("*").order("full_name").then(({ data }) => setUsers(data ?? []));
  const loadOrgs = async () => { setClients((await sb.from("clients").select("*").order("name")).data ?? []); setBranches((await sb.from("branches").select("*").order("name")).data ?? []); };
  const loadPerms = async (uid: string) => setPerms((await sb.from("user_branches").select("*").eq("user_id", uid)).data ?? []);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 4000); };

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

  const tplMap = new Map<string, { code: string; name: string; area: string | null; n: number }>();
  branches.forEach(b => { const k = tkey(b), t = tplMap.get(k); t ? t.n++ : tplMap.set(k, { code: b.code, name: b.name, area: b.area, n: 1 }); });
  const tplList = [...tplMap.entries()].sort((a, b) => a[1].code.localeCompare(b[1].code) || a[1].name.localeCompare(b[1].name));
  const ACT: Record<string, string> = { reveal_sensitive: "ดูเลขบัตรประชาชน/บัญชีธนาคารแบบเต็ม", set_sensitive: "บันทึกเลขบัตรประชาชน/บัญชีธนาคาร", import_employees: "นำเข้าพนักงานจาก Excel",
    bulk_move: "ย้ายพนักงานหลายคนไปสาขาใหม่", perm_insert: "ให้สิทธิ์เข้าถึงสาขา", perm_update: "แก้ไขสิทธิ์รายสาขา", perm_delete: "ยกเลิกสิทธิ์เข้าถึงสาขา", invite_user: "เชิญผู้ใช้ใหม่",
    admin_set_password: "ตั้งรหัสผ่านให้ผู้ใช้", admin_send_reset: "ส่งลิงก์ตั้งรหัสผ่านให้ผู้ใช้", open_file: "เปิดดูไฟล์แนบ", download_file: "ดาวน์โหลดไฟล์แนบ",
    add_clients: "เพิ่มบริษัทใหม่", edit_clients: "แก้ไขข้อมูลบริษัท", add_branches: "เพิ่มสาขาใหม่", edit_branches: "แก้ไขข้อมูลสาขา", change_role: "เปลี่ยนบทบาทผู้ใช้", change_active: "เปิด/ปิดการใช้งานบัญชี" };
  const brName = (id: string) => { const b = branches.find(x => x.id === id); return b ? `${clients.find(c => c.id === b.client_id)?.name ?? ""} / ${b.code} ${b.name}` : "(ไม่พบสาขา)"; };
  const userName = (id: string) => { const u = users.find(x => x.id === id); return u ? (u.full_name || u.email) : (id ?? "").slice(0, 8); };
  const describe = (l: any) => { const d = l.detail ?? {};
    switch (l.action) {
      case "reveal_sensitive": case "set_sensitive": return `พนักงาน ${look[l.record_id] ?? "-"}`;
      case "import_employees": return `เพิ่ม ${d.inserted ?? 0} คน, ข้าม ${d.skipped ?? 0} รหัสที่มีอยู่แล้ว`;
      case "bulk_move": return `ย้าย ${d.count ?? 0} คน ไปที่ ${brName(l.record_id)}`;
      case "perm_insert": case "perm_update": return `ผู้ใช้ ${userName(l.record_id)} · ${brName(d.branch_id)} · ${d.can_edit ? "แก้ไขได้" : "ดูอย่างเดียว"}${d.can_view_sensitive ? " · ดูเลขบัตร/บัญชีเต็มได้" : ""}`;
      case "perm_delete": return `ผู้ใช้ ${userName(l.record_id)} · ${brName(d.branch_id)}`;
      case "invite_user": return `${d.email ?? ""} · บทบาท ${ROLES[d.role] ?? d.role ?? ""}`;
      case "admin_set_password": case "admin_send_reset": return `ผู้ใช้ ${userName(l.record_id)}`;
      case "open_file": case "download_file": return `ไฟล์: ${d.title ?? look[l.record_id] ?? "-"}`;
      case "add_clients": case "edit_clients": return `บริษัท ${d.name ?? ""}`;
      case "add_branches": case "edit_branches": return `สาขา ${d.code ?? ""} ${d.name ?? ""}${d.client_id ? " · " + (clients.find(c => c.id === d.client_id)?.name ?? "") : ""}`;
      case "change_role": return `ผู้ใช้ ${userName(l.record_id)}: ${ROLES[d.from] ?? d.from} → ${ROLES[d.to] ?? d.to}`;
      case "change_active": return `ผู้ใช้ ${userName(l.record_id)}: ${d.to ? "เปิดใช้งาน" : "ปิดใช้งาน"}`;
      default: return ""; } };
  const upd = async (id: string, patch: any) => { const { error } = await sb.from("profiles").update(patch).eq("id", id); error ? flash("ไม่สำเร็จ: " + error.message) : (flash("บันทึกแล้ว"), loadUsers()); };
  const act = async (body: any) => { const { data: s } = await sb.auth.getSession();
    const r = await fetch("/api/admin/user-action", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s.session?.access_token}` }, body: JSON.stringify(body) });
    return { ok: r.ok, j: await r.json() }; };
  const sendReset = async (u: any) => { const x = await act({ user_id: u.id, action: "send_reset" }); flash(x.ok ? `ส่งลิงก์ตั้งรหัสผ่านไปที่ ${u.email} แล้ว` : "ไม่สำเร็จ: " + x.j.error); };
  const savePw = async () => { const x = await act({ user_id: pwFor.id, action: "set_password", password: pw });
    if (x.ok) { flash("ตั้งรหัสผ่านแล้ว แจ้งผู้ใช้ให้เข้าสู่ระบบและเปลี่ยนรหัสเอง"); setPwFor(null); setPw(""); } else flash("ไม่สำเร็จ: " + x.j.error); };
  const gen = () => { const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; setPw([...crypto.getRandomValues(new Uint32Array(12))].map(n => c[n % c.length]).join("") + "#7"); };
  const saveC = async () => { const c = editC; if (!c.code?.trim() || !c.name?.trim()) return flash("กรอกรหัสและชื่อบริษัท");
    const { error } = await sb.from("clients").update({ code: c.code.trim(), name: c.name.trim(), tax_id: c.tax_id || null, pay_cycle: c.pay_cycle || null, pay_date: c.pay_date || null, address: c.address || null, active: !!c.active }).eq("id", c.id);
    error ? flash("ไม่สำเร็จ: " + error.message) : (flash("บันทึกบริษัทแล้ว"), setEditC(null), loadOrgs()); };
  const saveB = async () => { const b = editB; if (!b.code?.trim() || !b.name?.trim() || !b.client_id) return flash("กรอกบริษัท รหัส และชื่อสาขา");
    const { error } = await sb.from("branches").update({ client_id: b.client_id, code: b.code.trim(), name: b.name.trim(), area: b.area || null, active: !!b.active }).eq("id", b.id);
    error ? flash("ไม่สำเร็จ: " + (error.message.includes("duplicate") ? "รหัสสาขานี้มีอยู่แล้วในบริษัทเดียวกัน" : error.message)) : (flash("บันทึกสาขาแล้ว"), setEditB(null), loadOrgs()); };
  const invite = async () => { const { data: s } = await sb.auth.getSession();
    const r = await fetch("/api/admin/invite", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s.session?.access_token}` }, body: JSON.stringify(inv) });
    const j = await r.json(); if (!r.ok) return flash("ไม่สำเร็จ: " + j.error); flash("ส่งคำเชิญทางอีเมลแล้ว"); setInv({ email: "", full_name: "", role: "viewer" }); loadUsers(); };
  const setPerm = async (b: string, k: string, v: boolean) => {
    const cur = perms.find(p => p.branch_id === b);
    const next = { user_id: sel.id, branch_id: b, can_edit: false, can_view_sensitive: false, ...cur, [k]: v };
    const { error } = await sb.from("user_branches").upsert(next); error ? flash("ไม่สำเร็จ: " + error.message) : loadPerms(sel.id); };
  const toggleAccess = async (b: string, on: boolean) => { if (on) return setPerm(b, "can_edit", false); // on=true: ติ๊กให้เข้าถึง, false: ยกเลิก
    const { error } = await sb.from("user_branches").delete().eq("user_id", sel.id).eq("branch_id", b); error ? flash("ไม่สำเร็จ: " + error.message) : loadPerms(sel.id); };
  const addClient = async () => { const { error } = await sb.from("clients").insert({ ...nc, tax_id: nc.tax_id || null }); error ? flash("ไม่สำเร็จ: " + error.message) : (setNc({ code: "", name: "", tax_id: "" }), loadOrgs()); };
  const tkey = (b: any) => [b.code, b.name, b.area ?? ""].join("\u0001");
  const addBranch = async () => {
    if (!nb.client_id) return flash("เลือกบริษัทก่อน");
    const rows: any[] = [];
    tplList.forEach(([k, t]) => { if (pick.has(k) && !branches.some(b => b.client_id === nb.client_id && tkey(b) === k)) rows.push({ client_id: nb.client_id, code: t.code, name: t.name, area: t.area }); });
    if (nb.code.trim() || nb.name.trim()) { if (!nb.code.trim() || !nb.name.trim()) return flash("สาขาใหม่ต้องกรอกทั้งรหัสและชื่อสาขา"); rows.push({ client_id: nb.client_id, code: nb.code.trim(), name: nb.name.trim(), area: nb.area || null }); }
    if (!rows.length) return flash("เลือกสาขาที่มีอยู่ หรือกรอกสาขาใหม่อย่างน้อย 1 รายการ");
    const { error } = await sb.from("branches").insert(rows);
    error ? flash("ไม่สำเร็จ: " + (error.message.includes("duplicate") ? "มีรหัสสาขาซ้ำในบริษัทนี้" : error.message)) : (flash(`เพิ่มสาขาให้บริษัทแล้ว ${rows.length} สาขา`), setPick(new Set()), setNb({ ...nb, code: "", name: "", area: "" }), loadOrgs()); };
  const who = (id: string) => users.find(u => u.id === id)?.email ?? id?.slice(0, 8);

  return <AppShell><PageHead title="จัดการระบบ" subtitle="ผู้ใช้ สิทธิ์ และโครงสร้างบริษัท/สาขา" />
    <div className="row">{([["users", "ผู้ใช้และสิทธิ์"], ["orgs", "บริษัทและสาขา"], ["audit", "ประวัติการใช้งาน"]] as [Tab, string][]).map(([k, t]) =>
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
        <div className="tbl"><table><thead><tr><th>บริษัท / สาขา</th><th>เข้าถึง</th><th>แก้ไข</th><th>ดูเลขบัตร/บัญชีเต็ม</th></tr></thead><tbody>
          {branches.map(b => { const p = perms.find(x => x.branch_id === b.id);
            return <tr key={b.id}><td>{clients.find(c => c.id === b.client_id)?.name} / {b.name}</td>
              <td><input type="checkbox" aria-label="เข้าถึง" checked={!!p} onChange={e => toggleAccess(b.id, e.target.checked)} /></td>
              <td><input type="checkbox" aria-label="แก้ไข" disabled={!p} checked={!!p?.can_edit} onChange={e => setPerm(b.id, "can_edit", e.target.checked)} /></td>
              <td><input type="checkbox" aria-label="ดูข้อมูลเต็ม" disabled={!p} checked={!!p?.can_view_sensitive} onChange={e => setPerm(b.id, "can_view_sensitive", e.target.checked)} /></td></tr>; })}
        </tbody></table></div></div>}
    </>}

    {tab === "orgs" && <>
      {editC && <div className="card"><h2>แก้ไขบริษัท</h2><div className="grid">
        <label>รหัส<input value={editC.code ?? ""} onChange={e => setEditC({ ...editC, code: e.target.value })} /></label>
        <label>ชื่อบริษัท<input value={editC.name ?? ""} onChange={e => setEditC({ ...editC, name: e.target.value })} /></label>
        <label>เลขผู้เสียภาษี<input value={editC.tax_id ?? ""} onChange={e => setEditC({ ...editC, tax_id: e.target.value })} /></label>
        <label>รอบจ่ายค่าจ้าง<input value={editC.pay_cycle ?? ""} onChange={e => setEditC({ ...editC, pay_cycle: e.target.value })} /></label>
        <label>วันจ่าย<input value={editC.pay_date ?? ""} onChange={e => setEditC({ ...editC, pay_date: e.target.value })} /></label>
        <label>ที่อยู่<input value={editC.address ?? ""} onChange={e => setEditC({ ...editC, address: e.target.value })} /></label></div>
        <label style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><input type="checkbox" checked={!!editC.active} onChange={e => setEditC({ ...editC, active: e.target.checked })} /> เปิดใช้งานบริษัท</label>
        <div className="row"><button onClick={saveC}>บันทึก</button><button className="sec" onClick={() => setEditC(null)}>ยกเลิก</button></div></div>}
      {editB && <div className="card"><h2>แก้ไขสาขา</h2><div className="grid">
        <label>บริษัท<select value={editB.client_id} onChange={e => setEditB({ ...editB, client_id: e.target.value })}>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>รหัสสาขา<input value={editB.code ?? ""} onChange={e => setEditB({ ...editB, code: e.target.value })} /></label>
        <label>ชื่อสาขา<input value={editB.name ?? ""} onChange={e => setEditB({ ...editB, name: e.target.value })} /></label>
        <label>พื้นที่<input value={editB.area ?? ""} onChange={e => setEditB({ ...editB, area: e.target.value })} /></label></div>
        <label style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><input type="checkbox" checked={!!editB.active} onChange={e => setEditB({ ...editB, active: e.target.checked })} /> เปิดใช้งานสาขา</label>
        <p className="mut">การย้ายสาขาไปบริษัทอื่นจะเปลี่ยนบริษัทของพนักงานในสาขานี้ทั้งหมดและสิทธิ์เข้าถึงเอกสารบริษัทตามไปด้วย</p>
        <div className="row"><button onClick={saveB}>บันทึก</button><button className="sec" onClick={() => setEditB(null)}>ยกเลิก</button></div></div>}
      <div className="card"><h2>เพิ่มบริษัทลูกค้า</h2><div className="grid">
        <label>รหัส<input value={nc.code} onChange={e => setNc({ ...nc, code: e.target.value })} /></label>
        <label>ชื่อบริษัท<input value={nc.name} onChange={e => setNc({ ...nc, name: e.target.value })} /></label>
        <label>เลขผู้เสียภาษี<input value={nc.tax_id} onChange={e => setNc({ ...nc, tax_id: e.target.value })} /></label></div>
        <p><button onClick={addClient}>เพิ่มบริษัท</button></p></div>
      <div className="card" id="add-branch"><h2>เพิ่มสาขาให้บริษัท</h2>
        <label>บริษัท<select value={nb.client_id} onChange={e => { setNb({ ...nb, client_id: e.target.value }); setPick(new Set()); }}><option value="">เลือกบริษัท</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {nb.client_id && <><p style={{ marginBottom: 6 }}><b>เลือกจากสาขาที่มีอยู่แล้ว</b> <small>(เลือกได้หลายสาขา)</small></p>
          <div className="tbl" style={{ maxHeight: 280, overflowY: "auto", border: "1px solid #dfe5f3", borderRadius: 12 }}><table><tbody>
            {tplList.map(([k, t]) => { const has = branches.some(b => b.client_id === nb.client_id && tkey(b) === k);
              return <tr key={k}><td style={{ width: 44 }}><input type="checkbox" aria-label={`${t.code} ${t.name}`} disabled={has} checked={has || pick.has(k)} onChange={e => { const n = new Set(pick); e.target.checked ? n.add(k) : n.delete(k); setPick(n); }} /></td>
                <td>{t.code} {t.name}{t.area ? <small> · {t.area}</small> : null}</td><td><small>{has ? "บริษัทนี้มีสาขานี้แล้ว" : `ใช้อยู่ ${t.n} บริษัท`}</small></td></tr>; })}
            {!tplList.length && <tr><td>ยังไม่มีสาขาในระบบ ให้สร้างสาขาใหม่ด้านล่าง</td></tr>}</tbody></table></div>
          <p style={{ marginBottom: 6 }}><b>หรือสร้างสาขาใหม่</b> <small>(เว้นว่างไว้ถ้าไม่ต้องการ)</small></p>
          <div className="grid"><label>รหัสสาขา<input value={nb.code} onChange={e => setNb({ ...nb, code: e.target.value })} /></label>
            <label>ชื่อสาขา<input value={nb.name} onChange={e => setNb({ ...nb, name: e.target.value })} /></label>
            <label>พื้นที่<input value={nb.area} onChange={e => setNb({ ...nb, area: e.target.value })} /></label></div></>}
        <p><button onClick={addBranch}>เพิ่มสาขาให้บริษัท{pick.size + (nb.code.trim() && nb.name.trim() ? 1 : 0) > 0 ? ` (${pick.size + (nb.code.trim() && nb.name.trim() ? 1 : 0)} สาขา)` : ""}</button></p></div>
      <h2>บริษัท</h2><div className="tbl"><table><thead><tr><th>บริษัท</th><th>เลขผู้เสียภาษี</th><th className="num">สาขา</th><th>สถานะ</th><th></th></tr></thead><tbody>
        {clients.map(c => <tr key={c.id}><td>{c.name}<br /><small>{c.code}</small></td><td>{c.tax_id}</td><td className="num">{branches.filter(b => b.client_id === c.id).length}</td>
          <td>{c.active ? "ใช้งาน" : "ปิด"}</td><td><div className="row" style={{ marginBottom: 0 }}><button className="sec" onClick={() => { setEditB(null); setEditC({ ...c }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>แก้ไข</button><button className="sec" onClick={() => { setNb({ ...nb, client_id: c.id }); setPick(new Set()); document.getElementById("add-branch")?.scrollIntoView({ behavior: "smooth" }); }}>เพิ่มสาขา</button><a className="btn btn-outline" href={`/companies/${c.id}`}>เอกสาร</a></div></td></tr>)}</tbody></table></div>
      <h2>สาขา</h2><div className="tbl"><table><thead><tr><th>บริษัท</th><th>สาขา</th><th>พื้นที่</th><th>สถานะ</th><th></th></tr></thead><tbody>
        {branches.map(b => <tr key={b.id}><td>{clients.find(c => c.id === b.client_id)?.name}</td><td>{b.code} {b.name}</td><td>{b.area}</td><td>{b.active ? "ใช้งาน" : "ปิด"}</td>
          <td><button className="sec" onClick={() => { setEditC(null); setEditB({ ...b }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>แก้ไข</button></td></tr>)}</tbody></table></div>
    </>}

    {tab === "audit" && <div className="tbl"><table><thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>รายละเอียด</th></tr></thead><tbody>
      {logs.map(l => <tr key={l.id}><td style={{ whiteSpace: "nowrap" }}>{new Date(l.at).toLocaleString("th-TH")}</td><td>{l.user_id ? userName(l.user_id) : "ระบบ"}</td>
        <td>{ACT[l.action] ?? l.action}</td><td>{describe(l)}</td></tr>)}
      {!logs.length && <tr><td colSpan={4}>ยังไม่มีประวัติ</td></tr>}</tbody></table></div>}
  </AppShell>;
}
