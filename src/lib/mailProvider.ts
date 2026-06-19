import type { MailProvider } from "@/types";

export const MAIL_PROVIDER_OPTIONS: { value: MailProvider; label: string }[] = [
  { value: "gmail", label: "Gmail / Google Workspace" },
  { value: "outlook", label: "Outlook / Microsoft 365" },
  { value: "apple", label: "iCloud Mail" },
  { value: "yahoo", label: "Yahoo Mail" },
  { value: "other", label: "Other email app" },
];

export function inferMailProvider(email: string): MailProvider {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!domain) return "other";
  if (domain === "gmail.com" || domain === "googlemail.com") return "gmail";
  if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain)) {
    return "outlook";
  }
  if (domain === "icloud.com" || domain === "me.com" || domain === "mac.com") {
    return "apple";
  }
  if (domain === "yahoo.com" || domain === "ymail.com") return "yahoo";
  return "other";
}

export function mailProviderLabel(provider: MailProvider): string {
  return MAIL_PROVIDER_OPTIONS.find((option) => option.value === provider)?.label ?? "Email";
}

export function mailProviderShortLabel(provider: MailProvider): string {
  switch (provider) {
    case "gmail":
      return "Gmail";
    case "outlook":
      return "Outlook";
    case "apple":
      return "iCloud Mail";
    case "yahoo":
      return "Yahoo Mail";
    default:
      return "email app";
  }
}

export function mailboxUrl(email: string, provider: MailProvider): string {
  const encodedEmail = encodeURIComponent(email.trim());
  switch (provider) {
    case "gmail":
      return `https://mail.google.com/mail/u/?authuser=${encodedEmail}#inbox`;
    case "outlook":
      return "https://outlook.office.com/mail/";
    case "apple":
      return "https://www.icloud.com/mail/";
    case "yahoo":
      return "https://mail.yahoo.com/";
    default:
      return `mailto:${encodedEmail}`;
  }
}

function quotedSearch(value: string): string {
  const clean = value.trim().replace(/\s+/g, " ").replace(/"/g, "");
  return clean ? `"${clean}"` : "";
}

function mailboxSearchQuery(input: {
  contactEmail?: string;
  subject?: string;
  threadId?: string;
  externalThreadId?: string;
}): string {
  const parts: string[] = [];
  const contact = input.contactEmail?.trim();
  if (contact) parts.push(`from:${contact} OR to:${contact}`);
  const subject = quotedSearch(input.subject ?? "");
  if (subject) parts.push(`subject:${subject}`);
  const thread = input.externalThreadId ?? input.threadId;
  if (!subject && thread) parts.push(quotedSearch(thread));
  return parts.join(" ");
}

export function mailboxThreadUrl(input: {
  mailbox: string;
  provider: MailProvider;
  contactEmail?: string;
  subject?: string;
  threadId?: string;
  externalThreadId?: string;
  externalUrl?: string;
}): string {
  if (input.externalUrl) return input.externalUrl;
  const mailbox = input.mailbox.trim();
  const encodedMailbox = encodeURIComponent(mailbox);
  const query = mailboxSearchQuery(input);
  const encodedQuery = encodeURIComponent(query);
  if (!query) return mailboxUrl(mailbox, input.provider);

  switch (input.provider) {
    case "gmail":
      return `https://mail.google.com/mail/u/?authuser=${encodedMailbox}#search/${encodedQuery}`;
    case "outlook":
      return `https://outlook.office.com/mail/search?q=${encodedQuery}`;
    case "yahoo":
      return `https://mail.yahoo.com/d/search/keyword=${encodedQuery}`;
    case "apple":
      return "https://www.icloud.com/mail/";
    default:
      return input.contactEmail
        ? `mailto:${encodeURIComponent(input.contactEmail)}`
        : mailboxUrl(mailbox, input.provider);
  }
}

export function isValidBusinessEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
