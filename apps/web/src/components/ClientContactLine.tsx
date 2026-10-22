import { telHref, type ClientContact } from "@/lib/clientContact";

/**
 * The business's contact line on its clients' pages (Decision 5, lib/clientContact.ts): "Contact Business A:
 * hello@business.com · 0400 000 000", each a link. Nothing at all when the business left it blank. Wraps at 320px.
 */
export default function ClientContactLine({ business, contact, className = "" }: { business: string; contact: ClientContact | null; className?: string }) {
  if (!contact) return null;
  return (
    <p className={`text-sm text-muted [overflow-wrap:anywhere] ${className}`} data-testid="client-contact">
      <span>Contact {business}:</span>{" "}
      {contact.email && (
        <a href={`mailto:${contact.email}`} className="font-medium text-accent hover:underline" data-testid="client-contact-email">
          {contact.email}
        </a>
      )}
      {contact.email && contact.phone && <span aria-hidden> · </span>}
      {contact.phone && (
        <a href={telHref(contact.phone)} className="whitespace-nowrap font-medium text-accent hover:underline" data-testid="client-contact-phone">
          {contact.phone}
        </a>
      )}
    </p>
  );
}
