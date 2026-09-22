import { ApiResponseError } from "@/lib/api-response";
import { isClerkConfigured, requireHouseholdContext } from "@/lib/auth-context";
import { FinanceDashboard } from "@/components/finance-dashboard";
import { redirect } from "next/navigation";
import { CurrencyProvider } from "@/components/currency-context";

export const dynamic = "force-dynamic";

export default async function Home() {
  let context;
  try {
    context = await requireHouseholdContext();
  } catch (error) {
    if (error instanceof ApiResponseError && error.status === 401) redirect("/sign-in");
    throw error;
  }

  return <CurrencyProvider currency={context.currency}><FinanceDashboard authenticationEnabled={isClerkConfigured()} userName={context.userName} /></CurrencyProvider>;
}
