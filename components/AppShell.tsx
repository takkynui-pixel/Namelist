"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { sb } from "@/lib/supabase";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [email, setEmail] = useState(""), [role, setRole] = useState("");
  useEffect(() => { sb.auth.getUser().then(async ({ data }) => {
    if (!data.user) { window.location.href = "/login"; return; }
    setEmail(data.user.email ?? "");
    const { data: p } = await sb.from("profiles").select("role").eq("id", data.user.id).single(); setRole(p?.role ?? ""); }); }, []);
  const items = [{ href: "/", label: "พนักงาน" }, ...(role === "admin" ? [{ href: "/import", label: "นำเข้าจาก Excel" }, { href: "/admin", label: "จัดการระบบ" }] : [])];
  const on = (h: string) => (h === "/" ? path === "/" || path.startsWith("/employee") : path === h);
  return <div className="outer"><div className="shell">
    <header className="topbar">
      <Link href="/" className="logo"><img src="/logo.png" alt="VTA Service" /></Link>
      <nav className="nav">{items.map(i => <Link key={i.href} href={i.href} className={on(i.href) ? "active" : ""}>{i.label}</Link>)}</nav>
      <div className="actions">
        <button className="signout" onClick={async () => { await sb.auth.signOut(); window.location.href = "/login"; }}>ออกจากระบบ</button>
        <div className="avatar" title={email}>{(email[0] ?? "U").toUpperCase()}</div>
      </div>
    </header>
    <main>{children}</main>
  </div></div>;
}
