import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/stripe";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/pricing", "/help", "/faq", "/about", "/legal", "/legal/terms", "/legal/privacy", "/legal/dpa", "/legal/archive"].map((p) => ({ url: appUrl(p), changeFrequency: "monthly" }));
}
