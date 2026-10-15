import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <section className="card narrow">
      <h1>Page introuvable</h1>
      <p>Cette page n'existe pas, ou son accès n'est pas autorisé.</p>
      <p>
        <Link to="/">Revenir à l'accueil</Link>
      </p>
    </section>
  );
}
