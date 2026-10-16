import Link from "next/link";
export default function PageHead({ title, subtitle, back }: { title: string; subtitle?: string; back?: { href: string; label: string } }) {
  return <div className="page-head">{back && <Link href={back.href} className="back">← {back.label}</Link>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>;
}
