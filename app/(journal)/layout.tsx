import { JournalNav } from "@/components/journal-nav";
import Link from "next/link";
import { requireSession } from "../../lib/session";

export const dynamic = "force-dynamic";

export default async function JournalLayout({ children }: { children: React.ReactNode }) {
  await requireSession();

  return (
    <div className="shell">
      {/* Skip link: allows keyboard users to bypass the sidebar nav (WCAG 2.4.1) */}
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Options Journal — home">
          <span className="mark" aria-hidden="true">↗</span>
          <span className="brand-name">Options Journal</span>
        </Link>
        <JournalNav />
      </aside>
      <main className="content" id="main-content" tabIndex={-1}>{children}</main>
    </div>
  );
}
