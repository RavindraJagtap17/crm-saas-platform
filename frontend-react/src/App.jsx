import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth, homeForRole } from "./auth/AuthContext";
import ProtectedRoute from "./auth/ProtectedRoute";
import Shell from "./layouts/Shell";
import MarketingLayout from "./layouts/MarketingLayout";
import ToastContainer from "./components/ToastContainer";
import ConfirmDialogHost from "./components/ConfirmDialogHost";

import SignIn from "./pages/auth/SignIn";
import SignUp from "./pages/auth/SignUp";

import PublicHome from "./pages/public/Home";
import PublicFeatures from "./pages/public/Features";
import PublicSolutions from "./pages/public/Solutions";
import PublicPricing from "./pages/public/Pricing";
import PublicAbout from "./pages/public/About";
import PublicContact from "./pages/public/Contact";
import LegalPlaceholder from "./pages/public/LegalPlaceholder";

import AdminDashboard from "./pages/admin/Dashboard";
import AdminLeads from "./pages/admin/Leads";
import AdminLeadDetail from "./pages/admin/LeadDetail";
import AdminStatuses from "./pages/admin/Statuses";
import AdminSources from "./pages/admin/Sources";
import AdminProducts from "./pages/admin/Products";
import AdminEmployees from "./pages/admin/Employees";
import AdminFollowUps from "./pages/admin/FollowUps";
import AdminMetaIntegration from "./pages/admin/MetaIntegration";
import AdminLinkedinIntegration from "./pages/admin/LinkedinIntegration";
import AdminGoogleIntegration from "./pages/admin/GoogleIntegration";
import AdminIndiamartIntegration from "./pages/admin/IndiamartIntegration";
import AdminAccountInactive from "./pages/admin/AccountInactive";

import EmployeeDashboard from "./pages/employee/Dashboard";
import EmployeeLeads from "./pages/employee/Leads";
import EmployeeLeadDetail from "./pages/employee/LeadDetail";
import EmployeeFollowUps from "./pages/employee/FollowUps";
import EmployeeAccountInactive from "./pages/employee/AccountInactive";

import AgencyClients from "./pages/agency/Clients";
import AgencyBranding from "./pages/agency/Branding";
import AgencyCustomFields from "./pages/agency/CustomFields";
import AgencyWebForms from "./pages/agency/WebForms";
import AgencyAccountInactive from "./pages/agency/AccountInactive";

import SuperAdminOverview from "./pages/super-admin/Overview";
import SuperAdminTenant from "./pages/super-admin/Tenant";
import SuperAdminClient from "./pages/super-admin/Client";
import SuperAdminClientLicensePrice from "./pages/super-admin/ClientLicensePrice";
import SuperAdminIntegrationMonitoring from "./pages/super-admin/IntegrationMonitoring";

/**
 * "/" serves the public marketing homepage to a signed-out visitor, but
 * an already-signed-in user landing here (e.g. a bookmark, or clicking
 * the MEP wordmark while logged in) should still reach their own app
 * instead of being shown the marketing site — same redirect logic
 * ProtectedRoute already uses elsewhere, just inverted.
 */
function RootRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to={homeForRole(user.role)} replace />;
  return <PublicHome />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastContainer />
        <ConfirmDialogHost />
        <Routes>
          <Route element={<MarketingLayout />}>
            <Route path="/" element={<RootRoute />} />
            <Route path="/features" element={<PublicFeatures />} />
            <Route path="/solutions" element={<PublicSolutions />} />
            <Route path="/pricing" element={<PublicPricing />} />
            <Route path="/about" element={<PublicAbout />} />
            <Route path="/contact" element={<PublicContact />} />
            <Route path="/legal/privacy" element={<LegalPlaceholder title="Privacy Policy" />} />
            <Route path="/legal/terms" element={<LegalPlaceholder title="Terms of Service" />} />
          </Route>
          <Route path="/auth" element={<SignIn />} />
          <Route path="/auth/signup" element={<SignUp />} />

          <Route element={<ProtectedRoute roles={["client_admin"]} />}>
            <Route element={<Shell />}>
              <Route path="/admin/dashboard" element={<AdminDashboard />} />
              <Route path="/admin/leads" element={<AdminLeads />} />
              <Route path="/admin/leads/:id" element={<AdminLeadDetail />} />
              <Route path="/admin/statuses" element={<AdminStatuses />} />
              <Route path="/admin/sources" element={<AdminSources />} />
              <Route path="/admin/products" element={<AdminProducts />} />
              <Route path="/admin/employees" element={<AdminEmployees />} />
              <Route path="/admin/follow-ups" element={<AdminFollowUps />} />
              <Route path="/admin/meta-integration" element={<AdminMetaIntegration />} />
              <Route path="/admin/linkedin-integration" element={<AdminLinkedinIntegration />} />
              <Route path="/admin/google-integration" element={<AdminGoogleIntegration />} />
              <Route path="/admin/indiamart-integration" element={<AdminIndiamartIntegration />} />
            </Route>
          </Route>
          <Route element={<ProtectedRoute roles={["client_admin"]} allowBlocked />}>
            <Route element={<Shell />}>
              <Route path="/admin/account-inactive" element={<AdminAccountInactive />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute roles={["client_employee"]} />}>
            <Route element={<Shell />}>
              <Route path="/employee/dashboard" element={<EmployeeDashboard />} />
              <Route path="/employee/leads" element={<EmployeeLeads />} />
              <Route path="/employee/leads/:id" element={<EmployeeLeadDetail />} />
              <Route path="/employee/follow-ups" element={<EmployeeFollowUps />} />
            </Route>
          </Route>
          <Route element={<ProtectedRoute roles={["client_employee"]} allowBlocked />}>
            <Route element={<Shell />}>
              <Route path="/employee/account-inactive" element={<EmployeeAccountInactive />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute roles={["agency_admin"]} />}>
            <Route element={<Shell />}>
              <Route path="/agency/clients" element={<AgencyClients />} />
              <Route path="/agency/branding" element={<AgencyBranding />} />
              <Route path="/agency/custom-fields" element={<AgencyCustomFields />} />
              <Route path="/agency/web-forms" element={<AgencyWebForms />} />
            </Route>
          </Route>
          <Route element={<ProtectedRoute roles={["agency_admin"]} allowBlocked />}>
            <Route element={<Shell />}>
              <Route path="/agency/account-inactive" element={<AgencyAccountInactive />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute roles={["super_admin"]} />}>
            <Route element={<Shell />}>
              <Route path="/super-admin" element={<SuperAdminOverview />} />
              <Route path="/super-admin/tenant/:id" element={<SuperAdminTenant />} />
              <Route path="/super-admin/client/:tenantId/:clientId" element={<SuperAdminClient />} />
              <Route path="/super-admin/client-license-price" element={<SuperAdminClientLicensePrice />} />
              <Route path="/super-admin/integration-monitoring" element={<SuperAdminIntegrationMonitoring />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/auth" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
