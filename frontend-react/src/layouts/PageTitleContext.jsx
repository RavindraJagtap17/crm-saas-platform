import { createContext, useContext, useEffect } from "react";

// Lets a page override the Shell's topbar title (falls back to the
// matching nav item's own label otherwise — see Shell.jsx). Replaces the
// old frontend's per-page mountShell({ title }) call.
const PageTitleContext = createContext(null);
export const PageTitleProvider = PageTitleContext.Provider;

export function usePageTitle(title) {
  const setTitle = useContext(PageTitleContext);
  useEffect(() => {
    setTitle?.(title);
    return () => setTitle?.(null);
  }, [title, setTitle]);
}
