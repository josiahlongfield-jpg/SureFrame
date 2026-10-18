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
