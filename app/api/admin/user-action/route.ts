import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Admin เท่านั้น: ตั้งรหัสผ่านให้ผู้ใช้ หรือส่งลิงก์ตั้งรหัสผ่านทางอีเมล (ใช้ได้ทั้งผู้ใช้ที่ยังไม่เคยรับคำเชิญ)
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const svc = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  const { data: u } = await svc.auth.getUser(token);
  if (!u?.user) return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });
  const { data: me } = await svc.from("profiles").select("role,active").eq("id", u.user.id).single();
  if (me?.role !== "admin" || !me.active) return NextResponse.json({ error: "ต้องเป็น Admin" }, { status: 403 });

  const { user_id, action, password } = await req.json();
  const { data: t } = await svc.from("profiles").select("email").eq("id", user_id).single();
  if (!t?.email) return NextResponse.json({ error: "ไม่พบผู้ใช้" }, { status: 404 });

  if (action === "set_password") {
    if (typeof password !== "string" || password.length < 10) return NextResponse.json({ error: "รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร" }, { status: 400 });
    const { error } = await svc.auth.admin.updateUserById(user_id, { password, email_confirm: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await svc.from("audit_log").insert({ user_id: u.user.id, action: "admin_set_password", record_id: user_id, detail: {} });
    return NextResponse.json({ ok: true });
  }
  if (action === "send_reset") {
    const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { error } = await anon.auth.resetPasswordForEmail(t.email, { redirectTo: `${new URL(req.url).origin}/set-password` });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await svc.from("audit_log").insert({ user_id: u.user.id, action: "admin_send_reset", record_id: user_id, detail: {} });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "คำสั่งไม่ถูกต้อง" }, { status: 400 });
}
