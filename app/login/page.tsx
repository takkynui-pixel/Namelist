"use client";
import { useState } from "react";
import { sb } from "@/lib/supabase";
export default function Login() {
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [msg, setMsg] = useState(""), [bad, setBad] = useState(false), [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setMsg("");
    const { error } = await sb.auth.signInWithPassword({ email, password: pw });
    if (error) { setMsg("อีเมลหรือรหัสผ่านไม่ถูกต้อง"); setBad(true); setBusy(false); } else window.location.href = "/";
  }
  async function reset() {
    if (!email) { setBad(true); return setMsg("กรอกอีเมลก่อน"); }
    await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/set-password` });
    setBad(false); setMsg("หากอีเมลนี้มีในระบบ จะได้รับลิงก์ตั้งรหัสผ่านใหม่");
  }
  return <div className="auth"><div className="auth-box">
    <div className="auth-logo"><img src="/logo.png" alt="VTA Service" /></div>
    <div className="card"><h1>เข้าสู่ระบบ Namelist</h1><p className="mut" style={{ margin: 0 }}>ใช้อีเมลที่ได้รับเชิญจากผู้ดูแลระบบ</p>
      <label>อีเมล</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" />
      <label>รหัสผ่าน</label><input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" onKeyDown={e => e.key === "Enter" && submit()} />
      <div className="row" style={{ marginTop: 20 }}><button disabled={busy} onClick={submit}>เข้าสู่ระบบ</button><button className="sec" onClick={reset}>ลืมรหัสผ่าน</button></div>
      {msg && <p className={bad ? "err" : "mut"} style={{ marginBottom: 0 }}>{msg}</p>}</div>
  </div></div>;
}
