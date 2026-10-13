-- 011 · Métriques d'exploitation (L7, verdict L6 §5) : âge de l'outbox et messages en échec, tous espaces
-- confondus, pour Prometheus. Expand seulement (ADR-0008) : une fonction et une politique de lecture.
--
-- Même schéma que le relais (M22) : une fonction étroite exécutée avec les droits du propriétaire, mais qui
-- ne renvoie QUE des nombres agrégés. Ni identifiant, ni espace, ni contenu.

CREATE POLICY metrics_owner_read ON messaging.failed_events FOR SELECT TO ardoiz_owner USING (true);

CREATE FUNCTION messaging.health_snapshot()
  RETURNS TABLE (oldest_pending_seconds double precision, dead_events bigint, retrying_events bigint)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT
      coalesce((SELECT extract(epoch FROM now() - min(o.occurred_at))::double precision
                  FROM messaging.outbox o WHERE o.published_at IS NULL), 0),
      (SELECT count(*) FROM messaging.failed_events f WHERE f.dead AND f.resolved_at IS NULL),
      (SELECT count(*) FROM messaging.failed_events f WHERE NOT f.dead AND f.resolved_at IS NULL)
  $$;

REVOKE ALL ON FUNCTION messaging.health_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION messaging.health_snapshot() TO ardoiz_user;
