/** The site's own address (sureframe.app in production), for links and images in emails. */
export function appUrl(path = "") {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return (process.env.APP_URL ?? (vercel ? `https://${vercel}` : "http://localhost:3000")) + path;
}
