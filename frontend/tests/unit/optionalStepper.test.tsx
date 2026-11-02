import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OptionalStepper } from "../../src/components/OptionalStepper";

describe("OptionalStepper : bornes du nombre de rondes (QA, correctif D2)", () => {
  const setup = (value: number | null) => {
    const onChange = vi.fn();
    render(<OptionalStepper value={value} onChange={onChange} label="Rondes" />);
    return { onChange, input: screen.getByRole("spinbutton") };
  };

  it("ne produit jamais 0 : la saisie de 0 ou d'un négatif remonte à 1, le schéma serveur exige au moins 1", () => {
    const { onChange, input } = setup(3);
    fireEvent.change(input, { target: { value: "0" } });
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.change(input, { target: { value: "-4" } });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("« − » à 1 revient à « inconnu », jamais à 0 ; vider le champ aussi", () => {
    const { onChange, input } = setup(1);
    fireEvent.click(screen.getByRole("button", { name: "Retirer : Rondes" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("« + » depuis « inconnu » part de 1", () => {
    const { onChange } = setup(null);
    fireEvent.click(screen.getByRole("button", { name: "Ajouter : Rondes" }));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });
});
