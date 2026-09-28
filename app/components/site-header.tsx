import Link from "next/link";
import { logOut } from "@/app/auth/actions";
import { getViewer } from "@/lib/current-user";

export async function SiteHeader() {
  const viewer = await getViewer();
  const signedIn = viewer.status === "authenticated";

  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="text-sm font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          CampusRadar
        </Link>
        <nav aria-label="Account" className="flex items-center gap-4 text-sm font-medium">
          {signedIn ? (
            <>
              <Link href="/account" className="text-zinc-950 underline decoration-zinc-300 underline-offset-4 dark:text-zinc-50 dark:decoration-zinc-700">
                Account
              </Link>
              <form action={logOut}>
                <button
                  type="submit"
                  className="text-zinc-950 underline decoration-zinc-300 underline-offset-4 dark:text-zinc-50 dark:decoration-zinc-700"
                >
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="text-zinc-950 underline decoration-zinc-300 underline-offset-4 dark:text-zinc-50 dark:decoration-zinc-700">
                Log in
              </Link>
              <Link href="/signup" className="text-zinc-950 underline decoration-zinc-300 underline-offset-4 dark:text-zinc-50 dark:decoration-zinc-700">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
