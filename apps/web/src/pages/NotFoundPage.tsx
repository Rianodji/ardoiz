import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <section className="card">
      <h1>Page introuvable</h1>
      <p>Cette page n'existe pas, ou tu n'y as pas accès.</p>
      <p>
        <Link to="/">Revenir à l'accueil</Link>
      </p>
    </section>
  );
}
