import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientContext } from "../../../../src/app/apiClientContext";
import { AuthScreen } from "../../../../src/features/auth/AuthScreen";
import { LoginForm } from "../../../../src/features/auth/LoginForm";
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

describe("<SignUpForm />", () => {
  it("affiche le motif du mot de passe en aide de champ, sans bloquer la saisie", () => {
    const server = createAuthFakeServer();
    render(
      <ApiClientContext.Provider value={server.client}>
        <SignUpForm onSuccess={() => {}} />
      </ApiClientContext.Provider>,
    );
    expect(
      screen.getByText(/Au moins 12 caractères, dont une minuscule, une majuscule/),
    ).toBeInTheDocument();
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
