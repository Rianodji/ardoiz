/** Ce que le serveur de bout en bout attend de l'application, en processus ou dans l'image de production. */
export interface E2eBackend {
  readonly origin: string;
  /** Crée l'espace et son tuteur (comme la commande init-space), référentiel compris. */
  initSpace(input: {
    spaceName: string;
    spaceCode: string;
    tutorEmail: string;
    tutorName: string;
    tutorPassword: string;
  }): Promise<void>;
  close(): Promise<void>;
}

export interface E2eDatabase {
  readonly appUrl: string;
  readonly ownerUrl: string;
}
