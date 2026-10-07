export default function Loading() {
  return (
    <main id="main-content" className="page-shell" aria-busy="true">
      <p role="status" className="eyebrow">
        Finding what’s on your radar…
      </p>
      <div className="skeleton-list" aria-hidden="true">
        <div className="skeleton-card">
          <span />
          <span>
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className="skeleton-card">
          <span />
          <span>
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className="skeleton-card">
          <span />
          <span>
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    </main>
  );
}
