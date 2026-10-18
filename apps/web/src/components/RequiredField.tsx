"use client";

import { useState, type InputHTMLAttributes } from "react";

/**
 * A required text box that says what's missing on the page, in the site's own words and style, instead of the
 * browser's "Please fill out this field." bubble (V48). The browser still checks it, so it stays :invalid until filled.
 */
export default function RequiredField({ message, ...input }: InputHTMLAttributes<HTMLInputElement> & { message: string }) {
  const [missing, setMissing] = useState(false);
  const id = `${input.name}-missing`;
  return (
    <>
      <input
        {...input}
        required
        aria-invalid={missing || undefined}
        aria-describedby={missing ? id : undefined}
        onInvalid={(e) => {
          e.preventDefault();
          setMissing(true);
          e.currentTarget.focus();
        }}
        onInput={() => setMissing(false)}
      />
      {missing && (
        <span id={id} role="alert" className="text-sm text-danger-fg">
          {message}
        </span>
      )}
    </>
  );
}
