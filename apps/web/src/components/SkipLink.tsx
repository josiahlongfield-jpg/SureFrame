"use client";

/**
 * "Skip to content", the first thing a keyboard user tabs to on every page (V60, O112, P62): it moves focus past the
 * header to the page's main content. Off screen until focused (.skip-link in globals.css). Pages don't need an id on
 * their <main>: the first one on the page is used.
 */
export default function SkipLink() {
  return (
    <a
      href="#main"
      className="skip-link"
      data-testid="skip-link"
      onClick={(e) => {
        const main = document.getElementById("main") ?? document.querySelector("main");
        if (!main) return;
        e.preventDefault();
        if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
        main.focus();
      }}
    >
      Skip to content
    </a>
  );
}
