import { useMemo, useState } from "react";
import { Building2, ExternalLink, FileText, Mail, Phone, Pin, Plus, Trash2, User, X } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { DocumentUploader } from "@/components/ui/DocumentUploader";
import { DocumentList } from "@/components/ui/DocumentList";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { Carrier, CarrierContact, CarrierContactPosition, Document } from "@/types";

const POSITION_OPTIONS: { value: CarrierContactPosition; label: string }[] = [
  { value: "underwriter", label: "Underwriter" },
  { value: "adjuster", label: "Adjuster" },
  { value: "claims_rep", label: "Claims rep" },
  { value: "marketing_rep", label: "Marketing rep" },
  { value: "account_exec", label: "Account executive" },
  { value: "agency_liaison", label: "Agency liaison" },
  { value: "billing", label: "Billing" },
  { value: "other", label: "Other" },
];

export function CarrierRecommendationsPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [activeCarrier, setActiveCarrier] = useState<Carrier | null>(null);
  if (!agency || !user) return null;
  const isManager = user.role === "manager";

  const visibleIds = new Set(
    api.customers
      .listVisible(agency.id, { id: user.id, role: user.role })
      .map((c) => c.id)
  );
  const linkedCarriers = api.carriers.listForTenant(agency.id);
  const quotes = api.quotes
    .listByTenant(agency.id)
    .filter((q) => visibleIds.has(q.customerId));

  return (
    <div className="space-y-6">
      <EmployeeBackButton />
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Carrier library</h1>
          <p className="text-ink-500 text-sm mt-1">
            Agency carrier markets, contacts, appetite documents, and AI quote recommendations.
            Final binding decisions stay with the agent.
          </p>
        </div>
        {isManager && (
          <button
            type="button"
            className="btn-gold"
            onClick={() => setLinkModalOpen(true)}
          >
            <Plus className="h-4 w-4" /> Add / remove carriers
          </button>
        )}
      </div>

      <Disclaimer>
        AI recommendations are internal-only by default — customers do not see carrier
        suggestions unless your agency explicitly enables them.
      </Disclaimer>

      <Card>
        <CardHeader
          title="Available carriers"
          subtitle="Agency carrier markets, agent sign-ins, and carrier-rep contacts. Contacts surface on the Messages page so the agent can email them in one click."
        />
        {linkedCarriers.length === 0 ? (
          <div className="text-sm text-ink-400">
            No carriers linked yet.
            {isManager && " Tap Add / remove carriers above to wire some up."}
          </div>
        ) : (
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {linkedCarriers.map((c) => {
              const contacts = api.carrierContacts.listForCarrier(agency.id, c.id);
              return (
                <li key={c.id}>
                  <div className="w-full border border-ink-100 rounded-md p-3 transition-colors hover:border-gold-300 hover:bg-ink-50/50">
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-ink-500 mt-0.5 truncate">
                      {c.preferredAssetTypes.map((t) => t.replace(/_/g, " ")).join(", ") ||
                        "No preferred lines"}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-ink-600">
                      <span>
                        {contacts.length} contact{contacts.length === 1 ? "" : "s"}
                      </span>
                      <div className="flex items-center justify-end gap-2">
                        {c.agentPortalUrl && (
                          <a
                            href={c.agentPortalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-900 shadow-sm hover:border-gold-300"
                          >
                            <ExternalLink className="h-3 w-3" /> Agent sign-in
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => setActiveCarrier(c)}
                          className="inline-flex items-center gap-1 rounded-md bg-ink-900 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-black"
                        >
                          Manage
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <CarrierDocumentLibrary
        tenantId={agency.id}
        userId={user.id}
        carriers={linkedCarriers}
        canEdit={isManager}
        onChanged={refresh}
      />

      <Card>
        <CardHeader title="Latest AI carrier matches" />
        <ul className="divide-y divide-ink-100">
          {quotes.map((q) => {
            const customer = api.customers.get(q.customerId);
            const carrier = q.aiRecommendedCarrierId
              ? api.carriers.get(q.aiRecommendedCarrierId)
              : null;
            return (
              <li key={q.id} className="py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">
                      {customer?.name} · {api.helpers.assetTypeLabel(q.assetType)}
                    </div>
                    <div className="text-xs text-ink-500 mt-0.5">
                      {carrier ? `Recommended: ${carrier.name}` : "No recommendation"}
                    </div>
                  </div>
                  {q.aiPremiumEstimateMin && (
                    <div className="text-sm font-medium">
                      ${q.aiPremiumEstimateMin?.toLocaleString()} – $
                      {q.aiPremiumEstimateMax?.toLocaleString()}
                    </div>
                  )}
                </div>
                {q.aiRecommendationReason && (
                  <p className="mt-2 text-sm text-ink-700">{q.aiRecommendationReason}</p>
                )}
              </li>
            );
          })}
          {quotes.length === 0 && (
            <li className="text-sm text-ink-400 py-4">No quotes yet.</li>
          )}
        </ul>
      </Card>

      {isManager && (
        <LinkCarriersModal
          open={linkModalOpen}
          onClose={() => setLinkModalOpen(false)}
          tenantId={agency.id}
          onChanged={refresh}
        />
      )}
      <CarrierContactsModal
        open={!!activeCarrier}
        onClose={() => setActiveCarrier(null)}
        carrier={activeCarrier}
        tenantId={agency.id}
        userId={user.id}
        canEdit={isManager}
        onChanged={refresh}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// Manager-only modal: link / unlink carriers from the master library
// ---------------------------------------------------------------------

function LinkCarriersModal({
  open,
  onClose,
  tenantId,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const allCarriers = open ? api.carriers.list() : [];
  const linkedIds = useMemo(() => {
    if (!open) return new Set<string>();
    return new Set(
      api.carriers
        .links()
        .filter((l) => l.tenantId === tenantId && l.active)
        .map((l) => l.carrierId)
    );
  }, [open, tenantId]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCarriers;
    return allCarriers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.preferredAssetTypes.some((t) => t.includes(q))
    );
  }, [allCarriers, query]);

  function toggle(carrierId: string) {
    if (linkedIds.has(carrierId)) {
      api.carriers.unlinkFromAgency(carrierId, tenantId);
    } else {
      api.carriers.linkToAgency(carrierId, tenantId);
    }
    onChanged();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add / remove carriers" size="lg">
      <div className="space-y-3">
        <p className="text-sm text-ink-600">
          Toggle which carriers from the master library this agency works with. Linked
          carriers appear in the recommendations list and feed into the AI quoting
          ranking.
        </p>
        <input
          className="input text-sm"
          placeholder="Filter by carrier name or asset type…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="rounded-md border border-ink-100 max-h-[400px] overflow-y-auto divide-y divide-ink-100">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-sm text-ink-400">
              No carriers match "{query}".
            </div>
          ) : (
            filtered.map((c) => {
              const linked = linkedIds.has(c.id);
              return (
                <label
                  key={c.id}
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${
                    linked ? "bg-gold-50" : "hover:bg-ink-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={linked}
                    onChange={() => toggle(c.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{c.name}</div>
                    <div className="text-[11px] text-ink-500 truncate">
                      {c.preferredAssetTypes.map((t) => t.replace(/_/g, " ")).join(", ") ||
                        "No preferred lines"}{" "}
                      · {c.stateAvailability.length} states
                    </div>
                  </div>
                  {linked && <Badge tone="success">Linked</Badge>}
                </label>
              );
            })
          )}
        </div>
        <div className="flex items-center justify-end pt-3 border-t border-ink-100">
          <button type="button" className="btn-primary text-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Carrier-detail modal: list of contacts + add-contact form
// ---------------------------------------------------------------------

function CarrierContactsModal({
  open,
  onClose,
  carrier,
  tenantId,
  userId,
  canEdit,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  carrier: Carrier | null;
  tenantId: string;
  userId: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  if (!carrier) {
    return (
      <Modal open={open} onClose={onClose} title="Carrier contacts" size="md">
        <div />
      </Modal>
    );
  }
  const contacts = api.carrierContacts.listForCarrier(tenantId, carrier.id);

  return (
    <Modal open={open} onClose={onClose} title={carrier.name} size="lg">
      <div className="space-y-5">
        {carrier.agentPortalUrl && (
          <a
            href={carrier.agentPortalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline text-sm w-full justify-center"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open {carrier.name} agent sign-in
          </a>
        )}
        <div className="rounded-md border border-violet-100 bg-violet-50 px-3 py-2 text-xs text-violet-900 flex items-start gap-2">
          <Pin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-violet-600" />
          <span>
            Reps you add here surface on the <span className="font-medium">Messages</span>{" "}
            page as their own thread so the agent can email them in one click without
            leaving the platform.
          </span>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold mb-2">
            Contacts ({contacts.length})
          </div>
          {contacts.length === 0 ? (
            <div className="rounded-md border border-dashed border-ink-200 p-4 text-sm text-ink-500 text-center">
              No contacts on file yet.{" "}
              {canEdit
                ? "Add one below."
                : "Ask your manager to add a carrier rep here."}
            </div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {contacts.map((c) => (
                <CarrierContactRow
                  key={c.id}
                  contact={c}
                  canEdit={canEdit}
                  onChanged={onChanged}
                />
              ))}
            </ul>
          )}
        </div>

        {canEdit && (
          <AddContactForm
            carrierId={carrier.id}
            tenantId={tenantId}
            userId={userId}
            onAdded={onChanged}
          />
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-ink-100">
          <button type="button" className="btn-outline text-sm" onClick={onClose}>
            <X className="h-3.5 w-3.5" /> Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CarrierContactRow({
  contact,
  canEdit,
  onChanged,
}: {
  contact: CarrierContact;
  canEdit: boolean;
  onChanged: () => void;
}) {
  return (
    <li className="py-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{contact.name}</div>
        <div className="text-[11px] text-ink-500 mt-0.5 capitalize">
          {positionLabel(contact.position)}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-ink-700">
          <a
            href={`mailto:${contact.email}`}
            className="inline-flex items-center gap-1 hover:text-gold-700"
          >
            <Mail className="h-3 w-3" /> {contact.email}
          </a>
          {contact.phone && (
            <a
              href={`tel:${contact.phone}`}
              className="inline-flex items-center gap-1 hover:text-gold-700"
            >
              <Phone className="h-3 w-3" /> {contact.phone}
            </a>
          )}
        </div>
        {contact.notes && (
          <p className="text-[11px] text-ink-500 mt-1 italic">{contact.notes}</p>
        )}
        <div className="text-[10px] text-ink-400 mt-1">
          Added {fmt.dateTime(contact.createdAt)}
        </div>
      </div>
      {canEdit && (
        <button
          type="button"
          className="btn-outline text-xs !px-2 text-rose-600"
          onClick={() => {
            if (!confirm(`Remove ${contact.name} from this carrier?`)) return;
            api.carrierContacts.remove(contact.id);
            onChanged();
          }}
          title="Remove contact"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

function AddContactForm({
  carrierId,
  tenantId,
  userId,
  onAdded,
}: {
  carrierId: string;
  tenantId: string;
  userId: string;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [position, setPosition] = useState<CarrierContactPosition>("underwriter");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setPosition("underwriter");
    setEmail("");
    setPhone("");
    setNotes("");
    setError(null);
  }

  function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    api.carrierContacts.create({
      tenantId,
      carrierId,
      createdById: userId,
      name: name.trim(),
      position,
      email: email.trim(),
      phone: phone.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    reset();
    setOpen(false);
    onAdded();
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn-gold text-sm"
        onClick={() => setOpen(true)}
      >
        <Mail className="h-4 w-4" /> Add carrier email
      </button>
    );
  }

  return (
    <div className="rounded-md border border-ink-100 bg-ink-50/40 p-4 space-y-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold">
        New contact
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Position</label>
          <select
            className="input"
            value={position}
            onChange={(e) => setPosition(e.target.value as CarrierContactPosition)}
          >
            {POSITION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Jane Smith"
          />
        </div>
        <div>
          <label className="label">Email</label>
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@carrier.example"
          />
        </div>
        <div>
          <label className="label">Phone (optional)</label>
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 123-4567"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Notes (optional)</label>
          <textarea
            className="input min-h-[60px] text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Best times to reach, lines they handle, etc."
          />
        </div>
      </div>
      {error && (
        <div className="rounded-md border border-alert-ring bg-alert-soft px-3 py-2 text-xs text-alert">
          {error}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="btn-outline text-sm"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Cancel
        </button>
        <button type="button" className="btn-primary text-sm" onClick={submit}>
          <Plus className="h-3.5 w-3.5" /> Add contact
        </button>
      </div>
    </div>
  );
}

export function positionLabel(p: CarrierContactPosition): string {
  return POSITION_OPTIONS.find((o) => o.value === p)?.label ?? p.replace(/_/g, " ");
}

// ---------------------------------------------------------------------
// Carrier-specific documents library
//
// Managers upload underwriting manuals, appetite guides, application
// forms, and supplementals per carrier — split into Personal vs.
// Commercial sections so a rep working a commercial submission isn't
// scrolling through HO-3 forms (and vice versa). Every uploaded
// document also surfaces on the agency's Document review page so
// nothing slips through the standard approval workflow.
// ---------------------------------------------------------------------

function CarrierDocumentLibrary({
  tenantId,
  userId,
  carriers,
  canEdit,
  onChanged,
}: {
  tenantId: string;
  userId: string;
  carriers: Carrier[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const allDocs = api.documents
    .listByTenant(tenantId)
    .filter((d) => !!d.carrierId);
  const personal = allDocs.filter((d) => d.lineOfBusiness === "personal");
  const commercial = allDocs.filter((d) => d.lineOfBusiness === "commercial");

  return (
    <Card>
      <CardHeader
        title="Carrier-specific documents"
        subtitle="Underwriting manuals, appetite guides, application forms, and supplementals — kept per carrier and split by line. Anything uploaded here also lands on the Document review queue so the standard approval flow still runs."
      />
      <div className="grid lg:grid-cols-2 gap-4">
        <CarrierDocSection
          icon={<User className="h-4 w-4" />}
          title="Personal lines"
          tint="border-indigo-200 bg-indigo-50/30"
          tenantId={tenantId}
          userId={userId}
          carriers={carriers}
          docs={personal}
          line="personal"
          canEdit={canEdit}
          onChanged={onChanged}
        />
        <CarrierDocSection
          icon={<Building2 className="h-4 w-4" />}
          title="Commercial lines"
          tint="border-emerald-200 bg-emerald-50/30"
          tenantId={tenantId}
          userId={userId}
          carriers={carriers}
          docs={commercial}
          line="commercial"
          canEdit={canEdit}
          onChanged={onChanged}
        />
      </div>
    </Card>
  );
}

function CarrierDocSection({
  icon,
  title,
  tint,
  tenantId,
  userId,
  carriers,
  docs,
  line,
  canEdit,
  onChanged,
}: {
  icon: React.ReactNode;
  title: string;
  tint: string;
  tenantId: string;
  userId: string;
  carriers: Carrier[];
  docs: Document[];
  line: "personal" | "commercial";
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [carrierId, setCarrierId] = useState<string>(carriers[0]?.id ?? "");
  // Group docs by carrier so the rep can scan the list for the
  // carrier they're submitting to. Carriers with zero docs are
  // skipped from the list (the uploader above still lets the
  // manager add the first one).
  const byCarrier = useMemo(() => {
    const map = new Map<string, Document[]>();
    for (const d of docs) {
      if (!d.carrierId) continue;
      const arr = map.get(d.carrierId) ?? [];
      arr.push(d);
      map.set(d.carrierId, arr);
    }
    return map;
  }, [docs]);

  return (
    <div className={`rounded-md border p-4 ${tint}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold inline-flex items-center gap-1.5">
          {icon}
          {title}
        </div>
        <span className="text-[11px] text-ink-500">
          {docs.length} document{docs.length === 1 ? "" : "s"}
        </span>
      </div>
      {canEdit && (
        <div className="mb-3 space-y-2">
          <label className="label !mb-0">Carrier</label>
          <select
            className="input text-sm"
            value={carrierId}
            onChange={(e) => setCarrierId(e.target.value)}
          >
            {carriers.length === 0 && <option value="">No carriers linked</option>}
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {carrierId && (
            <DocumentUploader
              key={`${carrierId}-${line}`}
              tenantId={tenantId}
              uploadedById={userId}
              carrierId={carrierId}
              lineOfBusiness={line}
              initialType="carrier_supplemental"
              hideVisibility
              onUploaded={onChanged}
            />
          )}
        </div>
      )}
      {byCarrier.size === 0 ? (
        <div className="text-xs text-ink-400 py-2">
          <FileText className="h-3.5 w-3.5 inline mr-1 align-text-bottom" />
          No {line} documents on file yet.
          {canEdit && " Upload one above and pick the carrier it belongs to."}
        </div>
      ) : (
        <ul className="space-y-3">
          {Array.from(byCarrier.entries()).map(([cid, list]) => {
            const c = carriers.find((x) => x.id === cid);
            return (
              <li key={cid}>
                <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-1">
                  {c?.name ?? "Unknown carrier"} ·{" "}
                  {list.length} doc{list.length === 1 ? "" : "s"}
                </div>
                <DocumentList documents={list} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
