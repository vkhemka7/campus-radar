import Link from "next/link";
import { SignOutForm } from "@/app/components/sign-out-form";
import { getViewer } from "@/lib/current-user";

export async function SiteHeader() {
  const viewer = await getViewer();
  const signedIn = viewer.status === "authenticated";

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            ↗
          </span>{" "}
          CampusRadar
        </Link>
        <nav
          aria-label="Account"
          className="flex items-center gap-4 text-sm font-medium"
        >
          {signedIn ? (
            <>
              <Link href="/account" className="header-link">
                Account
              </Link>
              <SignOutForm />
            </>
          ) : (
            <>
              <Link href="/login" className="header-link">
                Log in
              </Link>
              <Link href="/signup" className="header-link">
                Get started ↗
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
