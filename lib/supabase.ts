import { createClient } from "@supabase/supabase-js";
export const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
export const STATUS: Record<string,string> = { pending:"รอเริ่มงาน", active:"ทำงานอยู่", on_leave:"ลาพักงาน", resigned:"พ้นสภาพ", blacklisted:"Blacklist" };
