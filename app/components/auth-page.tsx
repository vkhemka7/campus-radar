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
    <div className="auth-shell">
      <aside className="auth-story">
        <p className="eyebrow">YOUR CAMPUS, CONNECTED</p>
        <h2>
          A little curiosity.
          <br />A lot of possibility.
        </h2>
        <p>
          Find your next conversation, career move, or unexpected connection at
          Illinois.
        </p>
        <span className="radar-art" aria-hidden="true">
          <i />
        </span>
      </aside>
      <main id="main-content" className="auth-panel">
        <p className="eyebrow">CAMPUSRADAR / YOUR SPACE</p>
        <h1>{title}</h1>
        <p className="auth-lede">{lede}</p>
        {children}
      </main>
    </div>
  );
}
