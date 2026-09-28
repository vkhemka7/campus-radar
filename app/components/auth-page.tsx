export function AuthPage({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-6 py-12 font-sans dark:bg-black">
      <main className="w-full max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{title}</h1>
        <p className="mt-3 text-base leading-7 text-zinc-600 dark:text-zinc-400">{lede}</p>
        {children}
      </main>
    </div>
  );
}
