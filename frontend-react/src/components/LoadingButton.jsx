// Ported from the old frontend's setButtonLoading() (components/ui.js) —
// same visual behavior (is-loading class + spinner + disabled), now a
// proper React component driven by a `loading` prop instead of imperative
// DOM mutation.
export default function LoadingButton({ loading, className = "", children, ...rest }) {
  return (
    <button className={`${className} ${loading ? "is-loading" : ""}`.trim()} disabled={loading || rest.disabled} {...rest}>
      {children}
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
    </button>
  );
}
