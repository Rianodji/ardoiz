// Fixture volontairement fautive : l'application importe un adaptateur de la plateforme.
import { withTenantTransaction } from "../../platform/tx.ts";

export const unlock = withTenantTransaction;
