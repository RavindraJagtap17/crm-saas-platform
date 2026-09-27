import { useRevealOnScroll } from "../../utils/useRevealOnScroll";

/**
 * Wraps children in a fade/slide-in-on-scroll effect (marketing.css's
 * .mkt-reveal). A thin wrapper so section components don't each need to
 * call the hook and stitch the class names together by hand.
 */
export default function Reveal({ as: Tag = "div", delay = 0, className = "", children, ...rest }) {
  const [ref, visible] = useRevealOnScroll();
  const style = delay ? { transitionDelay: `${delay}ms`, ...rest.style } : rest.style;
  return (
    <Tag ref={ref} className={`mkt-reveal ${visible ? "is-visible" : ""} ${className}`.trim()} {...rest} style={style}>
      {children}
    </Tag>
  );
}
