import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { fetchMe } from "../api/identity";

export type Me = NonNullable<Awaited<ReturnType<typeof fetchMe>>>;
export const ME_QUERY = ["me"] as const;

/** Qui est connecté, d'après le serveur (jamais d'après un état local) ; null si personne. */
export function useMe() {
  return useQuery({ queryKey: ME_QUERY, queryFn: fetchMe, staleTime: 60_000 });
}

/** Page d'accueil de chaque espace : élève, parent, tuteur (trois espaces visuellement distincts). */
export function homePathFor(me: Me): string {
  if (me.kind === "tutor") return me.mfaEnrolled ? "/tuteur/familles" : "/double-authentification/activer";
  if (me.kind === "guardian") return "/famille";
  return "/eleve";
}

/**
 * Garde d'accès côté interface : confort de navigation seulement. La vraie décision est prise
 * par le serveur à chaque requête (R2, règle 2).
 */
export function RequireRole({
  roles,
  children,
}: {
  readonly roles: ReadonlyArray<Me["kind"]>;
  readonly children: ReactNode;
}) {
  const me = useMe();
  if (me.isPending) return <p role="status">Chargement…</p>;
  if (me.data === null || me.data === undefined) return <Navigate to="/connexion" replace />;
  if (!roles.includes(me.data.kind)) return <Navigate to={homePathFor(me.data)} replace />;
  return <>{children}</>;
}
