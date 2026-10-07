import Link from "next/link";
export function EmptyState({
  title,
  children,
  href,
  action,
}: {
  title: string;
  children: React.ReactNode;
  href: string;
  action: string;
}) {
  return (
    <div className="empty-state">
      <p className="eyebrow">ROOM FOR WHAT’S NEXT</p>
      <h2>{title}</h2>
      <p>{children}</p>
      <Link className="button secondary" href={href}>
        {action} ↗
      </Link>
    </div>
  );
}
