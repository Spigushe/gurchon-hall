import { useRef } from "react";
import { BackRow, Sheet, SheetHeader } from "../../components/Sheet";
import { useIsDesktop } from "../../components/useIsDesktop";
import { useAuthActions } from "./context";
import { LoginForm } from "./LoginForm";

/**
 * Reconnexion depuis le bandeau (file non vide, § « D — écrans ») : un panneau
 * qu'on peut fermer sans se reconnecter, l'application restant utilisable hors
 * ligne pendant ce temps (P3 : pas un écran bloquant). Différent du mur plein
 * écran (`AuthScreen`, mode `"locked"`), réservé au cas où la file est vide.
 */
export function ReconnectSheet({ onClose }: { onClose: () => void }) {
  const { reconnect } = useAuthActions();
  const isDesktop = useIsDesktop();
  const titleId = "reconnect-sheet-title";
  const titleRef = useRef<HTMLHeadingElement>(null);

  return (
    <Sheet titleId={titleId} titleRef={titleRef} onClose={onClose} variant="pushed" data-testid="reconnect-sheet">
      {isDesktop ? (
        <SheetHeader title="Reconnexion" titleId={titleId} titleRef={titleRef} onClose={onClose} />
      ) : (
        <BackRow label="Fermer" onClick={onClose} />
      )}
      <p className="page-meta">
        La session a expiré. Les saisies en attente restent sur cet appareil ; reconnectez-vous pour reprendre leur
        envoi.
      </p>
      <LoginForm
        submitLabel="Se reconnecter"
        onSuccess={async (user) => {
          await reconnect(user);
          onClose();
        }}
      />
    </Sheet>
  );
}
