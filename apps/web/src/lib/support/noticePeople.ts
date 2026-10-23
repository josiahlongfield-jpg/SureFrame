/** Who a new sub-processor notice goes to, for the support console: "1 business owner or admin" / "12 business owners and admins". */
export const noticePeople = (n: number) => (n === 1 ? "1 business owner or admin" : `${n} business owners and admins`);
