import DashboardLayout from "@console/layouts/dashboard";
import { isDemoMode } from "@console/utils/demo-mode";
import { DemoOnboardingGate } from "@console/components/DemoOnboarding";

export function ConsoleView() {
  const layout = <DashboardLayout />;
  if (!isDemoMode()) return layout;
  return <DemoOnboardingGate>{layout}</DemoOnboardingGate>;
}
