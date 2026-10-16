import "./globals.css";
import "@fontsource/inter/latin-400.css"; import "@fontsource/inter/latin-500.css"; import "@fontsource/inter/latin-600.css"; import "@fontsource/inter/latin-700.css";
import "@fontsource/noto-sans-thai/thai-400.css"; import "@fontsource/noto-sans-thai/thai-500.css"; import "@fontsource/noto-sans-thai/thai-600.css"; import "@fontsource/noto-sans-thai/thai-700.css";
export const metadata = { title: "Namelist | VTA Service" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="th"><body>{children}</body></html>;
}
