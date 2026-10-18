/**
 * Shown straight away while the next page loads, so a tap always gets a response. Each top-level folder's
 * loading.tsx uses it, rather than one app/loading.tsx: one at the root would put every page, the not-found ones
 * included, behind a streamed response that has already said 200, so no address could get a real 404. The video
 * page checks its address above its own loading screen (app/v/[id]/layout.tsx).
 */
export default function Loading() {
  return (
    <div className="grid min-h-[60vh] place-items-center" role="status" aria-label="Loading">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-primary" />
    </div>
  );
}
