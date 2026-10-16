import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ทำงานฝั่งเซิร์ฟเวอร์เท่านั้น: ใช้ service role หลังตรวจว่าผู้เรียกเป็น Admin
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const svc = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  const { data: u } = await svc.auth.getUser(token);
  if (!u?.user) return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });
  const { data: me } = await svc.from("profiles").select("role,active").eq("id", u.user.id).single();
  if (me?.role !== "admin" || !me.active) return NextResponse.json({ error: "ต้องเป็น Admin" }, { status: 403 });

  const { email, full_name, role } = await req.json();
  if (!/^\S+@\S+\.\S+$/.test(email ?? "")) return NextResponse.json({ error: "อีเมลไม่ถูกต้อง" }, { status: 400 });
  if (!["admin", "multi_branch_manager", "branch_officer", "viewer"].includes(role)) return NextResponse.json({ error: "บทบาทไม่ถูกต้อง" }, { status: 400 });
  const { data, error } = await svc.auth.admin.inviteUserByEmail(email, { data: { full_name }, redirectTo: `${new URL(req.url).origin}/set-password` });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await svc.from("profiles").update({ role, full_name }).eq("id", data.user.id);
  await svc.from("audit_log").insert({ user_id: u.user.id, action: "invite_user", record_id: data.user.id, detail: { email, role } });
  return NextResponse.json({ ok: true });
}
