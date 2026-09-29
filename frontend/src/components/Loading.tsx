/** Squelettes de chargement (handoff Nocturne) : lecture du miroir local, aucun appel réseau. */
export function LoadingState({
  groups = 3,
  caption = "Lecture du miroir local — aucun appel réseau.",
}: {
  groups?: number;
  caption?: string;
}) {
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
