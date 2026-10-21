"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import PageHead from "@/components/PageHead";
import { sb } from "@/lib/supabase";

export default function Companies() {
  const [cs, setCs] = useState<any[]>([]), [bs, setBs] = useState<any[]>([]), [dc, setDc] = useState<Record<string, number>>({}), [done, setDone] = useState(false);
  useEffect(() => { (async () => {
    setCs((await sb.from("clients").select("*").order("name")).data ?? []);
    setBs((await sb.from("branches").select("id,client_id,code,name").order("code")).data ?? []);
    const n: Record<string, number> = {}; ((await sb.from("documents").select("client_id").eq("scope", "client")).data ?? []).forEach((d: any) => { n[d.client_id] = (n[d.client_id] ?? 0) + 1; });
    setDc(n); setDone(true); })(); }, []);
  return <AppShell><PageHead title="บริษัทลูกค้า" subtitle="เอกสารและข้อมูลของบริษัทที่คุณมีสิทธิ์เข้าถึง" />
    <div className="card flush"><table><thead><tr><th>บริษัท</th><th>สาขาที่เข้าถึงได้</th><th className="num">เอกสาร</th><th></th></tr></thead><tbody>
      {cs.map(c => <tr key={c.id}><td><Link href={`/companies/${c.id}`}>{c.name}</Link><br /><small>{c.code}{c.tax_id ? ` · ${c.tax_id}` : ""}{!c.active && " · ปิดใช้งาน"}</small></td>
        <td>{bs.filter(b => b.client_id === c.id).map(b => `${b.code} ${b.name}`).join(", ")}</td><td className="num">{dc[c.id] ?? 0}</td>
        <td><Link href={`/companies/${c.id}`} className="btn">เปิด</Link></td></tr>)}
      {done && !cs.length && <tr><td colSpan={4}>ยังไม่มีบริษัทที่คุณเข้าถึงได้ ติดต่อ Admin เพื่อกำหนดสิทธิ์สาขา</td></tr>}</tbody></table></div></AppShell>;
}
