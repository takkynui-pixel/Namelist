import * as XLSX from "xlsx";

const norm = (v: any) => String(v ?? "").replace(/\s+/g, "");
const str = (v: any) => { if (v == null) return null; const s = String(v).trim(); return !s || s.startsWith("#") || s === "-" ? null : s; };
const thaiId = (n: string) => { if (!/^\d{13}$/.test(n)) return false; let s = 0; for (let i = 0; i < 12; i++) s += +n[i] * (13 - i); return (11 - (s % 11)) % 10 === +n[12]; };
const PREFIX = /^(นางสาว|น\.ส\.|นส\.|นาย|นาง)\s*/;

export type BLStat = { total: number; withId: number; withCode: number; nameOnly: number; badId: number; checksumBad: number; dupId: number; skipped: number };

// อ่านชีต backlist: คอลัมน์ B=รหัสพนักงาน (อาจเป็น #N/A, -, ว่าง), "เลขที่บัตรประชาชน", "ชื่อ - สกุล" (คำนำหน้า/ชื่อ/สกุล 3 คอลัมน์ บางแถวใส่ชื่อเต็มช่องเดียว), "เหตุผล..."
export function parseBlacklist(ws: XLSX.WorkSheet) {
  const g: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  const st: BLStat = { total: 0, withId: 0, withCode: 0, nameOnly: 0, badId: 0, checksumBad: 0, dupId: 0, skipped: 0 };
  const hi = g.slice(0, 8).findIndex(r => norm(r[1]).startsWith("รหัสพนักงาน"));
  if (hi < 0) return { rows: [] as any[], st, err: 'ไม่พบแถวหัวตาราง (คอลัมน์ B ต้องเป็น "รหัสพนักงาน")' };
  const h = g[hi];
  const cId = h.findIndex(x => norm(x).startsWith("เลขที่บัตร")), cWhy = h.findIndex(x => norm(x).startsWith("เหตุผล"));
  let cName = h.findIndex(x => norm(x).startsWith("ชื่อ-สกุล")); if (cName < 0) cName = 6;
  const rows: any[] = [], ids = new Set<string>();
  for (const r of g.slice(hi + 1)) {
    if (norm(r[1]).startsWith("รหัสพนักงาน")) continue;
    let title = str(r[cName]), first = str(r[cName + 1]); const last = str(r[cName + 2]);
    if (!first && title) { const rest = title.replace(PREFIX, "").trim(); if (rest.length >= 2) { first = rest; title = title.slice(0, title.length - rest.length).trim() || null; } }
    if (!first) { if (title || str(r[1])) st.skipped++; continue; }
    let last2 = last;
    if (!last2 && /\s/.test(first)) { const m = first.match(/^(\S+)\s+(.+)$/); if (m) { first = m[1]; last2 = m[2].trim(); } }   // ชื่อเต็มอยู่ช่องเดียว -> แยกชื่อ/นามสกุล
    st.total++;
    const code = str(r[1]);
    let nid: string | null = null;
    if (cId >= 0 && r[cId] != null && str(r[cId])) {
      const d = (typeof r[cId] === "number" ? String(Math.round(r[cId])) : String(r[cId])).replace(/\D/g, "");
      if (d.length === 13) { nid = d; if (!thaiId(d)) st.checksumBad++; if (ids.has(d)) st.dupId++; ids.add(d); } else st.badId++;
    }
    if (nid) st.withId++; if (code) st.withCode++; if (!nid && !code) st.nameOnly++;
    rows.push({ title_th: title, first_name_th: first, last_name_th: last2, employee_code: code, national_id: nid, reason: cWhy >= 0 ? (str(r[cWhy])?.slice(0, 500) ?? null) : null });
  }
  return { rows, st, err: "" };
}
