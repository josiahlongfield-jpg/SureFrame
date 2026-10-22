/** Whether a person's name is just the business's name (a sole trader working under their own name). */
export const sameName = (name: string, business: string) => name.trim().toLowerCase() === business.trim().toLowerCase();

/**
 * Who sent something, as a client reads it: "Sam from Business", "Sam at Business" or "Sam, Business"; just the
 * name once when it is the business's own, never "Jane Smith from Jane Smith" (D3). Safe in the browser and emails.
 */
export function nameWithBusiness(name: string, business: string, joiner: "from" | "at" | ",") {
  if (sameName(name, business)) return business;
  return joiner === "," ? `${name.trim()}, ${business}` : `${name.trim()} ${joiner} ${business}`;
}
