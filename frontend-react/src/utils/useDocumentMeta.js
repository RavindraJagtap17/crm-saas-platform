import { useEffect } from "react";

const SITE_NAME = "MEP";
const DEFAULT_DESCRIPTION = "MEP is the lead management platform built for agencies — capture, organize, assign, and follow up on leads from one workspace.";

/**
 * Minimal, dependency-free per-page SEO: sets document.title and upserts a
 * <meta name="description">, restoring the previous values on unmount so
 * navigating between public pages (or into the authenticated app, which
 * never calls this hook) never leaves a stale title/description behind.
 * No react-helmet — this app has no head-management library and one
 * isn't warranted for six static page titles.
 */
export function useDocumentMeta({ title, description = DEFAULT_DESCRIPTION }) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title ? `${title} — ${SITE_NAME}` : `${SITE_NAME} — Lead Management Platform for Agencies`;

    let meta = document.querySelector('meta[name="description"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    const previousDescription = meta.getAttribute("content");
    meta.setAttribute("content", description);

    return () => {
      document.title = previousTitle;
      if (created) {
        meta.remove();
      } else if (previousDescription !== null) {
        meta.setAttribute("content", previousDescription);
      }
    };
  }, [title, description]);
}
