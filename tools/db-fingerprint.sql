-- Empreinte d'une base Ardoiz, comparée avant et après une restauration (runbook, L7) : chaque table
-- avec son nombre de lignes et sa RLS (activée, forcée), les politiques, les fonctions SECURITY DEFINER,
-- les droits du rôle d'exécution et les migrations appliquées. À lancer en superutilisateur (la RLS ne
-- s'applique pas : les comptes sont exacts). Aucune donnée personnelle n'en sort.
\pset tuples_only on
\pset format unaligned
SELECT 'table ' || n.nspname || '.' || c.relname
       || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
       || ' lignes=' || (xpath('/row/c/text()',
            query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
 ORDER BY 1;
SELECT 'politique ' || schemaname || '.' || tablename || ' ' || policyname || ' ' || array_to_string(roles, ',')
  FROM pg_policies ORDER BY 1;
SELECT 'definer ' || n.nspname || '.' || p.proname || ' propriétaire=' || pg_get_userbyid(p.proowner)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1;
SELECT 'droit ' || table_schema || '.' || table_name || ' ' || privilege_type
  FROM information_schema.role_table_grants WHERE grantee = 'ardoiz_user' ORDER BY 1;
SELECT 'migration ' || version || ' ' || checksum FROM public.schema_migrations ORDER BY 1;
