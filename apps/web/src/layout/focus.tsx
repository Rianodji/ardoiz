import { createContext, useContext, useEffect } from "react";

/**
 * Mode « focus » de l'élève pendant une épreuve (charte §6) : la page qui l'active affiche son propre
 * en-tête réduit, et la mise en page retire le menu. Le mode cesse dès que la page est quittée.
 */
export const FocusContext = createContext<(active: boolean) => void>(() => undefined);

export function useFocusMode(active: boolean) {
  const setFocus = useContext(FocusContext);
  useEffect(() => {
    setFocus(active);
    return () => {
      setFocus(false);
    };
  }, [active, setFocus]);
}
