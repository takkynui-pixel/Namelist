"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import PageHead from "@/components/PageHead";
import FilesPanel from "@/components/FilesPanel";
import { sb } from "@/lib/supabase";

const CATS = ["สัญญาการบริการ", "ระเบียบสวัสดิการ", "เอกสารอื่นๆ"];
export default function Company() {
  const { id } = useParams<{ id: string }>();
  const [c, setC] = useState<any>(null), [bs, setBs] = useState<any[]>([]), [admin, setAdmin] = useState(false), [nf, setNf] = useState(false);
  useEffect(() => { (async () => {
    const r = await sb.from("clients").select("*").eq("id", id).maybeSingle(); if (!r.data) return setNf(true); setC(r.data);
    setBs((await sb.from("branches").select("id,code,name,area").eq("client_id", id).order("code")).data ?? []);
    const { data: u } = await sb.auth.getUser(); const { data: p } = await sb.from("profiles").select("role").eq("id", u.user!.id).single(); setAdmin(p?.role === "admin"); })(); }, [id]);
  if (nf) return <AppShell><PageHead back={{ href: "/companies", label: "กลับรายการบริษัท" }} title="ไม่พบบริษัท" subtitle="บริษัทนี้ไม่มีอยู่ หรือคุณไม่มีสิทธิ์เข้าถึง" /></AppShell>;
  if (!c) return <AppShell><p className="mut">กำลังโหลด...</p></AppShell>;
  const rows: [string, any][] = [["รหัสบริษัท", c.code], ["เลขประจำตัวผู้เสียภาษี", c.tax_id], ["รอบจ่ายค่าจ้าง", c.pay_cycle], ["วันจ่าย", c.pay_date], ["ที่อยู่", c.address]];
  return <AppShell><PageHead back={{ href: "/companies", label: "กลับรายการบริษัท" }} title={c.name} subtitle={c.active ? undefined : "บริษัทนี้ปิดใช้งานอยู่"} />
    <div className="card"><div className="row" style={{ justifyContent: "space-between" }}><h2 style={{ margin: 0 }}>ข้อมูลบริษัท</h2>{admin && <a className="btn" href="/admin?tab=orgs">แก้ไขข้อมูลบริษัท/สาขา</a>}</div>
      <div className="grid">{rows.map(([k, v]) => <div key={k}><small>{k}</small><div>{v || "-"}</div></div>)}</div></div>
    <div className="card"><h2>สาขา</h2>{bs.length ? <ul>{bs.map(b => <li key={b.id}>{b.code} {b.name}{b.area ? ` (${b.area})` : ""}</li>)}</ul> : <p className="mut">ไม่มีสาขาที่คุณเข้าถึงได้</p>}</div>
    <FilesPanel scope="client" ownerId={id} categories={CATS} />
  </AppShell>;
}
