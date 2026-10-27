"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import PageHead from "@/components/PageHead";
import { sb } from "@/lib/supabase";

const MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const mLabel = (m: string) => MON[+m.slice(5, 7) - 1];
const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString("th-TH");
const pct = (a: number, b: number) => (b > 0 ? (a * 100) / b : 0);
const turn = (r: any) => { const avg = (r.working + r.hc12) / 2; return avg > 0 ? (r.res12 * 100) / avg : 0; };

type Tone = "warn" | "info" | "good";
const REASON_TIP: Record<string, string> = {
  "ได้งานใหม่": "ควรสัมภาษณ์ก่อนลาออกและเทียบค่าตอบแทน/สวัสดิการกับตลาด",
  "ขาดงาน / ติดต่อไม่ได้": "ควรติดตามผู้ขาดงานตั้งแต่วันที่ 1–2 และมีขั้นตอนติดต่อครอบครัว/ผู้ค้ำประกัน",
  "ไม่มาเริ่มงาน": "ควรยืนยันวันเริ่มงานล่วงหน้า 1–2 วัน และสำรองผู้สมัครไว้",
  "บรรจุ / ส่งคืน / หมดสัญญา": "ควรวางแผนกำลังคนตามรอบสัญญาของลูกค้าและเตรียมคนทดแทนล่วงหน้า",
  "กลับภูมิลำเนา": "ควรพิจารณาสรรหาในพื้นที่ใกล้ที่พัก หรือสนับสนุนที่พัก/การเดินทาง",
  "สุขภาพ / ครอบครัว / ศึกษาต่อ": "ควรพิจารณาการลาหรือปรับกะสำหรับกรณีที่แก้ได้",
  "ผลงาน / วินัย": "ควรทบทวนเกณฑ์คัดเลือกและการสอนงานช่วงทดลองงาน" };

function insights(d: any): { tone: Tone; title: string; text: string }[] {
  const k = d.kpi, out: { tone: Tone; title: string; text: string }[] = [], w = k.w || 0;
  const net = k.hire30 - k.res30;
  out.push(net < 0 ? { tone: "warn", title: "30 วันล่าสุด ลาออกมากกว่าเข้าใหม่", text: `ลาออก ${fmt(k.res30)} คน เข้าใหม่ ${fmt(k.hire30)} คน (สุทธิ ${fmt(net)}) ควรตรวจสอบแผนสรรหาและงานที่ยังขาดคน` }
    : { tone: "good", title: "30 วันล่าสุด กำลังคนเพิ่มขึ้นหรือคงที่", text: `เข้าใหม่ ${fmt(k.hire30)} คน ลาออก ${fmt(k.res30)} คน (สุทธิ +${fmt(net)})` });
  if (k.turnover_12m != null) out.push({ tone: k.turnover_12m >= 30 ? "warn" : "info", title: `อัตราลาออก 12 เดือน ${k.turnover_12m}%`,
    text: `ลาออก ${fmt(k.res12)} คน เทียบกำลังคนเฉลี่ยประมาณ ${fmt(Math.round((w + k.hc12) / 2))} คน ควรเทียบกับเป้าหมายหรือค่าปีก่อน (ตัวเลขขึ้นกับความครบถ้วนของวันที่เริ่มงาน/วันที่ลาออกในระบบ)` });
  if (k.res12_dated > 0 && pct(k.early, k.res12_dated) >= 25) out.push({ tone: "warn", title: `ลาออกภายใน 90 วันแรก ${pct(k.early, k.res12_dated).toFixed(0)}% ของผู้ลาออก`, text: "ชี้ว่าปัญหาอยู่ที่การคัดเลือก การปฐมนิเทศ หรือความตรงกันของงานกับที่แจ้งไว้ ควรสัมภาษณ์ผู้ลาออกกลุ่มนี้" });
  const rs = (d.reasons ?? []) as { name: string; n: number }[], rt = rs.reduce((s, r) => s + r.n, 0), top = rs.find(r => !["อื่นๆ", "ไม่ระบุเหตุผล"].includes(r.name));
  if (top && rt) out.push({ tone: "info", title: `เหตุผลลาออกอันดับ 1: ${top.name} (${pct(top.n, rt).toFixed(0)}%)`, text: REASON_TIP[top.name] ?? "ควรวิเคราะห์เพิ่มเติม" });
  const vague = rs.filter(r => ["อื่นๆ", "ไม่ระบุเหตุผล"].includes(r.name)).reduce((s, r) => s + r.n, 0);
  if (rt && pct(vague, rt) >= 30) out.push({ tone: "info", title: `เหตุผลไม่ชัดเจน ${pct(vague, rt).toFixed(0)}% ของผู้ลาออก`, text: "ควรบันทึกเหตุผลให้ชัดเจนตอนทำรายการลาออก เพื่อให้วิเคราะห์สาเหตุได้แม่นยำขึ้น (การจัดกลุ่มเหตุผลในหน้านี้ใช้คำสำคัญ เป็นค่าประมาณ)" });
  const all = [...(d.by_service ?? []).map((r: any) => ({ ...r, kind: "สาขา" })), ...(d.by_client ?? []).map((r: any) => ({ ...r, kind: "บริษัท" }))].filter((r: any) => (r.working + r.hc12) / 2 >= 20 && r.res12 >= 5);
  const worst = all.sort((a: any, b: any) => turn(b) - turn(a))[0];
  if (worst && k.turnover_12m != null && turn(worst) >= k.turnover_12m * 1.5) out.push({ tone: "warn", title: `${worst.kind} ${worst.name} มีอัตราลาออกสูง ${turn(worst).toFixed(0)}%`, text: `สูงกว่าภาพรวม (${k.turnover_12m}%) อย่างชัดเจน ควรตรวจสอบสภาพงาน ค่าตอบแทน และหัวหน้างานของที่นี่` });
  const topC = (d.by_client ?? [])[0]; if (topC && w && pct(topC.working, w) >= 40) out.push({ tone: "info", title: `พึ่งพาบริษัทเดียวสูง: ${topC.name} (${pct(topC.working, w).toFixed(0)}%)`, text: "หากลูกค้ารายนี้ลดหรือยกเลิกสัญญา จะกระทบกำลังคนและรายได้มาก ควรกระจายความเสี่ยง" });
  const t = d.tenure ?? {}, tt = (t.lt3m ?? 0) + (t.m3_6 ?? 0) + (t.m6_12 ?? 0) + (t.y1_3 ?? 0) + (t.y3_5 ?? 0) + (t.y5p ?? 0), fresh = (t.lt3m ?? 0) + (t.m3_6 ?? 0);
  if (tt && pct(fresh, tt) >= 30) out.push({ tone: "info", title: `พนักงานใหม่ (อายุงานต่ำกว่า 6 เดือน) ${pct(fresh, tt).toFixed(0)}%`, text: "กลุ่มนี้เสี่ยงลาออกสูง ควรมีพี่เลี้ยง/การติดตามผลช่วง 3–6 เดือนแรก" });
  const q = d.quality ?? {};
  if (q.total) {
    const gaps = [["เลขบัญชีธนาคาร", q.no_bank, "warn"], ["เลขบัตรประชาชน", q.no_nid, "warn"], ["วันเริ่มงาน", q.no_hire, "warn"], ["ผู้ติดต่อฉุกเฉิน", q.no_emergency, "info"]] as [string, number, Tone][];
    gaps.filter(([, n]) => pct(n, q.total) >= (n === q.no_emergency ? 20 : 5)).forEach(([nm, n, tone]) => out.push({ tone, title: `ยังไม่มี${nm} ${fmt(n)} คน (${pct(n, q.total).toFixed(0)}%)`,
      text: nm === "วันเริ่มงาน" ? "ทำให้คำนวณอายุงานและกำลังคนย้อนหลังคลาดเคลื่อน ควรเติมให้ครบ" : nm === "เลขบัญชีธนาคาร" ? "ควรเติมให้ครบก่อนรอบจ่ายเงินเดือน" : "ควรเติมให้ครบเพื่อความถูกต้องของทะเบียน" }));
  }
  const a = d.age ?? {}, at = (a.lt25 ?? 0) + (a.a25_34 ?? 0) + (a.a35_44 ?? 0) + (a.a45_54 ?? 0) + (a.a55p ?? 0);
  if (at && pct(a.a55p ?? 0, at) >= 20) out.push({ tone: "info", title: `พนักงานอายุ 55 ปีขึ้นไป ${pct(a.a55p, at).toFixed(0)}%`, text: "ควรวางแผนกำลังคนทดแทนและดูแลด้านสุขภาพ/ความปลอดภัยในการทำงาน" });
  return out;
}

const Ic = ({ d }: { d: string }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const IC = { dl: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3", re: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5", users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  home: "M3 10.5 12 3l9 7.5V21H3zM9 21v-7h6v7", pin: "M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6", bld: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4M9 10h.01M15 10h.01M9 13h.01M15 13h.01" };

function Area({ values, label }: { values: number[]; label: string }) {
  const W = 300, H = 110, min = Math.min(...values), max = Math.max(...values), span = max - min || 1, lo = min - span * 0.15, hi = max + span * 0.15;
  const pts = values.map((v, i) => [(i * W) / Math.max(values.length - 1, 1), H - ((v - lo) / (hi - lo)) * H]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return <svg className="area" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
    <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2f6bff" stopOpacity=".28" /><stop offset="1" stopColor="#2f6bff" stopOpacity="0" /></linearGradient></defs>
    <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#ag)" /><path d={line} fill="none" stroke="#2f6bff" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
  </svg>;
}

function Row({ icon, title, sub, value, share, color, note }: { icon?: string; title: string; sub?: string; value: string; share: number; color?: string; note?: string }) {
  return <div className="drow">{icon && <span className="dicon"><Ic d={icon} /></span>}
    <div className="dmain"><div className="dline"><b>{title}</b><span className="dval">{value}</span></div>
      <div className="dbar" aria-hidden="true"><i style={{ width: `${Math.max(Math.min(share, 100), share > 0 ? 2 : 0)}%`, background: color }} /></div>
      {(sub || note) && <div className="dsub">{sub}{note && <span className="dnote">{note}</span>}</div>}</div></div>;
}

export default function Dashboard() {
  const [d, setD] = useState<any>(null), [err, setErr] = useState(""), [loading, setLoading] = useState(true), [at, setAt] = useState<Date | null>(null);
  const [svcs, setSvcs] = useState<any[]>([]), [clients, setClients] = useState<any[]>([]), [fs, setFs] = useState(""), [fc, setFc] = useState(""), [all, setAll] = useState(false);
  useEffect(() => { sb.from("service_branches").select("id,code,name").order("code").then(({ data }) => setSvcs(data ?? [])); sb.from("clients").select("id,name").order("name").then(({ data }) => setClients(data ?? [])); }, []);
  const load = useCallback(async () => { setLoading(true); setErr("");
    const { data, error } = await sb.rpc("dashboard_overview", { p_service_branch: fs || null, p_client: fc || null });
    if (error) setErr("โหลดข้อมูลไม่สำเร็จ: " + error.message); else { setD(data); setAt(new Date()); } setLoading(false); }, [fs, fc]);
  useEffect(() => { load(); }, [load]);

  const csv = () => { if (!d) return; const k = d.kpi, rows: (string | number)[][] = [["ภาพรวมพนักงาน VTA Service", `ข้อมูล ณ ${at?.toLocaleString("th-TH")}`], [],
      ["ตัวชี้วัด", "ค่า"], ["ทำงานอยู่", k.w], ["ลาพักงาน", k.l], ["รอเริ่มงาน", k.p], ["ลาออกสะสม", k.rs], ["เข้าใหม่ 30 วัน", k.hire30], ["ลาออก 30 วัน", k.res30], ["เข้าใหม่ 12 เดือน", k.hire12], ["ลาออก 12 เดือน", k.res12], ["อัตราลาออก 12 เดือน (%)", k.turnover_12m ?? ""], [],
      ["เดือน", "เข้าใหม่", "ลาออก", "กำลังคนสิ้นเดือน"], ...d.monthly.map((m: any) => [m.m, m.hires, m.resigns, m.headcount]), [],
      ["สาขา VTA", "ทำงานอยู่", "ลาออก 12 เดือน", "อัตราลาออก (%)"], ...d.by_service.map((r: any) => [`${r.code} ${r.name}`, r.working, r.res12, turn(r).toFixed(1)]), [],
      ["บริษัท", "ทำงานอยู่", "ลาออก 12 เดือน", "อัตราลาออก (%)"], ...d.by_client.map((r: any) => [r.name, r.working, r.res12, turn(r).toFixed(1)]), [],
      ["พื้นที่", "ทำงานอยู่", "ลาออก 12 เดือน", "อัตราลาออก (%)"], ...d.by_area.map((r: any) => [r.area, r.working, r.res12, turn(r).toFixed(1)]), [],
      ["เหตุผลการลาออก (12 เดือน)", "จำนวน"], ...d.reasons.map((r: any) => [r.name, r.n])];
    const text = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" })); a.download = `ภาพรวมพนักงาน_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href); };

  const k = d?.kpi, w = k?.w ?? 0, mo = d?.monthly ?? [], maxBar = Math.max(1, ...mo.map((m: any) => Math.max(m.hires, m.resigns)));
  const clientsShown = (d?.by_client ?? []).slice(0, all ? 50 : 8), maxC = Math.max(1, ...(d?.by_client ?? []).map((r: any) => r.working)), maxS = Math.max(1, ...(d?.by_service ?? []).map((r: any) => r.working)), maxA = Math.max(1, ...(d?.by_area ?? []).map((r: any) => r.working));
  const t = d?.tenure ?? {}, tl: [string, number][] = [["ไม่เกิน 3 เดือน", t.lt3m], ["3–6 เดือน", t.m3_6], ["6–12 เดือน", t.m6_12], ["1–3 ปี", t.y1_3], ["3–5 ปี", t.y3_5], ["5 ปีขึ้นไป", t.y5p]];
  const tTot = tl.reduce((s, [, n]) => s + (n ?? 0), 0), a = d?.age ?? {}, al: [string, number][] = [["ต่ำกว่า 25 ปี", a.lt25], ["25–34 ปี", a.a25_34], ["35–44 ปี", a.a35_44], ["45–54 ปี", a.a45_54], ["55 ปีขึ้นไป", a.a55p]];
  const aTot = al.reduce((s, [, n]) => s + (n ?? 0), 0), rs = (d?.reasons ?? []) as { name: string; n: number }[], rTot = rs.reduce((s, r) => s + r.n, 0), q = d?.quality ?? {};
  const ql: [string, number][] = [["เลขบัตรประชาชน", q.no_nid], ["เลขบัญชีธนาคาร", q.no_bank], ["วันเริ่มงาน", q.no_hire], ["วันเกิด", q.no_birth], ["เบอร์โทรศัพท์", q.no_phone], ["ผู้ติดต่อฉุกเฉิน", q.no_emergency]];
  const tips = d ? insights(d) : [];

  return <AppShell><PageHead title="ภาพรวม" subtitle="สรุปข้อมูลพนักงาน บริษัท สาขา และพื้นที่ให้บริการ ตามสิทธิ์ที่คุณเข้าถึงได้" />
    <div className="dbar-top">
      <button className="sec" onClick={csv} disabled={!d}><Ic d={IC.dl} /> ดาวน์โหลดรายงาน</button>
      <button className="sec" onClick={load} disabled={loading}><Ic d={IC.re} /> รีเฟรช</button>
      <span className="dpill" role="status">{at ? `ข้อมูล ณ ${at.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.` : "กำลังโหลด..."}</span></div>
    <div className="row dfilters"><select value={fs} onChange={e => setFs(e.target.value)} aria-label="สาขา VTA"><option value="">ทุกสาขา VTA</option>{svcs.map(s => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select>
      <select value={fc} onChange={e => setFc(e.target.value)} aria-label="บริษัท"><option value="">ทุกบริษัท</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
    {err && <p className="err" role="alert">{err}</p>}
    {!d && loading && <p className="mut">กำลังโหลดข้อมูล...</p>}
    {d && <div className={loading ? "dgrid dloading" : "dgrid"}>
      <section className="dcard dhero" aria-label="พนักงานที่ทำงานอยู่">
        <div className="dhead"><span className="dhico"><Ic d={IC.users} /></span><Link href="/" className="dhbtn">ดูรายชื่อ</Link></div>
        <h2>พนักงานที่ทำงานอยู่</h2><div className="dbig">{fmt(w)}</div>
        <p className="dhsub">ใน {fmt(d.scope.companies)} บริษัท · {fmt(d.scope.service_branches)} สาขา VTA · ลาออกสะสม {fmt(k.rs)} คน{d.blacklist != null ? ` · Blacklist ${fmt(d.blacklist)}` : ""}</p>
        <div className="dseg" aria-hidden="true"><i style={{ flex: k.a || 0.0001, background: "#fff" }} /><i style={{ flex: k.l || 0.0001, background: "#ffd166" }} /><i style={{ flex: k.p || 0.0001, background: "#ff8a80" }} /></div>
        <div className="dleg"><span><u style={{ background: "#fff" }} />ทำงาน {fmt(k.a)}</span><span><u style={{ background: "#ffd166" }} />ลาพักงาน {fmt(k.l)}</span><span><u style={{ background: "#ff8a80" }} />รอเริ่มงาน {fmt(k.p)}</span></div>
      </section>
      <section className="dcard"><h2>เข้า-ออก 30 วันล่าสุด</h2>
        <div className="dtwo"><div><small>เข้าใหม่</small><div className="dnum ok">+{fmt(k.hire30)}</div></div><div><small>ลาออก</small><div className="dnum err">−{fmt(k.res30)}</div></div></div>
        <span className={k.hire30 - k.res30 >= 0 ? "dtag good" : "dtag bad"}>สุทธิ {k.hire30 - k.res30 >= 0 ? "+" : "−"}{fmt(Math.abs(k.hire30 - k.res30))}</span>
        <p className="mut dsm">12 เดือน: เข้าใหม่ {fmt(k.hire12)} · ลาออก {fmt(k.res12)}</p></section>
      <section className="dcard"><h2>อัตราลาออก 12 เดือน</h2><div className="dnum">{k.turnover_12m != null ? `${k.turnover_12m}%` : "-"}</div>
        <p className="mut dsm">ลาออก {fmt(k.res12)} คน จากกำลังคนเฉลี่ย ~{fmt(Math.round((w + k.hc12) / 2))} คน{k.res12_dated > 0 && <><br />ลาออกภายใน 90 วันแรก {pct(k.early, k.res12_dated).toFixed(0)}% ของผู้ลาออก</>}</p></section>
      <section className="dcard"><h2>อายุงานเฉลี่ย</h2><div className="dnum">{k.tenure != null ? Number(k.tenure).toFixed(1) : "-"} <small>ปี</small></div>
        <p className="mut dsm">อายุงานต่ำกว่า 6 เดือน {tTot ? pct((t.lt3m ?? 0) + (t.m3_6 ?? 0), tTot).toFixed(0) : 0}% ของพนักงานที่ทำงานอยู่ (เฉพาะที่มีวันเริ่มงาน)</p></section>

      <section className="dcard dwide"><h2>กำลังคนรายเดือน <small>12 เดือนล่าสุด</small></h2>
        <Area values={mo.map((m: any) => m.headcount)} label={`กำลังคนสิ้นเดือน เริ่ม ${fmt(mo[0]?.headcount)} คน ล่าสุด ${fmt(mo[mo.length - 1]?.headcount)} คน`} />
        <div className="dax"><span>{mo[0] && `${mLabel(mo[0].m)} · ${fmt(mo[0].headcount)}`}</span><span>{mo.length > 0 && `${mLabel(mo[mo.length - 1].m)} · ${fmt(mo[mo.length - 1].headcount)}`}</span></div></section>
      <section className="dcard dwide"><h2>เข้า-ออกรายเดือน <small><u className="lg b" />เข้าใหม่ <u className="lg r" />ลาออก</small></h2>
        <div className="dbars" role="img" aria-label="กราฟแท่งผู้เข้าใหม่และผู้ลาออกรายเดือน">{mo.map((m: any) => <div key={m.m} className="dcol" title={`${mLabel(m.m)} เข้าใหม่ ${m.hires} · ลาออก ${m.resigns}`}>
          <div className="dpair"><i className="b" style={{ height: `${(m.hires / maxBar) * 100}%` }} /><i className="r" style={{ height: `${(m.resigns / maxBar) * 100}%` }} /></div><span>{mLabel(m.m)}</span></div>)}</div>
        <p className="mut dsm">เดือนล่าสุด: เข้าใหม่ {fmt(mo[mo.length - 1]?.hires)} · ลาออก {fmt(mo[mo.length - 1]?.resigns)} (เดือนปัจจุบันยังไม่ครบเดือน)</p></section>

      <section className="dcard"><h2>ตามสาขา VTA</h2>{(d.by_service as any[]).map(r => <Row key={r.id} icon={IC.home} title={`${r.code} ${r.name}`} value={fmt(r.working)} share={pct(r.working, maxS)}
        sub={`ดูแล ${fmt(r.companies)} บริษัท${r.area ? ` · ${r.area}` : ""}`} note={`ลาออก 12 เดือน ${fmt(r.res12)} (${turn(r).toFixed(0)}%)`} />)}
        {!d.by_service.length && <p className="mut">ไม่มีข้อมูล</p>}</section>
      <section className="dcard"><h2>ตามพื้นที่ให้บริการ</h2>{(d.by_area as any[]).map(r => <Row key={r.area} icon={IC.pin} title={r.area} value={fmt(r.working)} share={pct(r.working, maxA)} color="#4cc38a" note={`ลาออก 12 เดือน ${fmt(r.res12)} (${turn(r).toFixed(0)}%)`} />)}
        {!d.by_area.length && <p className="mut">ไม่มีข้อมูล</p>}</section>
      <section className="dcard"><h2>ตามบริษัทลูกค้า</h2>{clientsShown.map((r: any) => <Row key={r.id} icon={IC.bld} title={r.name} value={fmt(r.working)} share={pct(r.working, maxC)} color="#7c8cf8" note={`ลาออก 12 เดือน ${fmt(r.res12)} (${turn(r).toFixed(0)}%)`} />)}
        {(d.by_client as any[]).length > 8 && <button className="sec" onClick={() => setAll(!all)}>{all ? "แสดงน้อยลง" : `ดูทั้งหมด (${d.by_client.length})`}</button>}{!d.by_client.length && <p className="mut">ไม่มีข้อมูล</p>}</section>

      <section className="dcard"><h2>เหตุผลการลาออก <small>12 เดือน (จัดกลุ่มโดยประมาณ)</small></h2>{rs.map(r => <Row key={r.name} title={r.name} value={`${fmt(r.n)} · ${pct(r.n, rTot).toFixed(0)}%`} share={pct(r.n, rs[0]?.n || 1)} color="#ff8a65" />)}{!rs.length && <p className="mut">ไม่มีผู้ลาออกใน 12 เดือน</p>}</section>
      <section className="dcard"><h2>อายุงาน</h2>{tl.map(([n, v]) => <Row key={n} title={n} value={`${fmt(v)} · ${pct(v ?? 0, tTot).toFixed(0)}%`} share={pct(v ?? 0, Math.max(...tl.map(x => x[1] ?? 0), 1))} />)}{!!t.unknown && <p className="mut dsm">ไม่มีวันเริ่มงาน {fmt(t.unknown)} คน</p>}</section>
      <section className="dcard"><h2>ช่วงอายุ</h2>{aTot ? al.map(([n, v]) => <Row key={n} title={n} value={`${fmt(v)} · ${pct(v ?? 0, aTot).toFixed(0)}%`} share={pct(v ?? 0, Math.max(...al.map(x => x[1] ?? 0), 1))} color="#4cc38a" />) : <p className="mut">ยังไม่มีข้อมูลวันเกิด</p>}{!!a.unknown && aTot > 0 && <p className="mut dsm">ไม่มีวันเกิด {fmt(a.unknown)} คน</p>}</section>

      <section className="dcard"><h2>ความครบถ้วนของข้อมูล <small>พนักงานที่ทำงานอยู่ {fmt(q.total)} คน</small></h2>{ql.map(([n, miss]) => { const ok = q.total ? 100 - pct(miss ?? 0, q.total) : 0;
        return <Row key={n} title={n} value={`${ok.toFixed(0)}%`} share={ok} color={ok >= 95 ? "#4cc38a" : ok >= 80 ? "#ffb74d" : "#ff7043"} sub={miss ? `ยังไม่มี ${fmt(miss)} คน` : "ครบถ้วน"} />; })}</section>
      <section className="dcard dwide"><h2>ข้อสังเกตและข้อเสนอแนะ</h2><p className="mut dsm" style={{ marginTop: 0 }}>สร้างอัตโนมัติจากข้อมูลในระบบด้วยกฎง่ายๆ ใช้ประกอบการตัดสินใจ ไม่ใช่ข้อสรุปสุดท้าย</p>
        {tips.map((x, i) => <div key={i} className={`dtip ${x.tone}`}><b>{x.title}</b><span>{x.text}</span></div>)}</section>
    </div>}
  </AppShell>;
}
