import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientContext } from "../../../../src/app/apiClientContext";
import { AuthScreen } from "../../../../src/features/auth/AuthScreen";
import { LoginForm } from "../../../../src/features/auth/LoginForm";
import { PasswordInput } from "../../../../src/features/auth/PasswordInput";
import { SignUpForm } from "../../../../src/features/auth/SignUpForm";
import { setNavigatorOnLine, restoreNavigatorOnLine } from "../../offline/helpers";
import { createAuthFakeServer } from "./authFakeServer";

afterEach(() => {
  cleanup();
  restoreNavigatorOnLine();
});

describe("<LoginForm />", () => {
  it("désactive l'envoi tant que les deux champs ne sont pas remplis", () => {
    const server = createAuthFakeServer();
    render(
      <ApiClientContext.Provider value={server.client}>
        <LoginForm onSuccess={() => {}} />
      </ApiClientContext.Provider>,
    );
    expect(screen.getByTestId("login-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("login-email"), { target: { value: "a@x.fr" } });
    expect(screen.getByTestId("login-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("login-password"), { target: { value: "secret" } });
    expect(screen.getByTestId("login-submit")).toBeEnabled();
  });

  it("appelle onSuccess avec le compte reçu sur des identifiants valides", async () => {
    const server = createAuthFakeServer([
      { id: 7, email: "a@x.fr", username: "alice", password: "Sup3r$ecret!", role: "user" },
    ]);
    const onSuccess = vi.fn();
    render(
      <ApiClientContext.Provider value={server.client}>
        <LoginForm onSuccess={onSuccess} />
      </ApiClientContext.Provider>,
    );
    fireEvent.change(screen.getByTestId("login-email"), { target: { value: "a@x.fr" } });
    fireEvent.change(screen.getByTestId("login-password"), { target: { value: "Sup3r$ecret!" } });
    fireEvent.click(screen.getByTestId("login-submit"));

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: 7, username: "alice" }));
  });

  it("accepte le nom d'utilisateur dans le même champ, envoyé en `identifier`", async () => {
    const server = createAuthFakeServer([
      { id: 7, email: "a@x.fr", username: "alice", password: "Sup3r$ecret!", role: "user" },
    ]);
    const sent: unknown[] = [];
    const onSuccess = vi.fn();
    const client = server.client;
    client.use({
      onRequest: async ({ request }) => {
        if (new URL(request.url).pathname === "/connexion") sent.push(await request.clone().json());
        return request;
      },
    });
    render(
      <ApiClientContext.Provider value={client}>
        <LoginForm onSuccess={onSuccess} />
      </ApiClientContext.Provider>,
    );
    const field = screen.getByTestId("login-email");
    expect(screen.getByLabelText("Adresse e-mail ou nom d'utilisateur")).toBe(field);
    expect(field).toHaveAttribute("type", "text");
    expect(field).toHaveAttribute("autocomplete", "username");
    expect(field).toHaveAttribute("autocapitalize", "none");
    fireEvent.change(field, { target: { value: " alice " } });
    fireEvent.change(screen.getByTestId("login-password"), { target: { value: "Sup3r$ecret!" } });
    fireEvent.click(screen.getByTestId("login-submit"));

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(sent).toEqual([{ identifier: "alice", password: "Sup3r$ecret!" }]);
  });

  it("affiche un seul message pour une adresse inconnue ou un mauvais mot de passe (401)", async () => {
    const server = createAuthFakeServer([
      { id: 1, email: "a@x.fr", username: "alice", password: "Sup3r$ecret!", role: "user" },
    ]);
    render(
      <ApiClientContext.Provider value={server.client}>
        <LoginForm onSuccess={() => {}} />
      </ApiClientContext.Provider>,
    );
    fireEvent.change(screen.getByTestId("login-email"), { target: { value: "a@x.fr" } });
    fireEvent.change(screen.getByTestId("login-password"), { target: { value: "mauvais-mot-de-passe" } });
    fireEvent.click(screen.getByTestId("login-submit"));

    expect(await screen.findByTestId("login-error")).toHaveTextContent("Identifiants invalides.");
  });

  it("indique clairement que la connexion demande le réseau, hors ligne", () => {
    setNavigatorOnLine(false);
    const server = createAuthFakeServer();
    render(
      <ApiClientContext.Provider value={server.client}>
        <LoginForm onSuccess={() => {}} />
      </ApiClientContext.Provider>,
    );
    expect(screen.getByTestId("login-offline-hint")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("login-email"), { target: { value: "a@x.fr" } });
    fireEvent.change(screen.getByTestId("login-password"), { target: { value: "secret" } });
    expect(screen.getByTestId("login-submit")).toBeDisabled();
  });
});

describe("<PasswordInput />", () => {
  it("affiche puis masque la saisie, sans soumettre le formulaire", () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    function Harness() {
      const [value, setValue] = useState("Sup3r$ecret!");
      return (
        <form onSubmit={onSubmit}>
          <PasswordInput id="pw" value={value} onChange={setValue} autoComplete="current-password" data-testid="pw" />
        </form>
      );
    }
    render(<Harness />);
    const field = screen.getByTestId("pw");
    const toggle = screen.getByTestId("pw-toggle");
    expect(field).toHaveAttribute("type", "password");
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("aria-controls", "pw");
    expect(toggle).toHaveAccessibleName("Afficher le mot de passe");

    fireEvent.click(toggle);
    expect(field).toHaveAttribute("type", "text");
    expect(field).toHaveValue("Sup3r$ecret!");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveAccessibleName("Masquer le mot de passe");

    fireEvent.change(field, { target: { value: "autre" } });
    expect(field).toHaveValue("autre");

    fireEvent.click(toggle);
    expect(field).toHaveAttribute("type", "password");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("équipe les champs de connexion et d'inscription d'un bouton « Afficher »", () => {
    const server = createAuthFakeServer();
    render(
      <ApiClientContext.Provider value={server.client}>
        <LoginForm onSuccess={() => {}} />
        <SignUpForm onSuccess={() => {}} />
      </ApiClientContext.Provider>,
    );
    fireEvent.click(screen.getByTestId("login-password-toggle"));
    expect(screen.getByTestId("login-password")).toHaveAttribute("type", "text");
    // Chaque champ a son propre bouton : celui de l'inscription reste masqué.
    expect(screen.getByTestId("signup-password")).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByTestId("signup-password-toggle"));
    expect(screen.getByTestId("signup-password")).toHaveAttribute("type", "text");
  });
});

describe("<SignUpForm />", () => {
  it("coche les règles du mot de passe au fil de la saisie et retient l'envoi tant qu'une manque", () => {
    const server = createAuthFakeServer();
    render(
      <ApiClientContext.Provider value={server.client}>
        <SignUpForm onSuccess={() => {}} />
      </ApiClientContext.Provider>,
    );
    const field = screen.getByTestId("signup-password");
    const rules = screen.getByTestId("signup-password-rules");
    expect(field).toHaveAttribute("aria-describedby", rules.id);
    const met = () =>
      ["length", "lower", "upper", "digit", "symbol"].map(
        (key) => screen.getByTestId(`password-rule-${key}`).getAttribute("data-met") === "true",
      );
    expect(met()).toEqual([false, false, false, false, false]);

    fireEvent.change(screen.getByTestId("signup-email"), { target: { value: "new@x.fr" } });
    fireEvent.change(screen.getByTestId("signup-username"), { target: { value: "newbie" } });
    fireEvent.change(field, { target: { value: "nuit" } });
    expect(met()).toEqual([false, true, false, false, false]);
    expect(rules).toHaveTextContent("Une minuscule : remplie");
    expect(rules).toHaveTextContent("Une majuscule : manquante");
    expect(screen.getByTestId("signup-submit")).toBeDisabled();

    fireEvent.change(field, { target: { value: "Nuit-de-Lyon" } });
    expect(met()).toEqual([true, true, true, false, true]);
    expect(screen.getByTestId("signup-submit")).toBeDisabled();

    fireEvent.change(field, { target: { value: "Nuit-de-Lyon7" } });
    expect(met()).toEqual([true, true, true, true, true]);
    expect(screen.getByTestId("signup-submit")).toBeEnabled();
  });

  it("affiche le 409 du serveur sur une adresse déjà prise", async () => {
    const server = createAuthFakeServer([
      { id: 1, email: "a@x.fr", username: "alice", password: "Sup3r$ecret!", role: "user" },
    ]);
    render(
      <ApiClientContext.Provider value={server.client}>
        <SignUpForm onSuccess={() => {}} />
      </ApiClientContext.Provider>,
    );
    fireEvent.change(screen.getByTestId("signup-email"), { target: { value: "a@x.fr" } });
    fireEvent.change(screen.getByTestId("signup-username"), { target: { value: "bob" } });
    fireEvent.change(screen.getByTestId("signup-password"), { target: { value: "Sup3r$ecret!" } });
    fireEvent.click(screen.getByTestId("signup-submit"));

    expect(await screen.findByTestId("signup-error")).toHaveTextContent("Cette adresse est déjà utilisée.");
  });

  it("appelle onSuccess sur une inscription réussie", async () => {
    const server = createAuthFakeServer();
    const onSuccess = vi.fn();
    render(
      <ApiClientContext.Provider value={server.client}>
        <SignUpForm onSuccess={onSuccess} />
      </ApiClientContext.Provider>,
    );
    fireEvent.change(screen.getByTestId("signup-email"), { target: { value: "new@x.fr" } });
    fireEvent.change(screen.getByTestId("signup-username"), { target: { value: "newbie" } });
    fireEvent.change(screen.getByTestId("signup-password"), { target: { value: "Sup3r$ecret!" } });
    fireEvent.click(screen.getByTestId("signup-submit"));

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ username: "newbie" }));
  });
});

describe("<AuthScreen />", () => {
  it("bascule entre connexion et inscription, mode « gate »", () => {
    const server = createAuthFakeServer();
    render(
      <ApiClientContext.Provider value={server.client}>
        <AuthScreen mode="gate" onSuccess={() => {}} />
      </ApiClientContext.Provider>,
    );
    expect(screen.getByTestId("login-form")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("auth-tab-signup"));
    expect(screen.getByTestId("signup-form")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("auth-tab-login"));
    expect(screen.getByTestId("login-form")).toBeInTheDocument();
  });

  it("mode « locked » affiche directement la connexion, avec le repère du compte", () => {
    const server = createAuthFakeServer();
    render(
      <ApiClientContext.Provider value={server.client}>
        <AuthScreen mode="locked" lockedAccountLabel="alice" onSuccess={() => {}} />
      </ApiClientContext.Provider>,
    );
    expect(screen.getByTestId("login-form")).toBeInTheDocument();
    expect(screen.getByTestId("auth-locked-hint")).toHaveTextContent("alice");
    expect(screen.queryByTestId("auth-tab-signup")).not.toBeInTheDocument();
  });
});
