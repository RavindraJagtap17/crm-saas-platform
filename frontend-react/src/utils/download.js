// Ported from the old frontend's triggerDownload() (components/ui.js) — an
// object URL + a throwaway <a download> click, revoked right after.
export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
