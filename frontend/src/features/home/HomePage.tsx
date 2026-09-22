import { Link } from "../../app/Link";
import { plural } from "../../labels";
import { useLocalDecks, useLocalStock } from "../../offline/vtes";
import { CatalogPanel } from "../catalog/CatalogPanel";

/** Point d'entrée : accès aux deux écrans et état du catalogue. */
export function HomePage() {
  const stock = useLocalStock();
  const decks = useLocalDecks({ state: "active" });

  return (
    <div className="page" data-testid="home-page">
      <h2>Accueil</h2>
      <ul className="tiles">
        <li>
          <Link to={{ name: "stock" }} className="tile" data-testid="home-stock">
            <strong>Collection</strong>
            <span>{stock ? plural(stock.length, "entrée") : "…"}</span>
          </Link>
        </li>
        <li>
          <Link to={{ name: "decks" }} className="tile" data-testid="home-decks">
            <strong>Decks</strong>
            <span>{decks ? plural(decks.length, "deck") : "…"}</span>
          </Link>
        </li>
      </ul>
      <CatalogPanel />
    </div>
  );
}
