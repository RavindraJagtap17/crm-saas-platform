import { useState } from "react";
import { useDocumentMeta } from "../../utils/useDocumentMeta";
import Reveal from "../../components/marketing/Reveal";
import ContactMapVisual from "../../components/marketing/ContactMapVisual";
import { IconMail } from "../../components/marketing/icons";

/**
 * No contact/demo backend endpoint exists in this project (checked
 * backend/src/routes/ — nothing for contact or demo submissions), and
 * inventing one is out of scope for a marketing-website task. This form
 * validates and renders correctly, but deliberately does NOT claim a
 * successful submission — see the honest, clearly-worded state below
 * instead of a fake "we received your message" toast.
 *
 * The address/phone below and the Maps link in ContactMapVisual.jsx are
 * real — confirmed with the site owner (MEP is operated by "my E
 * platform" in Sangli, Maharashtra). No email is shown since none was
 * provided; this page still won't invent one.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const initialFields = { name: "", email: "", company: "", phone: "", message: "" };

export default function Contact() {
  useDocumentMeta({
    title: "Contact",
    description: "Get in touch with MEP to learn more or book a demo for your agency.",
  });

  const [fields, setFields] = useState(initialFields);
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const setField = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  const validate = () => {
    const next = {};
    if (!fields.name.trim()) next.name = "Name is required.";
    if (!EMAIL_PATTERN.test(fields.email.trim())) next.email = "Enter a valid work email.";
    if (!fields.company.trim()) next.company = "Company or agency name is required.";
    if (!fields.message.trim()) next.message = "Tell us a little about what you need.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitted(true);
  };

  return (
    <section className="mkt-section mkt-contact-page">
      <div className="mkt-container">
        <div className="mkt-contact-grid">
          <Reveal className="mkt-contact-left">
            <div className="mkt-contact-icon">
              <IconMail aria-hidden="true" />
            </div>
            <div className="mkt-eyebrow" style={{ marginBottom: "var(--space-3)" }}>
              Contact
            </div>
            <h1 className="mkt-h1" style={{ fontSize: "clamp(2rem, 4vw, 2.75rem)", marginBottom: "var(--space-4)" }}>
              Talk to us about MEP.
            </h1>
            <p className="mkt-lead" style={{ marginBottom: "var(--space-5)" }}>
              Tell us about your agency and what you&apos;re looking for, and we&apos;ll follow up.
            </p>

            <div className="mkt-contact-details">
              <span>Sangli Wada, 80 Feet Rd, behind Mardav Jewellers, Sangli, Maharashtra 416415</span>
              <span aria-hidden="true">•</span>
              <a href="tel:+918698877771">086988 77771</a>
            </div>

            <div className="mkt-contact-info">
              <div>
                <h2 className="mkt-h3" style={{ marginBottom: "var(--space-2)" }}>
                  What to expect
                </h2>
                <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                  Share a few details about your agency and what you&apos;re trying to solve. We&apos;ll follow up to learn
                  more and see whether MEP is a good fit.
                </p>
              </div>
              <div>
                <h2 className="mkt-h3" style={{ marginBottom: "var(--space-2)" }}>
                  Already have an account?
                </h2>
                <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                  If your agency already uses MEP, sign in from the login page instead of submitting a request here.
                </p>
              </div>
            </div>

            <ContactMapVisual />
          </Reveal>

          <Reveal delay={100} className="mkt-contact-form">
            {submitted ? (
              <div className="alert alert-info" role="status">
                <span>ℹ</span>
                <span>
                  Thanks for the interest — this form isn&apos;t connected to a live inbox yet, so nothing was sent. Please
                  check back once this is wired up, or reach out through your usual MEP contact in the meantime.
                </span>
              </div>
            ) : (
              <form noValidate onSubmit={handleSubmit}>
                <div className="field">
                  <label className="label" htmlFor="ct-name">
                    Name
                  </label>
                  <input className="input" id="ct-name" value={fields.name} onChange={setField("name")} placeholder="Jane Doe" />
                  {errors.name ? <div className="field-error">{errors.name}</div> : null}
                </div>
                <div className="field">
                  <label className="label" htmlFor="ct-email">
                    Work Email
                  </label>
                  <input className="input" type="email" id="ct-email" value={fields.email} onChange={setField("email")} placeholder="jane@agency.com" />
                  {errors.email ? <div className="field-error">{errors.email}</div> : null}
                </div>
                <div className="field">
                  <label className="label" htmlFor="ct-company">
                    Company / Agency
                  </label>
                  <input className="input" id="ct-company" value={fields.company} onChange={setField("company")} placeholder="Acme Leads Co." />
                  {errors.company ? <div className="field-error">{errors.company}</div> : null}
                </div>
                <div className="field">
                  <label className="label" htmlFor="ct-phone">
                    Phone <span className="optional">(optional)</span>
                  </label>
                  <input className="input" id="ct-phone" value={fields.phone} onChange={setField("phone")} placeholder="+1 555 000 0000" />
                </div>
                <div className="field">
                  <label className="label" htmlFor="ct-message">
                    Message
                  </label>
                  <textarea className="textarea" id="ct-message" value={fields.message} onChange={setField("message")} placeholder="Tell us about your agency and what you're looking for." />
                  {errors.message ? <div className="field-error">{errors.message}</div> : null}
                </div>
                <button type="submit" className="btn btn-primary w-full mkt-btn-lg">
                  Send message
                </button>
                <p className="mkt-contact-note">We&apos;ll only use these details to follow up about MEP.</p>
              </form>
            )}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
