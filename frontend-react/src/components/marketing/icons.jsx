/**
 * A small, purpose-built icon set for the marketing site — plain inline
 * SVGs (stroke-based, matching the line-icon style already used elsewhere
 * in this app, e.g. the LinkedIn integration page) rather than pulling in
 * an icon package for a dozen glyphs.
 */
const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };

export function IconLeads(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <path d="M7 13.5h4M7 16h6" />
    </svg>
  );
}

export function IconSources(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M7.9 7.6 10.4 16M16.1 7.6 13.6 16" />
    </svg>
  );
}

export function IconAssign(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 8h5M18.5 5.5v5" />
    </svg>
  );
}

export function IconFollowUp(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <circle cx="12" cy="12.5" r="8" />
      <path d="M12 8v4.5l3 2" />
      <path d="M9 2.5h6" />
    </svg>
  );
}

export function IconAnalytics(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M4 20V10M11 20V4M18 20v-7" />
      <path d="M3 20h18" />
    </svg>
  );
}

export function IconWebForm(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

export function IconCsv(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M6 3.5h8l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M14 3.5V8h4" />
      <path d="M8 13.5h8M8 16.5h5" />
    </svg>
  );
}

export function IconClients(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <circle cx="8" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M2.5 19.5c0-3.3 2.5-5.8 5.5-5.8s5.5 2.5 5.5 5.8" />
      <path d="M15.5 14.5c2.4.2 4 2.1 4 5" />
    </svg>
  );
}

export function IconMeta(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M6 15c0-5 2-9 4.5-9s2.7 3 3.5 3 1-3 3.5-3S22 10 22 15" />
      <path d="M2 15c0-5 2-9 4.5-9s2.7 3 3.5 3" />
    </svg>
  );
}

export function IconGoogle(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.2 2.3 3.4 5.3 3.4 8.5s-1.2 6.2-3.4 8.5c-2.2-2.3-3.4-5.3-3.4-8.5S9.8 5.8 12 3.5Z" />
    </svg>
  );
}

export function IconLinkedIn(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="M8 10.5v6M8 7.8v.1" />
      <path d="M12 16.5v-3.7c0-1.3.9-2.3 2.1-2.3s2 .9 2 2.1v3.9" />
    </svg>
  );
}

export function IconIndiamart(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M4 20V9.5L12 4l8 5.5V20" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}

export function IconCheck(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M4.5 12.5 9 17l10.5-10.5" />
    </svg>
  );
}

export function IconArrow(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M4.5 12h15M13.5 6l6 6-6 6" />
    </svg>
  );
}

export function IconShield(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M12 3.5 19 6.5V11c0 5-3 8.3-7 9.5-4-1.2-7-4.5-7-9.5V6.5Z" />
      <path d="M9 12l2 2 4-4.5" />
    </svg>
  );
}

export function IconPalette(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H16c2.2 0 4-1.8 4-4 0-4-3.6-7-8-7Z" />
      <circle cx="8" cy="10.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="10.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconMail(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="M4.5 6.5 12 12.5l7.5-6" />
    </svg>
  );
}

export function IconLicense(props) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <rect x="3.5" y="4.5" width="17" height="13" rx="2" />
      <circle cx="8.5" cy="11" r="2" />
      <path d="M13 9.5h6M13 12.5h4" />
      <path d="M6.5 20.5 8.5 18l2 2.5" />
    </svg>
  );
}
