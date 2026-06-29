/**
 * Unit coverage for the shared pi "auth browser" page renderer.
 *
 * These assert the page Antigravity now serves after OAuth is the same
 * pi-branded success/error page built-in Claude shows — a real HTML document
 * with the pi logo, dark theme, and HTML-escaped, untrusted-safe content.
 */

import { describe, it, expect } from "vitest";
import { authErrorHtml, authSuccessHtml, escapeHtml } from "../auth-page.js";

describe("escapeHtml", () => {
  it("escapes every HTML-significant character", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("escapes ampersands first so entities are not double-mangled", () => {
    expect(escapeHtml("<&>")).toBe("&lt;&amp;&gt;");
  });
});

describe("authSuccessHtml", () => {
  it("renders a full pi-branded success document", () => {
    const html = authSuccessHtml();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Authentication successful</title>");
    expect(html).toContain("<h1>Authentication successful</h1>");
    // The pi logo SVG marks this as the native pi auth-browser page.
    expect(html).toContain("<svg");
    expect(html).toContain('viewBox="0 0 800 800"');
    expect(html).toContain("--page-bg: #09090b;");
  });

  it("uses the default close-tab message and allows an override", () => {
    expect(authSuccessHtml()).toContain("You can close this tab");
    expect(authSuccessHtml("Antigravity sign-in complete")).toContain("Antigravity sign-in complete");
  });

  it("escapes an attacker-controlled message", () => {
    expect(authSuccessHtml("<script>alert(1)</script>")).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("authErrorHtml", () => {
  it("renders a failure document with optional details", () => {
    const html = authErrorHtml("Sign-in failed.", "Error: access_denied");
    expect(html).toContain("<title>Authentication failed</title>");
    expect(html).toContain("<h1>Authentication failed</h1>");
    expect(html).toContain("Sign-in failed.");
    expect(html).toContain('<div class="details">Error: access_denied</div>');
  });

  it("omits the details block when no details are given", () => {
    expect(authErrorHtml("Sign-in failed.")).not.toContain('class="details"');
  });

  it("escapes attacker-controlled message and details", () => {
    const html = authErrorHtml("<b>x</b>", "<i>y</i>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("&lt;i&gt;y&lt;/i&gt;");
  });
});
