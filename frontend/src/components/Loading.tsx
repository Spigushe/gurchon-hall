/** Squelettes de chargement (handoff Nocturne) : lecture du miroir local, aucun appel réseau. */
export function LoadingState({
  groups = 3,
  caption = "Lecture du miroir local — aucun appel réseau.",
  variant = "list",
}: {
  groups?: number;
  caption?: string;
  /** `"table"` : squelette de tableau (bureau, lignes 42px) — cf. handoff DESKTOP.md « d09 ». */
  variant?: "list" | "table";
}) {
  if (variant === "table") {
    return (
      <div className="loading-state" aria-busy="true" aria-label="Chargement en cours">
        {Array.from({ length: groups }, (_, index) => (
          <div className="skeleton-row" key={index} aria-hidden="true">
            <span className="skeleton skeleton--col-wide" />
            <span className="skeleton skeleton--col" />
            <span className="skeleton skeleton--col" />
            <span className="skeleton skeleton--col-narrow" />
            <span className="skeleton skeleton--col-narrow" />
          </div>
        ))}
        <p className="loading-caption">{caption}</p>
      </div>
    );
  }

  return (
    <div className="loading-state" aria-busy="true" aria-label="Chargement en cours">
      {Array.from({ length: groups }, (_, index) => (
        <div className="skeleton-group" key={index} aria-hidden="true">
          <span className="skeleton skeleton--title" />
          <span className="skeleton skeleton--meta" />
        </div>
      ))}
      <p className="loading-caption">{caption}</p>
    </div>
  );
}
