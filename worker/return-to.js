const RETURN_TO_BASE = "https://jipjangbu.invalid";

/**
 * Keep post-login redirects on this Site, even when the input is encoded or
 * interpreted with URL-standard backslash handling.
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function safeReturnTo(value) {
  if (typeof value !== "string") return "/";

  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || hasControlCharacters(candidate)) {
    return "/";
  }

  let decoded = candidate;
  for (let pass = 0; pass < 5; pass += 1) {
    if (hasUnsafeSeparator(decoded)) return "/";
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
      if (pass === 4) return "/";
    } catch {
      return "/";
    }
  }
  if (hasUnsafeSeparator(decoded)) return "/";

  try {
    const parsed = new URL(candidate, RETURN_TO_BASE);
    const decodedParsed = new URL(decoded, RETURN_TO_BASE);
    if (parsed.origin !== RETURN_TO_BASE || decodedParsed.origin !== RETURN_TO_BASE) return "/";
    if (isDisallowedPath(parsed.pathname) || isDisallowedPath(decodedParsed.pathname)) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

function isDisallowedPath(pathname) {
  return pathname === "/login"
    || pathname.startsWith("/login/")
    || pathname === "/api/auth"
    || pathname.startsWith("/api/auth/");
}

function hasUnsafeSeparator(value) {
  return value.includes("\\") || value.startsWith("//") || hasControlCharacters(value);
}

function hasControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
