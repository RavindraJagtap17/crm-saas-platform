import { useDocumentMeta } from "../../utils/useDocumentMeta";
import Hero from "../../components/marketing/Hero";
import TrustStrip from "../../components/marketing/TrustStrip";
import ValueProposition from "../../components/marketing/ValueProposition";
import FeatureGrid from "../../components/marketing/FeatureGrid";
import IntegrationsSection from "../../components/marketing/IntegrationsSection";
import AgencySection from "../../components/marketing/AgencySection";
import ProductShowcase from "../../components/marketing/ProductShowcase";
import HowItWorks from "../../components/marketing/HowItWorks";
import BenefitsSection from "../../components/marketing/BenefitsSection";
import CTASection from "../../components/marketing/CTASection";

export default function Home() {
  useDocumentMeta({
    title: "Lead Management Platform for Agencies",
    description:
      "MEP is the lead management platform built for agencies — capture, organize, assign, and follow up with leads from multiple sources, and manage client operations from one place.",
  });

  return (
    <>
      <Hero />
      <TrustStrip />
      <ValueProposition />
      <FeatureGrid />
      <IntegrationsSection />
      <AgencySection />
      <ProductShowcase />
      <HowItWorks />
      <BenefitsSection />
      <CTASection />
    </>
  );
}
