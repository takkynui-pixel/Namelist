"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { sb } from "@/lib/supabase";

const ROLE_TH: Record<string, string> = { admin: "Admin", multi_branch_manager: "ผู้จัดการหลายสาขา", branch_officer: "เจ้าหน้าที่สาขา", viewer: "ดูอย่างเดียว" };

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [email, setEmail] = useState(""), [role, setRole] = useState(""), [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { sb.auth.getUser().then(async ({ data }) => {
    if (!data.user) { window.location.href = "/login"; return; }
    setEmail(data.user.email ?? "");
    const { data: p } = await sb.from("profiles").select("role").eq("id", data.user.id).single(); setRole(p?.role ?? ""); }); }, []);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {   // ปิดเมนูโปรไฟล์เมื่อคลิกนอกเมนู หรือกด Esc (แล้วคืนโฟกัสให้ปุ่ม)
    if (!open) return;
    const down = (e: MouseEvent | TouchEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", down); document.addEventListener("touchstart", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("touchstart", down); document.removeEventListener("keydown", key); }; }, [open]);
  const items = [{ href: "/dashboard", label: "ภาพรวม" }, { href: "/", label: "พนักงาน" }, { href: "/companies", label: "บริษัท" }, ...(["admin", "multi_branch_manager", "branch_officer"].includes(role) ? [{ href: "/blacklist", label: "Blacklist" }] : []), ...(role === "admin" ? [{ href: "/import", label: "นำเข้าจาก Excel" }, { href: "/admin", label: "จัดการระบบ" }] : [])];
  const on = (h: string) => (h === "/" ? path === "/" || path.startsWith("/employee") : h === "/companies" ? path.startsWith("/companies") : h === "/blacklist" ? path.startsWith("/blacklist") : path === h);
  return <div className="outer"><div className="shell">
    <header className="topbar">
      <Link href="/" className="logo"><img src="/logo.png" alt="VTA Service" /></Link>
      <nav className="nav">{items.map(i => <Link key={i.href} href={i.href} className={on(i.href) ? "active" : ""}>{i.label}</Link>)}</nav>
      <div className="actions"><div className="menu-wrap" ref={wrap}>
        <button ref={btn} className="avatar" aria-label="เมนูโปรไฟล์" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>{(email[0] ?? "U").toUpperCase()}</button>
        {open && <div className="menu" role="menu">
          <div className="who"><b>{email}</b><span>{ROLE_TH[role] ?? ""}</span></div>
          <Link href="/set-password" role="menuitem">เปลี่ยนรหัสผ่าน</Link>
          <button role="menuitem" className="out" onClick={async () => { await sb.auth.signOut(); window.location.href = "/login"; }}>ออกจากระบบ</button>
        </div>}
      </div></div>
    </header>
    <main>{children}</main>
  </div></div>;
}
