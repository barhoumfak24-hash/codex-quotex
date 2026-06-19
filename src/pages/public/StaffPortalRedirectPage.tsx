import { useEffect } from "react";
import { Link } from "react-router-dom";
import { buildAgencyWebsiteProfile } from "@/lib/agencyWebsite";
import { useTenant } from "@/lib/tenant";

export function StaffPortalRedirectPage({ target }: { target: "employee" | "master" }) {
  const { agency } = useTenant();
  const profile = agency ? buildAgencyWebsiteProfile(agency) : null;
  const url = target === "master" ? profile?.masterLoginUrl : profile?.employeeLoginUrl;
  const canRedirect = !!url && /^https?:\/\//.test(url);

  useEffect(() => {
    if (canRedirect && url) window.location.assign(url);
  }, [canRedirect, url]);

  return (
    <section className="max-w-xl mx-auto px-6 py-20">
      <h1 className="font-display text-3xl">Staff portal</h1>
      <p className="mt-3 text-sm text-ink-600 leading-relaxed">
        This branded website is separate from the agency operating software. Configure
        <code className="mx-1">VITE_PORTAL_BASE_URL</code> for this website deployment to send
        staff to the correct software sign-in.
      </p>
      {canRedirect && url ? (
        <a className="btn-gold mt-6" href={url}>
          Continue to staff portal
        </a>
      ) : (
        <Link className="btn-outline mt-6" to="/">
          Back to website
        </Link>
      )}
    </section>
  );
}
