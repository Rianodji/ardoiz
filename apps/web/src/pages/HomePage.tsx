import { Link } from "react-router";

export function HomePage() {
  return (
    <section className="card">
      <h1>Bienvenue sur Ardoiz</h1>
      <p>Ici, tu retrouves tes cours, tes séances et tes devoirs.</p>
      <p>
        <Link className="button" to="/connexion">
          Se connecter
        </Link>
      </p>
    </section>
  );
}
