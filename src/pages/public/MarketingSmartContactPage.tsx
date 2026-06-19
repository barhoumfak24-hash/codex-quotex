import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { resolveMarketingContactTarget } from "@/lib/marketingSmartLinks";

export function MarketingSmartContactPage() {
  const [searchParams] = useSearchParams();
  const target = useMemo(() => {
    const tenantId = searchParams.get("tenant") || undefined;
    const agency = tenantId ? api.agencies.get(tenantId) : api.agencies.list()[0];
    const customerId = searchParams.get("customer") || undefined;
    const prospectId = searchParams.get("prospect") || undefined;
    const customer = customerId ? api.customers.get(customerId) : null;
    const prospect = prospectId ? api.prospects.get(prospectId) : null;

    return resolveMarketingContactTarget({
      agency,
      customer: customer?.tenantId === agency?.id ? customer : null,
      prospect: prospect?.tenantId === agency?.id ? prospect : null,
      userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    });
  }, [searchParams]);

  useEffect(() => {
    window.location.replace(target);
  }, [target]);

  return (
    <main className="min-h-screen bg-ink-50 px-6 py-16 text-ink-900">
      <div className="mx-auto max-w-md rounded-md border border-ink-100 bg-white p-6 shadow-soft">
        <div className="font-display text-3xl">Opening contact page</div>
        <p className="mt-3 text-sm leading-6 text-ink-600">
          We are sending you to the best contact destination for this device.
        </p>
        <a href={target} className="btn-gold mt-5 inline-flex">
          Continue
        </a>
      </div>
    </main>
  );
}
