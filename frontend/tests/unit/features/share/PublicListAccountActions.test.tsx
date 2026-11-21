import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PublicListAccountActions } from "../../../../src/features/share/PublicListAccountActions";
import { forgetActiveAccountId, rememberActiveAccountId } from "../../../../src/offline/vtes";

afterEach(() => {
  cleanup();
  forgetActiveAccountId();
});

describe("<PublicListAccountActions />", () => {
  it("propose Dupliquer et Comparer quand l'appareil connaît un compte", () => {
    rememberActiveAccountId(7);
    render(<PublicListAccountActions token="aB3x_9pQ" revision={null} />);
    expect(screen.getByTestId("public-list-duplicate")).toHaveAttribute("href", "#/decks?action=dupliquer&liste=aB3x_9pQ");
    expect(screen.getByTestId("public-list-compare")).toHaveAttribute("href", "#/decks?action=comparer&liste=aB3x_9pQ");
    expect(screen.queryByTestId("public-list-sign-in")).toBeNull();
  });

  it("porte la révision brute dans les deux liens", () => {
    rememberActiveAccountId(7);
    render(<PublicListAccountActions token="aB3x_9pQ" revision="100845=1;102366=-1" />);
    expect(screen.getByTestId("public-list-duplicate")).toHaveAttribute(
      "href",
      "#/decks?action=dupliquer&liste=aB3x_9pQ&revision=100845=1;102366=-1",
    );
    expect(screen.getByTestId("public-list-compare")).toHaveAttribute(
      "href",
      "#/decks?action=comparer&liste=aB3x_9pQ&revision=100845=1;102366=-1",
    );
  });

  it("sans compte connu, ne propose qu'un lien pour se connecter, qui garde l'intention", () => {
    render(<PublicListAccountActions token="aB3x_9pQ" revision={null} />);
    expect(screen.getByTestId("public-list-sign-in")).toHaveTextContent("Se connecter pour dupliquer ou comparer");
    expect(screen.getByTestId("public-list-sign-in")).toHaveAttribute("href", "#/decks?action=dupliquer&liste=aB3x_9pQ");
    expect(screen.queryByTestId("public-list-duplicate")).toBeNull();
    expect(screen.queryByTestId("public-list-compare")).toBeNull();
  });
});
