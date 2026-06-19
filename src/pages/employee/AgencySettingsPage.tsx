import { useEffect, useState } from "react";
import {
  Ban,
  Building2,
  ExternalLink,
  Globe2,
  Image as ImageIcon,
  Lock,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { MapLink } from "@/components/ui/MapLink";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { subscribeToDbChanges } from "@/lib/db";
import { fmt } from "@/lib/format";
import { mailboxUrl, mailProviderLabel } from "@/lib/mailProvider";
import {
  COMPANY_APP_MONTHLY_ADD_ON_USD,
  COMPANY_WEBSITE_AND_APP_BUNDLE_DISCOUNT_USD,
  COMPANY_WEBSITE_MONTHLY_ADD_ON_USD,
  SOFTWARE_USER_MONTHLY_PRICE_USD,
  TIER_LIMITS,
  WEBSITE_APP_ADD_ON_OPTIONS,
  agencyMonthlyPriceUsd,
  standardAgencyMonthlyPriceUsd,
  websiteAppAddOnMonthlyUsd,
} from "@/lib/tiers";
import type { Agency, Branch, SoftwareSaleWebsiteAppAddOn, SubscriptionTier, User } from "@/types";

const USER_PRESETS = [10, 25, 50];
const WEBSITE_APP_ADD_ON_ORDER: SoftwareSaleWebsiteAppAddOn[] = [
  "none",
  "website",
  "app",
  "website_app",
];

function billingTierForUserSlots(slots: number): SubscriptionTier {
  if (slots <= 10) return "minimum";
  if (slots <= 25) return "mid";
  return "ultra";
}

function lockedInputClass(locked: boolean) {
  return locked
    ? "input pointer-events-none select-none cursor-default bg-ink-50 text-ink-700 opacity-100 focus:border-ink-200 focus:ring-0"
    : "input";
}

function safeNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function splitServiceAreas(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function compactAddress(branch: Branch) {
  return [branch.address, [branch.city, branch.state].filter(Boolean).join(", "), branch.zip]
    .filter(Boolean)
    .join(" - ");
}

function staffAccessStatus(user: User): NonNullable<User["staffAccessStatus"]> {
  if (!user.active) return user.staffAccessStatus === "banned" ? "banned" : "deleted";
  return "active";
}

function staffAccessLabel(user: User) {
  const status = staffAccessStatus(user);
  if (status === "banned") return "Banned";
  if (status === "deleted") return "Deleted";
  return "Active";
}

function staffAccessTone(user: User): "success" | "error" | "neutral" {
  const status = staffAccessStatus(user);
  if (status === "active") return "success";
  if (status === "banned") return "error";
  return "neutral";
}

export function AgencySettingsPage() {
  const { user } = useAuth();
  const { agency: tenantAgency } = useTenant();
  const [, setRev] = useState(0);
  useEffect(() => subscribeToDbChanges(() => setRev((r) => r + 1)), []);

  const [planLocked, setPlanLocked] = useState(true);
  const [planError, setPlanError] = useState<string | null>(null);
  const [draftUsers, setDraftUsers] = useState(TIER_LIMITS.mid.allowedUsers);
  const [draftWebsiteAppAddOn, setDraftWebsiteAppAddOn] =
    useState<SoftwareSaleWebsiteAppAddOn>("none");

  const [profileLocked, setProfileLocked] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState({
    name: "",
    contactEmail: "",
    phone: "",
    address: "",
    website: "",
    serviceAreas: "",
  });
  const [staffNotice, setStaffNotice] = useState<string | null>(null);

  const liveAgency = tenantAgency ? api.agencies.get(tenantAgency.id) ?? tenantAgency : null;
  const agency = liveAgency;

  useEffect(() => {
    if (!agency || !planLocked) return;
    setDraftUsers(agency.allowedUsers);
    setDraftWebsiteAppAddOn(agency.websiteAppAddOn ?? "none");
  }, [agency?.id, agency?.allowedUsers, agency?.websiteAppAddOn, planLocked]);

  useEffect(() => {
    if (!agency || !profileLocked) return;
    setProfileDraft({
      name: agency.name,
      contactEmail: agency.contactEmail,
      phone: agency.phone ?? "",
      address: agency.address ?? "",
      website: agency.website ?? "",
      serviceAreas: agency.serviceAreas.join(", "),
    });
  }, [
    agency?.id,
    agency?.name,
    agency?.contactEmail,
    agency?.phone,
    agency?.address,
    agency?.website,
    agency?.serviceAreas,
    profileLocked,
  ]);

  if (!agency) return null;

  const isManager = user?.role === "manager";
  const staffUsers = api.users
    .list(agency.id)
    .filter((u) => u.role === "agent" || u.role === "manager" || u.role === "csr");
  const activeStaffUsers = staffUsers.filter((u) => u.active);
  const disabledStaffUsers = staffUsers.filter((u) => !u.active);
  const managerCount = activeStaffUsers.filter((u) => u.role === "manager").length;
  const agentCount = activeStaffUsers.filter((u) => u.role === "agent" || u.role === "csr").length;
  const branches = api.branches.listByAgency(agency.id);

  if (!isManager) {
    return (
      <div className="space-y-6">
        <EmployeeBackButton />
        <div>
          <h1 className="font-display text-3xl">Agency setup</h1>
          <p className="text-ink-500 text-sm mt-1">
            Read-only agency information for staff. Plan and monthly billing details are manager-only.
          </p>
        </div>
        <AgencyProfileSummary agency={agency} />
        <MarketingSenderCard agency={agency} editable={false} />
        <AgencyLogoCard agency={agency} editable={false} />
        <BranchesCard
          agencyId={agency.id}
          branches={branches}
          editable={false}
          onChanged={() => setRev((r) => r + 1)}
        />
        <div className="grid gap-4 lg:grid-cols-3">
          <SnapshotCard
            icon={<Users className="h-4 w-4" />}
            label="Staff directory"
            value={`${staffUsers.length}`}
            hint={`${managerCount} managers - ${agentCount} agents`}
          />
          <SnapshotCard
            icon={<Building2 className="h-4 w-4" />}
            label="Locations"
            value={`${branches.length + 1}`}
            hint="Headquarters plus branch offices"
          />
          <SnapshotCard
            icon={<Globe2 className="h-4 w-4" />}
            label="Agency website"
            value={agency.website ? "On file" : "Not set"}
            hint={agency.website ? agency.website : "No agency website URL on file"}
          />
        </div>
      </div>
    );
  }

  const activeAgency = agency;
  const minUserSlots = Math.max(1, activeStaffUsers.length);
  const draftAllowedUsers = Math.max(minUserSlots, draftUsers);
  const draftTier = billingTierForUserSlots(draftAllowedUsers);
  const currentMonthly = agencyMonthlyPriceUsd(agency);
  const currentStandardMonthly = standardAgencyMonthlyPriceUsd(agency);
  const draftPlan: Pick<
    Agency,
    "tier" | "allowedUsers" | "allowedCarriers" | "allowedAiMessagesPerMonth" | "websiteAppAddOn"
  > = {
    tier: draftTier,
    allowedUsers: draftAllowedUsers,
    allowedCarriers: activeAgency.allowedCarriers,
    allowedAiMessagesPerMonth: activeAgency.allowedAiMessagesPerMonth,
    websiteAppAddOn: draftWebsiteAppAddOn,
  };
  const draftMonthly = standardAgencyMonthlyPriceUsd(draftPlan);
  const priceDelta = draftMonthly - currentStandardMonthly;
  const websiteAppAddOnMonthly = websiteAppAddOnMonthlyUsd(draftWebsiteAppAddOn);
  const websiteAppRetailMonthly =
    draftWebsiteAppAddOn === "website_app"
      ? COMPANY_WEBSITE_MONTHLY_ADD_ON_USD + COMPANY_APP_MONTHLY_ADD_ON_USD
      : websiteAppAddOnMonthly;
  const bundleDiscount =
    draftWebsiteAppAddOn === "website_app" ? COMPANY_WEBSITE_AND_APP_BUNDLE_DISCOUNT_USD : 0;
  const hasMasterPriceOverride = typeof agency.monthlyPriceOverrideUsd === "number";

  function resetPlanDraft(source: Agency = activeAgency) {
    setDraftUsers(source.allowedUsers);
    setDraftWebsiteAppAddOn(source.websiteAppAddOn ?? "none");
    setPlanError(null);
  }

  function setDraftUserSlots(slots: number) {
    setDraftUsers(Math.max(minUserSlots, Math.floor(slots) || minUserSlots));
  }

  function savePlan() {
    setPlanError(null);
    const updated = api.agencies.updateSubscriptionLimits(activeAgency.id, draftPlan);
    if (!updated) {
      setPlanError("Plan could not be updated. Try again.");
      return;
    }
    setPlanLocked(true);
    resetPlanDraft(updated);
  }

  function resetProfileDraft(source: Agency = activeAgency) {
    setProfileDraft({
      name: source.name,
      contactEmail: source.contactEmail,
      phone: source.phone ?? "",
      address: source.address ?? "",
      website: source.website ?? "",
      serviceAreas: source.serviceAreas.join(", "),
    });
    setProfileError(null);
  }

  function saveProfile() {
    setProfileError(null);
    if (!profileDraft.name.trim()) {
      setProfileError("Agency name is required.");
      return;
    }
    if (!profileDraft.contactEmail.trim()) {
      setProfileError("Contact email is required.");
      return;
    }
    const updated = api.agencies.update(activeAgency.id, {
      name: profileDraft.name.trim(),
      contactEmail: profileDraft.contactEmail.trim(),
      phone: profileDraft.phone.trim() || undefined,
      address: profileDraft.address.trim() || undefined,
      website: profileDraft.website.trim() || undefined,
      serviceAreas: splitServiceAreas(profileDraft.serviceAreas),
    });
    if (!updated) {
      setProfileError("Agency profile could not be saved. Try again.");
      return;
    }
    setProfileLocked(true);
    resetProfileDraft(updated);
  }

  function changeStaffAccess(target: User, status: NonNullable<User["staffAccessStatus"]>) {
    if (!user) return;
    setStaffNotice(null);
    if (target.id === user.id && status !== "active") {
      setStaffNotice("You cannot disable your own manager account while signed in.");
      return;
    }
    if (status !== "active") {
      const label = status === "banned" ? "ban" : "delete";
      if (!confirm(`${label === "ban" ? "Ban" : "Delete"} ${target.name}? They will lose access, but the agency remains billed for ${activeAgency.allowedUsers} purchased user slots.`)) {
        return;
      }
    }
    const result = api.users.setStaffAccessStatus(target.id, status, user.id);
    if (!result.ok) {
      const message =
        result.reason === "last_active_manager"
          ? "At least one active manager must remain on the agency."
          : result.reason === "seat_capacity"
          ? `Cannot reactivate this user because all ${activeAgency.allowedUsers} purchased seats are active.`
          : "That user could not be updated.";
      setStaffNotice(message);
      return;
    }
    const action =
      status === "active" ? "reactivated" : status === "banned" ? "banned" : "deleted";
    setStaffNotice(
      `${result.user.name} was ${action}. Purchased capacity remains ${activeAgency.allowedUsers} user slots.`
    );
    setRev((r) => r + 1);
  }

  return (
    <div className="space-y-6">
      <EmployeeBackButton />
      <div>
        <h1 className="font-display text-3xl">Agency setup</h1>
        <p className="text-ink-500 text-sm mt-1">
          Manager-only controls for agency plan, profile, branch locations, and staff capacity.
        </p>
      </div>

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <Lock className="h-4 w-4 text-gold-600" /> Agency plan
            </span>
          }
          subtitle={
            planLocked
              ? "Locked. Click Edit plan to change staff seats, website, or Quotex app activation."
              : "Pricing changes only when staff seats, website, or Quotex app activation changes."
          }
          action={
            planLocked ? (
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  resetPlanDraft();
                  setPlanLocked(false);
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit plan
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => {
                    resetPlanDraft();
                    setPlanLocked(true);
                  }}
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
                <button type="button" className="btn-gold text-xs" onClick={savePlan}>
                  <Save className="h-3.5 w-3.5" /> Save
                </button>
              </div>
            )
          }
        />
        {planError && <div className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{planError}</div>}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
          <div className="space-y-5">
            <section className="rounded-lg border border-ink-100 bg-white p-4">
              <div className="grid gap-4 md:grid-cols-[minmax(12rem,18rem)_1fr]">
                <div>
                  <label className="label" htmlFor="plan-user-slots">Staff users</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="btn-outline h-11 w-11 justify-center px-0"
                      disabled={planLocked}
                      onClick={() => setDraftUserSlots(draftAllowedUsers - 1)}
                    >
                      -
                    </button>
                    <input
                      id="plan-user-slots"
                      type="number"
                      min={minUserSlots}
                      className={`${lockedInputClass(planLocked)} h-11 w-24 text-center font-semibold`}
                      value={draftUsers}
                      disabled={planLocked}
                      tabIndex={planLocked ? -1 : 0}
                      onChange={(e) => setDraftUserSlots(safeNumber(e.target.value, minUserSlots))}
                    />
                    <button
                      type="button"
                      className="btn-outline h-11 w-11 justify-center px-0"
                      disabled={planLocked}
                      onClick={() => setDraftUserSlots(draftAllowedUsers + 1)}
                    >
                      +
                    </button>
                  </div>
                  <div className="mt-2 text-[11px] text-ink-500">
                    {staffUsers.length}/{draftPlan.allowedUsers} seats currently used
                  </div>
                </div>
                <div>
                  <div className="label">Quick seat counts</div>
                  <div className="flex flex-wrap gap-2">
                    {USER_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        disabled={planLocked}
                        onClick={() => setDraftUserSlots(preset)}
                        className={`btn-outline text-xs ${
                          draftAllowedUsers === preset ? "border-gold-500 bg-gold-100 text-ink-900" : ""
                        } ${planLocked ? "pointer-events-none select-none cursor-default opacity-100" : ""}`}
                      >
                        {preset} users
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-ink-500">
                    Each staff user is {fmt.money(SOFTWARE_USER_MONTHLY_PRICE_USD)}/mo. Users can be
                    added later as the agency grows.
                  </p>
                </div>
              </div>
            </section>

            <section>
              <div className="label">Website / Quotex app package</div>
              <div className="grid gap-2 md:grid-cols-2">
                {WEBSITE_APP_ADD_ON_ORDER.map((addOn) => {
                  const option = WEBSITE_APP_ADD_ON_OPTIONS[addOn];
                  const selected = draftWebsiteAppAddOn === addOn;
                  return (
                    <button
                      key={addOn}
                      type="button"
                      disabled={planLocked}
                      onClick={() => setDraftWebsiteAppAddOn(addOn)}
                      className={`rounded-md border px-3 py-3 text-left transition ${
                        selected
                          ? "border-gold-500 bg-gold-50 text-ink-900"
                          : "border-ink-200 bg-white text-ink-700 hover:border-gold-300"
                      } ${planLocked ? "pointer-events-none select-none cursor-default opacity-100" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{option.label}</div>
                          <div className="mt-1 text-xs leading-relaxed text-ink-500">{option.description}</div>
                        </div>
                        <div className="shrink-0 text-sm font-semibold">
                          {option.monthlyPriceUsd > 0 ? `${fmt.money(option.monthlyPriceUsd)}/mo` : "No add-on"}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          <div className="rounded-lg border border-ink-100 bg-ink-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-ink-500">
                  {planLocked ? "Monthly subscription" : "Preview monthly"}
                </div>
                <div className="mt-1 text-2xl font-semibold text-ink-900">
                  {fmt.money(planLocked ? currentMonthly : draftMonthly)}
                </div>
              </div>
              <Badge tone={planLocked ? "neutral" : "gold"}>
                {planLocked ? "Locked" : priceDelta === 0 ? "No change" : `${priceDelta > 0 ? "+" : ""}${fmt.money(priceDelta)}`}
              </Badge>
            </div>
            {hasMasterPriceOverride && planLocked && (
              <div className="mt-3 rounded-md border border-gold-200 bg-gold-50 px-3 py-2 text-xs text-ink-700">
                Master price override active. Standard plan value is {fmt.money(currentStandardMonthly)}/mo.
              </div>
            )}
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Staff users</dt>
                <dd className="font-medium">
                  {draftPlan.allowedUsers} x {fmt.money(SOFTWARE_USER_MONTHLY_PRICE_USD)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">User monthly</dt>
                <dd className="font-medium">
                  {fmt.money(draftPlan.allowedUsers * SOFTWARE_USER_MONTHLY_PRICE_USD)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Website / Quotex app package</dt>
                <dd className="font-medium">
                  {websiteAppRetailMonthly > 0 ? fmt.money(websiteAppRetailMonthly) : "None"}
                </dd>
              </div>
              {bundleDiscount > 0 && (
                <div className="flex justify-between gap-3 text-emerald-700">
                  <dt>Bundle savings</dt>
                  <dd className="font-medium">-{fmt.money(bundleDiscount)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3 border-t border-ink-200 pt-2">
                <dt className="font-semibold text-ink-800">Plan monthly</dt>
                <dd className="font-semibold text-ink-900">{fmt.money(draftMonthly)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
              Plan pricing is based on staff seats plus the selected website and Quotex app package only.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Agency profile"
          subtitle={
            profileLocked
              ? "Locked. This is the public agency identity used across portals, emails, and templates."
              : "Update the agency identity, headquarters, and service areas."
          }
          action={
            profileLocked ? (
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  resetProfileDraft();
                  setProfileLocked(false);
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit profile
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => {
                    resetProfileDraft();
                    setProfileLocked(true);
                  }}
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
                <button type="button" className="btn-gold text-xs" onClick={saveProfile}>
                  <Save className="h-3.5 w-3.5" /> Save
                </button>
              </div>
            )
          }
        />
        {profileError && <div className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{profileError}</div>}
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="agency-name">Agency name</label>
            <input
              id="agency-name"
              className={lockedInputClass(profileLocked)}
              value={profileDraft.name}
              disabled={profileLocked}
              tabIndex={profileLocked ? -1 : 0}
              onChange={(e) => setProfileDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="agency-email">Main contact email</label>
            <input
              id="agency-email"
              className={lockedInputClass(profileLocked)}
              value={profileDraft.contactEmail}
              disabled={profileLocked}
              tabIndex={profileLocked ? -1 : 0}
              onChange={(e) => setProfileDraft((d) => ({ ...d, contactEmail: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="agency-phone">Main phone</label>
            <input
              id="agency-phone"
              className={lockedInputClass(profileLocked)}
              value={profileDraft.phone}
              disabled={profileLocked}
              tabIndex={profileLocked ? -1 : 0}
              onChange={(e) => setProfileDraft((d) => ({ ...d, phone: e.target.value }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="agency-website">Website</label>
            <input
              id="agency-website"
              className={lockedInputClass(profileLocked)}
              value={profileDraft.website}
              disabled={profileLocked}
              tabIndex={profileLocked ? -1 : 0}
              onChange={(e) => setProfileDraft((d) => ({ ...d, website: e.target.value }))}
            />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="agency-address">Headquarters address</label>
            <input
              id="agency-address"
              className={lockedInputClass(profileLocked)}
              value={profileDraft.address}
              disabled={profileLocked}
              tabIndex={profileLocked ? -1 : 0}
              onChange={(e) => setProfileDraft((d) => ({ ...d, address: e.target.value }))}
            />
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="agency-service-areas">Service areas</label>
            <input
              id="agency-service-areas"
              className={lockedInputClass(profileLocked)}
              value={profileDraft.serviceAreas}
              disabled={profileLocked}
              tabIndex={profileLocked ? -1 : 0}
              placeholder="Florida, Georgia, South Carolina"
              onChange={(e) => setProfileDraft((d) => ({ ...d, serviceAreas: e.target.value }))}
            />
            <p className="mt-1 text-[11px] text-ink-500">Separate locations with commas.</p>
          </div>
        </div>
      </Card>

      <AgencyLogoCard
        agency={agency}
        onChanged={() => setRev((r) => r + 1)}
      />

      <MarketingSenderCard
        agency={agency}
        editable
        onChanged={() => setRev((r) => r + 1)}
      />

      <BranchesCard agencyId={agency.id} branches={branches} onChanged={() => setRev((r) => r + 1)} />

      <UserInformationCard
        agency={agency}
        users={staffUsers}
        activeUsers={activeStaffUsers}
        disabledUsers={disabledStaffUsers}
        currentUserId={user?.id}
        notice={staffNotice}
        onChangeAccess={changeStaffAccess}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <SnapshotCard
          icon={<Users className="h-4 w-4" />}
          label="Active staff"
          value={`${activeStaffUsers.length}/${agency.allowedUsers}`}
          hint={`${managerCount} managers - ${agentCount} agents`}
        />
        <SnapshotCard
          icon={<Building2 className="h-4 w-4" />}
          label="Locations"
          value={`${branches.length + 1}`}
          hint="Headquarters plus branch offices"
        />
        <SnapshotCard
          icon={<Globe2 className="h-4 w-4" />}
          label="Website / Quotex app"
          value={WEBSITE_APP_ADD_ON_OPTIONS[agency.websiteAppAddOn ?? "none"].label}
          hint={agency.website ? agency.website : "No agency website URL on file"}
        />
      </div>
    </div>
  );
}

function SnapshotCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="rounded-md border border-gold-200 bg-gold-50 p-2 text-gold-700">{icon}</span>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-ink-500">{label}</div>
          <div className="mt-1 text-xl font-semibold text-ink-900">{value}</div>
          <div className="mt-1 truncate text-xs text-ink-500">{hint}</div>
        </div>
      </div>
    </Card>
  );
}

function AgencyProfileSummary({ agency }: { agency: Agency }) {
  return (
    <Card>
      <CardHeader
        title="Agency profile"
        subtitle="Public agency identity and contact information used across staff and customer-facing surfaces."
      />
      <div className="grid gap-3 md:grid-cols-2">
        <InfoRow icon={<Building2 className="h-4 w-4" />} label="Agency name" value={agency.name} />
        <InfoRow icon={<Mail className="h-4 w-4" />} label="Main contact email" value={agency.contactEmail} />
        <InfoRow icon={<Phone className="h-4 w-4" />} label="Main phone" value={agency.phone || "No phone on file"} />
        <InfoRow icon={<Globe2 className="h-4 w-4" />} label="Website" value={agency.website || "No website on file"} />
        <InfoRow
          icon={<MapPin className="h-4 w-4" />}
          label="Headquarters"
          value={agency.address || "No headquarters address on file"}
          mappable={Boolean(agency.address)}
          wide
        />
        <InfoRow
          icon={<MapPin className="h-4 w-4" />}
          label="Service areas"
          value={agency.serviceAreas.length > 0 ? agency.serviceAreas.join(", ") : "No service areas on file"}
          wide
        />
      </div>
    </Card>
  );
}

function MarketingSenderCard({
  agency,
  editable = false,
  onChanged,
}: {
  agency: Agency;
  editable?: boolean;
  onChanged?: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const mailbox = api.mailboxes.agencyMarketing(agency.id);
  const sender = api.mailboxes.resolveAgencyMarketingSender(agency.id);
  const address = sender.fromEmail ?? agency.contactEmail;
  const provider = sender.provider ?? mailbox?.provider ?? "other";
  const requirements = api.mailboxes.productionRequirements(mailbox);

  function refreshDemoSender() {
    api.mailboxes.connectAgencyMarketingDemo(agency.id);
    setNotice("Agency marketing sender refreshed for demo mode.");
    onChanged?.();
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <CardHeader
          title="AI marketing sender"
          subtitle="Company campaigns send from the agency main contact email. Direct client, prospect, holder, and carrier emails send from the logged-in staff mailbox."
        />
        <div className="flex flex-wrap items-center gap-2">
          {address ? (
            <a
              className="btn-outline text-xs"
              href={mailboxUrl(address, provider)}
              target="_blank"
              rel="noreferrer"
            >
              <Mail className="h-3.5 w-3.5" /> Open mailbox
            </a>
          ) : null}
          {editable ? (
            <button className="btn-ghost text-xs" type="button" onClick={refreshDemoSender}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh demo
            </button>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-md border border-ink-100 bg-white p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-500">From name</div>
          <div className="mt-1 truncate text-sm font-semibold text-ink-900">{sender.fromName}</div>
        </div>
        <div className="rounded-md border border-ink-100 bg-white p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-500">From email</div>
          <div className="mt-1 truncate text-sm font-semibold text-ink-900">{address}</div>
        </div>
        <div className="rounded-md border border-ink-100 bg-white p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-500">Provider</div>
          <div className="mt-1 text-sm font-semibold text-ink-900">{mailProviderLabel(provider)}</div>
        </div>
        <div className="rounded-md border border-ink-100 bg-white p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-500">Status</div>
          <div className="mt-1 text-sm font-semibold capitalize text-ink-900">
            {(mailbox?.status ?? sender.status ?? "needs_auth").replace(/_/g, " ")}
          </div>
        </div>
      </div>

      {requirements.length > 0 ? (
        <div className="mt-4 rounded-md border border-gold-200 bg-gold-50 px-3 py-2 text-sm text-ink-700">
          <div className="font-semibold text-ink-900">Production requirements</div>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {requirements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

const AGENCY_LOGO_MAX_WIDTH = 720;
const AGENCY_LOGO_MAX_HEIGHT = 240;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image_load_failed"));
    image.src = dataUrl;
  });
}

async function optimizeAgencyLogo(file: File): Promise<string> {
  const originalDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageFromDataUrl(originalDataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) return originalDataUrl;

  const scale = Math.min(1, AGENCY_LOGO_MAX_WIDTH / width, AGENCY_LOGO_MAX_HEIGHT / height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return originalDataUrl;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const webpDataUrl = canvas.toDataURL("image/webp", 0.92);
  if (webpDataUrl.startsWith("data:image/webp")) return webpDataUrl;
  return canvas.toDataURL("image/png");
}

function AgencyLogoCard({
  agency,
  editable = true,
  onChanged,
}: {
  agency: Agency;
  editable?: boolean;
  onChanged?: () => void;
}) {
  const [locked, setLocked] = useState(true);
  const [draftLogo, setDraftLogo] = useState(agency.logoUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const visibleLogo = editable && !locked ? draftLogo : agency.logoUrl ?? "";

  useEffect(() => {
    if (!locked) return;
    setDraftLogo(agency.logoUrl ?? "");
    setError(null);
  }, [agency.id, agency.logoUrl, locked]);

  function startEdit() {
    setDraftLogo(agency.logoUrl ?? "");
    setError(null);
    setLocked(false);
  }

  function cancelEdit() {
    setDraftLogo(agency.logoUrl ?? "");
    setError(null);
    setLocked(true);
  }

  function saveLogo() {
    const updated = api.agencies.update(agency.id, { logoUrl: draftLogo || "" });
    if (!updated) {
      setError("Agency logo could not be saved. Try again.");
      return;
    }
    setLocked(true);
    setError(null);
    onChanged?.();
  }

  async function handleLogoFiles(files: File[]) {
    const file = files.find((candidate) => candidate.type.startsWith("image/"));
    if (!file) {
      setError("Upload an image file: PNG, JPG, SVG, or WebP.");
      return;
    }
    setReading(true);
    setError(null);
    try {
      const optimizedLogo = await optimizeAgencyLogo(file);
      setDraftLogo(optimizedLogo);
      setReading(false);
    } catch {
      setError("That logo could not be optimized. Try a PNG, JPG, SVG, or WebP image.");
      setReading(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-gold-600" /> Agency logo
          </span>
        }
        subtitle={
          editable
            ? locked
              ? "Locked. Saved agency logo auto-adds to generated email signatures and AI pamphlets."
              : "Upload or replace the agency logo used for generated email signatures, AI pamphlets, and branded agency surfaces."
            : "Read-only agency logo used for branded email signatures, AI pamphlets, and agency-facing surfaces."
        }
        action={
          !editable ? null : locked ? (
            <button type="button" className="btn-ghost text-xs" onClick={startEdit}>
              <Pencil className="h-3.5 w-3.5" /> Edit logo
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button type="button" className="btn-ghost text-xs" onClick={cancelEdit}>
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
              <button type="button" className="btn-gold text-xs" onClick={saveLogo} disabled={reading}>
                <Save className="h-3.5 w-3.5" /> Save logo
              </button>
            </div>
          )
        }
      />
      {error && <div className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
      <div className="grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="flex h-32 w-full items-center justify-center rounded-lg border border-ink-100 bg-white p-4">
          {visibleLogo ? (
            <img
              src={visibleLogo}
              alt={`${agency.name} logo`}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <div className="text-center text-ink-400">
              <ImageIcon className="mx-auto h-8 w-8" />
              <div className="mt-2 text-xs font-medium">No logo uploaded</div>
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-3">
          <div className="rounded-lg border border-ink-100 bg-ink-50/50 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              Email signature behavior
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink-600">
              When a staff member uses an AI-generated or profile-generated email signature and has
              no personal signature image saved, Quotex inserts this agency logo automatically at the
              bottom of outbound email. AI pamphlets use the same saved logo and agency contact details.
            </p>
          </div>
          {editable && !locked && (
            <>
              <FileDropZone
                title={draftLogo ? "Replace agency logo" : "Upload agency logo"}
                help="PNG, JPG, SVG, or WebP. Large images are resized and optimized automatically."
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                disabled={reading}
                busy={reading}
                busyLabel="Optimizing logo..."
                compact
                onFiles={handleLogoFiles}
              />
              {draftLogo && (
                <button type="button" className="btn-outline text-xs" onClick={() => setDraftLogo("")}>
                  <Trash2 className="h-3.5 w-3.5" /> Remove saved logo
                </button>
              )}
            </>
          )}
          <div className="flex items-center gap-2 rounded-md border border-ink-100 bg-white px-3 py-2 text-xs text-ink-500">
            <Lock className="h-3.5 w-3.5 text-gold-700" />
            {editable
              ? locked
                ? "Locked. Click Edit logo before changing the saved agency logo."
                : "Unlocked. Save logo to re-lock this agency branding setting."
              : "Locked for non-manager staff."}
          </div>
        </div>
      </div>
    </Card>
  );
}

function InfoRow({
  icon,
  label,
  value,
  wide = false,
  mappable = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  wide?: boolean;
  mappable?: boolean;
}) {
  return (
    <div className={`rounded-md border border-ink-100 bg-white px-3 py-3 ${wide ? "md:col-span-2" : ""}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-gold-700">{icon}</span>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-ink-500">{label}</div>
          <div className="mt-0.5 break-words text-sm font-medium text-ink-900">
            {mappable ? <MapLink address={value} /> : value}
          </div>
        </div>
      </div>
    </div>
  );
}

function UserInformationCard({
  agency,
  users,
  activeUsers,
  disabledUsers,
  currentUserId,
  notice,
  onChangeAccess,
}: {
  agency: Agency;
  users: User[];
  activeUsers: User[];
  disabledUsers: User[];
  currentUserId?: string;
  notice: string | null;
  onChangeAccess: (user: User, status: NonNullable<User["staffAccessStatus"]>) => void;
}) {
  const activeManagers = activeUsers.filter((user) => user.role === "manager").length;
  const sortedUsers = [...users].sort((a, b) => {
    const statusOrder = Number(!a.active) - Number(!b.active);
    if (statusOrder !== 0) return statusOrder;
    const roleOrder = Number(a.role !== "manager") - Number(b.role !== "manager");
    if (roleOrder !== 0) return roleOrder;
    return a.name.localeCompare(b.name);
  });

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-gold-600" /> User information
          </span>
        }
        subtitle="Manager-only staff access control. Banning or deleting disables access but does not reduce purchased user capacity or monthly billing."
      />

      {notice && (
        <div className="mb-4 rounded-md border border-gold-200 bg-gold-50 px-3 py-2 text-xs font-medium text-ink-700">
          {notice}
        </div>
      )}

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-md border border-ink-100 bg-ink-50 px-3 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Purchased seats
          </div>
          <div className="mt-1 text-xl font-semibold text-ink-900">{agency.allowedUsers}</div>
        </div>
        <div className="rounded-md border border-ink-100 bg-white px-3 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Active users
          </div>
          <div className="mt-1 text-xl font-semibold text-ink-900">{activeUsers.length}</div>
        </div>
        <div className="rounded-md border border-ink-100 bg-white px-3 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Disabled users
          </div>
          <div className="mt-1 text-xl font-semibold text-ink-900">{disabledUsers.length}</div>
        </div>
        <div className="rounded-md border border-ink-100 bg-white px-3 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Available active seats
          </div>
          <div className="mt-1 text-xl font-semibold text-ink-900">
            {Math.max(0, agency.allowedUsers - activeUsers.length)}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-ink-100">
        <div className="grid grid-cols-[minmax(14rem,1.25fr)_minmax(12rem,1fr)_7rem_7rem_minmax(15rem,auto)] gap-3 border-b border-ink-100 bg-ink-50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-500">
          <div>User</div>
          <div>Contact</div>
          <div>Role</div>
          <div>Status</div>
          <div className="text-right">Actions</div>
        </div>
        <div className="divide-y divide-ink-100">
          {sortedUsers.map((staff) => {
            const isSelf = staff.id === currentUserId;
            const isLastActiveManager =
              staff.role === "manager" && staff.active && activeManagers <= 1;
            const disableReason = isSelf
              ? "You cannot disable your own account."
              : isLastActiveManager
              ? "At least one active manager must remain."
              : "";
            return (
              <div
                key={staff.id}
                className={`grid grid-cols-[minmax(14rem,1.25fr)_minmax(12rem,1fr)_7rem_7rem_minmax(15rem,auto)] items-center gap-3 px-4 py-3 text-sm ${
                  staff.active ? "bg-white" : "bg-ink-50/60"
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink-900">{staff.name}</div>
                  <div className="mt-0.5 truncate text-xs text-ink-500">
                    {staff.title || staff.lineOfBusiness
                      ? [staff.title, staff.lineOfBusiness ? `${fmt.titleCase(staff.lineOfBusiness)} lines` : ""]
                          .filter(Boolean)
                          .join(" - ")
                      : "No staff title on file"}
                  </div>
                </div>
                <div className="min-w-0 text-xs text-ink-600">
                  <div className="truncate">{staff.businessEmail ?? staff.email}</div>
                  <div className="mt-0.5 truncate text-ink-500">{staff.phone || "No phone on file"}</div>
                </div>
                <div>
                  <Badge tone={staff.role === "manager" ? "gold" : "neutral"}>
                    {fmt.titleCase(staff.role)}
                  </Badge>
                </div>
                <div>
                  <Badge tone={staffAccessTone(staff)}>{staffAccessLabel(staff)}</Badge>
                  {staff.staffAccessUpdatedAt && (
                    <div className="mt-1 text-[10px] text-ink-400">
                      {fmt.date(staff.staffAccessUpdatedAt)}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {staff.active ? (
                    <>
                      <button
                        type="button"
                        className="btn-outline h-9 px-3 text-xs"
                        disabled={!!disableReason}
                        title={disableReason || "Ban user from signing in"}
                        onClick={() => onChangeAccess(staff, "banned")}
                      >
                        <Ban className="h-3.5 w-3.5" /> Ban
                      </button>
                      <button
                        type="button"
                        className="btn-outline h-9 px-3 text-xs text-rose-600"
                        disabled={!!disableReason}
                        title={disableReason || "Delete user access"}
                        onClick={() => onChangeAccess(staff, "deleted")}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn-outline h-9 px-3 text-xs"
                      onClick={() => onChangeAccess(staff, "active")}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Reactivate
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 rounded-md border border-ink-100 bg-white px-3 py-2 text-xs leading-relaxed text-ink-500">
        Deleted and banned users stay on this list for audit visibility. They cannot sign in, but the agency's
        purchased capacity remains {agency.allowedUsers} user slots until the plan itself is edited.
      </div>
    </Card>
  );
}

function BranchesCard({
  agencyId,
  branches,
  editable = true,
  onChanged,
}: {
  agencyId: string;
  branches: Branch[];
  editable?: boolean;
  onChanged: () => void;
}) {
  const [locked, setLocked] = useState(true);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [phone, setPhone] = useState("");

  function reset() {
    setName("");
    setAddress("");
    setCity("");
    setState("");
    setZip("");
    setPhone("");
  }

  function addBranch() {
    if (!name.trim()) return;
    api.branches.create({
      agencyId,
      name: name.trim(),
      address: address.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      zip: zip.trim() || undefined,
      phone: phone.trim() || undefined,
    });
    reset();
    onChanged();
  }

  return (
    <Card>
      <CardHeader
        title="Branches and locations"
        subtitle={
          !editable
            ? "Read-only. Headquarters lives in Agency profile; branch offices are listed here."
            : locked
            ? "Locked. Headquarters lives in Agency profile; branch offices are listed here."
            : "Add or remove agency office locations. These stay scoped to this agency."
        }
        action={
          !editable ? null : locked ? (
            <button type="button" className="btn-ghost text-xs" onClick={() => setLocked(false)}>
              <Pencil className="h-3.5 w-3.5" /> Edit locations
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  reset();
                  setLocked(true);
                }}
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
              <button
                type="button"
                className="btn-gold text-xs"
                onClick={() => {
                  reset();
                  setLocked(true);
                }}
              >
                <Save className="h-3.5 w-3.5" /> Done
              </button>
            </div>
          )
        }
      />

      {editable && !locked && (
        <div className="mb-4 rounded-md border border-ink-100 bg-ink-50/40 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="branch-name">Branch name</label>
              <input
                id="branch-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Palm Beach Office"
              />
            </div>
            <div>
              <label className="label" htmlFor="branch-phone">Phone</label>
              <input
                id="branch-phone"
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
            <div className="md:col-span-2">
              <label className="label" htmlFor="branch-address">Street address</label>
              <input
                id="branch-address"
                className="input"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St"
              />
            </div>
            <div>
              <label className="label" htmlFor="branch-city">City</label>
              <input id="branch-city" className="input" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="branch-state">State</label>
                <input id="branch-state" className="input" value={state} onChange={(e) => setState(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="branch-zip">ZIP</label>
                <input id="branch-zip" className="input" value={zip} onChange={(e) => setZip(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <button type="button" className="btn-primary text-sm" onClick={addBranch} disabled={!name.trim()}>
              <Plus className="h-3.5 w-3.5" /> Add branch
            </button>
          </div>
        </div>
      )}

      <ul className="divide-y divide-ink-100 rounded-md border border-ink-100">
        <li className="flex items-start justify-between gap-3 bg-ink-50/50 px-3 py-3">
          <div className="min-w-0 flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gold-700" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink-900">Headquarters</div>
              <div className="text-xs text-ink-500">Managed in Agency profile.</div>
            </div>
          </div>
          <Badge tone="gold">Primary</Badge>
        </li>
        {branches.length === 0 ? (
          <li className="px-3 py-4 text-sm text-ink-400">
            No branch offices on file.
          </li>
        ) : (
          branches.map((branch) => (
            <li key={branch.id} className="flex items-start justify-between gap-3 px-3 py-3">
              <div className="min-w-0 flex items-start gap-2">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink-900">{branch.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                    {compactAddress(branch) ? (
                      <MapLink address={compactAddress(branch)} className="text-xs" />
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> No address on file
                      </span>
                    )}
                    {branch.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {branch.phone}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {editable && !locked && (
                <button
                  type="button"
                  className="btn-outline text-xs !px-2 text-rose-600"
                  title="Remove branch"
                  onClick={() => {
                    if (!confirm(`Remove the "${branch.name}" branch?`)) return;
                    api.branches.remove(branch.id);
                    onChanged();
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))
        )}
      </ul>
      <div className="mt-3 grid gap-2 text-xs text-ink-500 sm:grid-cols-3">
        <div className="inline-flex items-center gap-1">
          <Mail className="h-3.5 w-3.5" /> Agency email controls live in Agency profile.
        </div>
        <div className="inline-flex items-center gap-1">
          <Phone className="h-3.5 w-3.5" /> Branch phone numbers are location-specific.
        </div>
        <div className="inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" /> Headquarters remains the primary address.
        </div>
      </div>
    </Card>
  );
}
