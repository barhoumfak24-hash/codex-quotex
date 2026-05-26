import { useEffect, useRef, useState } from "react";
import { FileSignature, Loader2, ScrollText } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { fmt } from "@/lib/format";
import type { Document } from "@/types";

// =====================================================================
// E-signature modal. The customer reads the document body (scroll-
// to-bottom gate), types their full legal name, sees it render in a
// cursive script preview, and clicks Sign. The parent caller wires
// the actual db write (api.esign.markCustomerSigned) via onSign.
//
// In production the body is a PDF rendered by an e-sign provider
// (DocuSign / Dropbox Sign / native). The demo synthesizes a
// believable preview from the doc's filename + customer name so
// the experience reads end-to-end.
// =====================================================================

export function EsignModal({
  open,
  onClose,
  document,
  customerName,
  onSign,
}: {
  open: boolean;
  onClose: () => void;
  document: Document | null;
  customerName: string;
  onSign: () => void;
}) {
  const [typedName, setTypedName] = useState("");
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Reset state when the modal flips open / closed or the document
  // changes — otherwise typing your name once would unlock it for
  // every subsequent signature.
  useEffect(() => {
    if (!open) return;
    setTypedName("");
    setScrolledToBottom(false);
    setAgreed(false);
    setBusy(false);
  }, [open, document?.id]);

  if (!document) {
    return (
      <Modal open={open} onClose={onClose} title="E-sign document" size="lg">
        <div className="text-sm text-ink-500">Document not found.</div>
      </Modal>
    );
  }

  const body = synthesizeBody(document, customerName);
  const nameMatches =
    typedName.trim().toLowerCase() === customerName.trim().toLowerCase() &&
    typedName.trim().length > 0;
  const canSign = scrolledToBottom && agreed && nameMatches && !busy;

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 12;
    if (atBottom && !scrolledToBottom) setScrolledToBottom(true);
  }

  async function submit() {
    if (!canSign) return;
    setBusy(true);
    try {
      onSign();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="E-sign document" size="lg">
      <div className="space-y-4">
        <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900 flex items-start gap-2">
          <ScrollText className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-600" />
          <span>
            Read the document below. Scroll all the way to the end, type your full legal
            name to apply your signature, and tap{" "}
            <span className="font-medium">Sign &amp; submit</span>. By signing you agree to
            be electronically bound under the federal ESIGN Act (15 U.S.C. §§ 7001 et seq.)
            and any applicable state UETA.
          </span>
        </div>

        <div className="rounded-md border border-ink-200 bg-white">
          <div className="px-4 py-2 border-b border-ink-100 flex items-center justify-between text-xs text-ink-500">
            <span className="font-medium truncate">{document.fileName}</span>
            <span>{scrolledToBottom ? "End reached" : "Scroll to continue"}</span>
          </div>
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="max-h-[360px] overflow-y-auto p-5 text-sm text-ink-800 leading-relaxed whitespace-pre-wrap font-mono"
          >
            {body}
          </div>
        </div>

        <div className="rounded-md border border-ink-100 bg-ink-50/40 p-3 space-y-3">
          <label className="block text-xs text-ink-700">
            <input
              type="checkbox"
              className="mr-2 align-middle"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              disabled={!scrolledToBottom}
            />
            I have read the document above and consent to e-signing in lieu of a wet
            signature.
          </label>

          <div>
            <label className="label">Type your full legal name</label>
            <input
              className="input"
              placeholder={customerName}
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              disabled={!scrolledToBottom}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-[11px] text-ink-500 mt-1">
              For verification, your typed name must match{" "}
              <span className="font-medium">{customerName}</span> exactly.
            </p>
          </div>

          <div>
            <label className="label">Your signature preview</label>
            <div className="rounded-md border-2 border-dashed border-ink-200 bg-white px-4 py-6 min-h-[80px] flex items-center">
              {typedName.trim() ? (
                <span
                  className="text-3xl text-ink-900 italic"
                  style={{
                    fontFamily:
                      "'Snell Roundhand', 'Brush Script MT', 'Lucida Handwriting', 'Apple Chancery', cursive",
                  }}
                >
                  {typedName.trim()}
                </span>
              ) : (
                <span className="text-sm text-ink-400">
                  Your cursive signature will appear here as you type.
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-ink-100 flex-wrap">
          <div className="text-[11px] text-ink-500">
            {!scrolledToBottom
              ? "Scroll to the end of the document to enable signing."
              : !agreed
              ? "Check the consent box to continue."
              : !nameMatches
              ? "Type your full legal name exactly as shown."
              : "Ready to sign."}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-outline text-sm"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={submit}
              disabled={!canSign}
              title={
                canSign
                  ? "Apply your e-signature"
                  : "Finish the steps above to enable signing"
              }
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileSignature className="h-3.5 w-3.5" />
              )}
              {busy ? "Signing…" : "Sign & submit"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// Synthesizes a believable document body so the demo has something
// to scroll through. Length scales so the scroll-to-bottom gate
// requires actual scrolling on the modal. Production renders the
// real PDF / DOCX returned by the e-sign provider.
function synthesizeBody(document: Document, customerName: string): string {
  const today = fmt.dateTime(new Date().toISOString());
  const isRenewal = /renewal-packet|renewal/i.test(document.fileName);
  const isApp = /application|app\b/i.test(document.fileName);
  const intro = [
    `Document: ${document.fileName}`,
    `Prepared for: ${customerName}`,
    `Generated: ${today}`,
    ``,
  ].join("\n");

  const sections: string[] = [];
  if (isRenewal) {
    sections.push(
      "RENEWAL PACKET — REVIEW & ACKNOWLEDGEMENT\n\nThis renewal packet summarizes the coverages, limits, and premiums that will be in effect for the next policy term. The undersigned acknowledges receipt of the declarations page(s), endorsement schedule, and any supplemental notices included with this packet."
    );
    sections.push(
      "1. POLICY TERM & EFFECTIVE DATES\n\nThe new policy term begins on the renewal date stated on the declarations page and continues for the period shown thereon. Coverage will lapse if premium is not received by the carrier on or before the inception date listed."
    );
    sections.push(
      "2. COVERAGE SUMMARY\n\n  • Dwelling / Coverage A — see declarations page for limit.\n  • Other Structures — extended at 10% of Coverage A.\n  • Personal Property — scheduled at 50% of Coverage A.\n  • Loss of Use / Additional Living Expense — 20% of Coverage A.\n  • Personal Liability — $1,000,000 per occurrence.\n  • Medical Payments to Others — $5,000 per person."
    );
    sections.push(
      "3. ENDORSEMENTS & EXCLUSIONS\n\nEndorsements amend the base policy form for items including but not limited to wind / hurricane deductibles, ordinance or law coverage, replacement-cost coverage on contents, and water-backup coverage. Exclusions apply to certain perils including but not limited to flood (covered separately by the National Flood Insurance Program), earth movement, intentional acts, and wear-and-tear maintenance items. Please review the policy form for a full list."
    );
    sections.push(
      "4. PREMIUM PAYMENT\n\nThe annual premium will be billed per the payment schedule on the declarations page. Failure to make a timely payment may result in cancellation for non-payment. Reinstatement is at the carrier's discretion and may be subject to additional underwriting review."
    );
    sections.push(
      "5. CLAIMS REPORTING\n\nAll claims should be reported immediately to the carrier's 24/7 claims line listed on your declarations page. Failure to report a claim in a timely manner may prejudice the carrier's ability to investigate the loss and could affect coverage."
    );
    sections.push(
      "6. CONSUMER NOTICES\n\nThis document contains required state-mandated consumer notices, including but not limited to fraud warnings, replacement-cost notices, and right-to-cancel notices applicable to your jurisdiction. The undersigned acknowledges receipt of all such notices."
    );
    sections.push(
      "7. ACKNOWLEDGEMENT\n\nBy signing below, the undersigned acknowledges (a) receipt of this renewal packet, (b) opportunity to review all materials, (c) agreement to the coverages, limits, and premium described herein, and (d) understanding that questions may be directed to the agent of record at the contact information on file."
    );
  } else if (isApp) {
    sections.push(
      "INSURANCE APPLICATION — STATEMENTS & SIGNATURE\n\nThe undersigned applicant represents that the information provided in this application is true and complete to the best of their knowledge. The applicant understands that the carrier will rely on these representations in deciding whether to issue a policy and in setting premium."
    );
    sections.push(
      "1. APPLICANT REPRESENTATIONS\n\nThe applicant warrants that all material facts have been disclosed, including but not limited to prior insurance history, claims activity in the prior five (5) years, prior cancellations or non-renewals, and any criminal convictions related to insurance fraud."
    );
    sections.push(
      "2. CONSENT TO BACKGROUND CHECKS\n\nThe applicant authorizes the carrier and its underwriting partners to obtain consumer reports, motor vehicle records, claims histories (LexisNexis CLUE / A-PLUS), and other underwriting information as permitted by federal and state law."
    );
    sections.push(
      "3. PREMIUM AUTHORIZATION\n\nThe applicant agrees to pay the premium as quoted, subject to underwriting review. If the carrier amends the premium materially, the applicant will have a reasonable period to accept or decline the revised terms."
    );
    sections.push(
      "4. FRAUD WARNING\n\nAny person who knowingly and with intent to defraud any insurance company or other person files an application for insurance containing any materially false information, or conceals for the purpose of misleading, information concerning any fact material thereto, commits a fraudulent insurance act, which is a crime."
    );
    sections.push(
      "5. SIGNATURE\n\nThe undersigned applicant adopts the electronic signature applied below as their full, legal signature, with the same force and effect as a wet ink signature, in accordance with the federal Electronic Signatures in Global and National Commerce Act."
    );
  } else {
    sections.push(
      "DOCUMENT REVIEW & ACKNOWLEDGEMENT\n\nThe undersigned acknowledges receipt of the attached document and agrees to its terms. This acknowledgement is provided in lieu of a wet signature pursuant to the federal ESIGN Act and any applicable state UETA."
    );
    sections.push(
      "1. SCOPE\n\nThis document covers the subject matter described in its filename and accompanying materials, and is incorporated by reference into the customer's insurance file maintained by the agency of record."
    );
    sections.push(
      "2. ACCURACY\n\nThe undersigned represents that the information contained herein has been reviewed for accuracy and reflects the parties' understanding as of the date of signature."
    );
    sections.push(
      "3. EFFECT OF SIGNATURE\n\nThe electronic signature applied below is intended to have the same force and effect as a wet ink signature, and to constitute the signer's adoption of the document for all purposes."
    );
    sections.push(
      "4. RETENTION\n\nA fully executed copy will be retained in the agency's document management system, with a hash-based audit log capturing the time of signature, IP address (where supported), and the typed-name input used to generate the cursive signature."
    );
  }

  // Pad with a closing block so the bottom of the document includes
  // the signature blocks the customer is about to fill in.
  const closing = [
    `\nIN WITNESS WHEREOF, the undersigned has caused this document to be executed as of the date written below.\n`,
    `Signed by: ${customerName}`,
    `Date: ${today}`,
    `Signature: ____________________________`,
  ].join("\n");

  return [intro, ...sections, closing].join("\n\n");
}