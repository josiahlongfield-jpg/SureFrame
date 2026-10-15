/** Shown straight away while the next page loads, so a tap always gets a response. */
export default function Loading() {
  return (
    <div className="grid min-h-[60vh] place-items-center" role="status" aria-label="Loading">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand-600" />
    </div>
  );
}
