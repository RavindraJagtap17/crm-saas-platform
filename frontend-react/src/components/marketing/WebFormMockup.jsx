/**
 * An original representation of MEP's real embeddable web form feature —
 * not a screenshot. The snippet shown mirrors the real embed's shape (a
 * script tag keyed to a form, see agency WebForms.jsx) without using a
 * real form key or a real client domain.
 */
export default function WebFormMockup() {
  return (
    <figure className="mkt-browser" aria-hidden="true">
      <div className="mkt-browser-bar">
        <div className="mkt-browser-dots">
          <span />
          <span />
          <span />
        </div>
        <div className="mkt-browser-url">yourclient.example / contact</div>
      </div>
      <div className="mkt-browser-body">
        <div className="mkt-formmock">
          <div className="mkt-formmock-embed">
            <span className="mkt-formmock-tag">&lt;script&gt;</span>
            <span>src=&quot;.../crm-lead-widget.js&quot;</span>
            <span>data-form-key=&quot;••••••••••••&quot;</span>
            <span className="mkt-formmock-tag">&lt;/script&gt;</span>
          </div>
          <div className="mkt-formmock-arrow" aria-hidden="true" />
          <div className="mkt-formmock-form">
            <div className="mkt-formmock-field" />
            <div className="mkt-formmock-field" />
            <div className="mkt-formmock-field mkt-formmock-field-lg" />
            <div className="mkt-formmock-submit">Get in touch</div>
          </div>
        </div>
      </div>
    </figure>
  );
}
