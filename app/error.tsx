"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main-content" className="page-shell">
      <div className="empty-state" role="alert">
        <p className="eyebrow">A SMALL DETOUR</p>
        <h1>We couldn’t load your radar.</h1>
        <p>Give it another try. Your saved plans are still yours.</p>
        <button className="button" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
