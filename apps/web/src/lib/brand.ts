/** Single place to rename the product once the real brand is chosen. */
export const BRAND = {
  name: "SureFrame",
  tagline: "One take is all it takes.",
};

/** Who a business's emails come from: "Business A via SureFrame" (just SureFrame without a name of its own). */
export const senderName = (business: string | null | undefined) => {
  const name = business?.trim();
  return name && name !== BRAND.name ? `${name} via ${BRAND.name}` : BRAND.name;
};

/**
 * A business name with the product's own name in it, at the start of a word ("SureFrame", "SureFrame Support", "Sure-Frame Team"), ignoring
 * capitals, spacing, punctuation and accents. Its emails to clients would read as coming from SureFrame itself, so it's
 * refused wherever a business name is set or changed (the welcome step, Settings > Branding). A name saved before this
 * rule is left as it is, and emails with no business name (ours) still come from plain "SureFrame" above.
 */
// "Sure" has to start a word, so ordinary names that only happen to run the letters together ("Treasure Frames") pass.
export const isReservedBusinessName = (name: string) =>
  /(^|[^a-z0-9])sure[^a-z0-9]*frame/.test(name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
export const RESERVED_BUSINESS_NAME = `Enter your own business's name. It can't include "${BRAND.name}".`;
