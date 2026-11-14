import { useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { FileTextIcon } from "@phosphor-icons/react";
import { Link } from "../../../app/Link";
import { useConnectivity } from "../../../offline/react";
import { readDecks, useLocalDecks, useVtesOffline, type LocalDeck } from "../../../offline/vtes";
import {
  decklistFromVdbDeck,
  matchDecklist,
  parseImportInput,
  type CardIndex,
  type ImportSource,
} from "../import";
import { VDB_OFFLINE_MESSAGE, recognitionText } from "../import/importLabels";
import { continueBlocked, linkedDeckOf, type ImportSelection } from "./importSheetModel";
import { ImportFooter } from "./ImportFooter";
import { useReadVdbDeck } from "./useReadVdbDeck";

const MAX_FILE_BYTES = 512 * 1024;

/** Ce qui a été reconnu, dit en clair sous le champ. */
function Recognition({
  source,
  index,
  online,
  linked,
}: {
  source: ImportSource;
  index: CardIndex;
  online: boolean;
  linked: LocalDeck | null;
}) {
  if (source.kind === "empty") {
    return <p className="hint">Collez un export texte de VDB, une liste « 3x Nom », ou l'adresse d'un deck VDB.</p>;
  }
  if (source.kind === "invalid-url") {
    return (
      <p className="error-text" role="alert" data-testid="deck-import-invalid">
        {source.reason}
      </p>
    );
  }
  if (source.kind === "list") {
    const match = matchDecklist(source.decklist.lines, index);
    return (
      <p className="hint" data-testid="deck-import-recognized" data-format={source.decklist.format}>
        {recognitionText(source.decklist.format, match, source.decklist.unreadable.length)}
      </p>
    );
  }
  if (linked) return <LinkedNotice deck={linked} />;
  return (
    <>
      <p className="hint" data-testid="deck-import-recognized" data-format="vdb-deck">
        Lien vers un deck VDB ({source.vdbDeckId}), lu par le serveur.
      </p>
      {!online && (
        <p className="quote-block" data-testid="deck-import-offline">
          {VDB_OFFLINE_MESSAGE}
        </p>
      )}
    </>
  );
}

/** P8 : un deck VDB déjà lié se met à jour, il ne s'importe pas une seconde fois. */
function LinkedNotice({ deck }: { deck: LocalDeck }) {
  return (
    <div className="quote-block" data-testid="deck-import-linked">
      <p>
        Ce deck VDB est déjà lié à « {deck.name}
        {deck.discriminator ? `#${deck.discriminator}` : ""} » : ouvrez ce deck plutôt que d'en créer un second.
      </p>
      <p>
        <Link to={{ name: "deck", key: deck.key }} className="btn-ghost" data-testid="deck-import-linked-open">
          Ouvrir le deck →
        </Link>
      </p>
    </div>
  );
}

/**
 * Étape 1 de la feuille d'import (Lot 9, écran 2) : coller une liste ou une
 * adresse, ou choisir un fichier `.txt`. Une liste se lit et s'apparie ici,
 * hors ligne ; l'adresse d'un deck VDB se lit par le serveur, en ligne
 * seulement (P1, P3).
 */
export function ImportInputStep({
  index,
  catalogEmpty,
  text,
  onTextChange,
  onContinue,
  onCancel,
}: {
  index: CardIndex;
  catalogEmpty: boolean;
  /** Texte saisi, gardé par la feuille : un retour depuis l'aperçu le retrouve. */
  text: string;
  onTextChange: (text: string) => void;
  onContinue: (selection: ImportSelection) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const online = useConnectivity();
  const { db } = useVtesOffline();
  const decks = useLocalDecks({ state: "all" });
  const reader = useReadVdbDeck();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fetchedLinked, setFetchedLinked] = useState<LocalDeck | null>(null);
  const source = useMemo(() => parseImportInput(text), [text]);
  const linked = source.kind === "vdb-deck" ? linkedDeckOf(decks, source.vdbDeckId) : null;

  const blocked = continueBlocked(source, {
    catalogEmpty,
    loading: reader.state.kind === "loading",
    linked: (fetchedLinked ?? linked) !== null,
    online,
  });

  const changeText = (value: string) => {
    onTextChange(value);
    setFetchedLinked(null);
    reader.reset();
  };

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileError("Ce fichier est trop gros pour une liste de deck.");
      return;
    }
    setFileError(null);
    changeText(await file.text());
  };

  const proceed = async () => {
    if (source.kind === "list") return onContinue({ decklist: source.decklist, vdbDeckId: null });
    if (source.kind !== "vdb-deck") return;
    const deck = await reader.read(source.vdbDeckId);
    if (!deck) return;
    // VDB rend son propre identifiant, qui peut différer de l'adresse collée (A7).
    // Relu dans la base : la liste du rendu du clic peut être périmée après la lecture chez VDB.
    const already = linkedDeckOf(await readDecks(db, { state: "all" }), deck.vdb_deck_id);
    if (already) return setFetchedLinked(already);
    onContinue({ decklist: decklistFromVdbDeck(deck), vdbDeckId: deck.vdb_deck_id });
  };

  return (
    <div className="sheet-form deck-import" data-testid="deck-import-input">
      <div className="field">
        <label htmlFor={`${id}-text`}>Liste ou adresse VDB</label>
        <textarea
          id={`${id}-text`}
          className="underline-field deck-import__text"
          value={text}
          onChange={(event) => changeText(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          rows={8}
          placeholder={"https://vdb.im/decks/…\nou\n3x Count Germaine\n2x Blur"}
          data-testid="deck-import-text"
        />
      </div>
      <div className="deck-import__file">
        <input
          ref={fileInput}
          type="file"
          accept=".txt,text/plain"
          hidden
          onChange={(event) => void chooseFile(event)}
          data-testid="deck-import-file"
        />
        <button
          type="button"
          className="btn btn-secondary"
          data-testid="deck-import-file-choose"
          onClick={() => fileInput.current?.click()}
        >
          <FileTextIcon size={16} />
          Choisir un fichier .txt
        </button>
        <span className="hint">exporté de VDB (Exporter, puis Texte)</span>
      </div>
      {fileError && (
        <p className="error-text" role="alert">
          {fileError}
        </p>
      )}

      {catalogEmpty ? (
        <p className="quote-block" data-testid="deck-import-no-catalog">
          Le catalogue n'est pas encore sur cet appareil : il se charge à la première connexion au réseau.
        </p>
      ) : (
        <Recognition source={source} index={index} online={online} linked={fetchedLinked ?? linked} />
      )}
      {reader.state.kind === "error" && (
        <p className="error-text" role="alert" data-testid="deck-import-error">
          {reader.state.message}
        </p>
      )}

      <ImportFooter
        label={source.kind === "vdb-deck" ? "Lire chez VDB" : "Voir l'aperçu"}
        disabled={blocked}
        busy={reader.state.kind === "loading"}
        onClick={() => void proceed()}
        onCancel={onCancel}
        testId="deck-import-continue"
      />
    </div>
  );
}
