"use client";
import { useState } from "react";
import { sb } from "@/lib/supabase";
export default function SetPassword() {
  const [pw, setPw] = useState(""), [msg, setMsg] = useState("");
  async function save() {
    if (pw.length < 10) return setMsg("รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร");
    const { error } = await sb.auth.updateUser({ password: pw });
    error ? setMsg("ตั้งรหัสผ่านไม่สำเร็จ: " + error.message + " (ลิงก์อาจหมดอายุ ให้ขอลิงก์ใหม่)") : (window.location.href = "/");
  }
  return <div className="auth"><div className="auth-box"><div className="auth-logo"><img src="/logo.png" alt="VTA Service" /></div>
    <div className="card"><h1>ตั้งรหัสผ่าน</h1><label>รหัสผ่านใหม่ (อย่างน้อย 10 ตัวอักษร)</label>
      <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" onKeyDown={e => e.key === "Enter" && save()} />
      <div className="row" style={{ marginTop: 20 }}><button onClick={save}>บันทึกรหัสผ่าน</button></div>{msg && <p className="err">{msg}</p>}</div></div></div>;
}
