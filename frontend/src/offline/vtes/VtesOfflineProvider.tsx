import type { ReactNode } from "react";
import { OfflineProvider } from "../react/OfflineProvider";
import { VtesOfflineContext } from "./context";
import type { VtesOfflineRuntime } from "./runtime";

/** Fournit le runtime VtES (et le runtime générique, et le cycle de vie du moteur). */
export function VtesOfflineProvider({
  runtime,
  children,
}: {
  runtime: VtesOfflineRuntime;
  children: ReactNode;
}) {
  return (
    <VtesOfflineContext.Provider value={runtime}>
      <OfflineProvider runtime={runtime}>{children}</OfflineProvider>
    </VtesOfflineContext.Provider>
  );
}
