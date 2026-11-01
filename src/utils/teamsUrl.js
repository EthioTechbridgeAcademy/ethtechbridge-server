/**
 * Microsoft Teams Meeting URL Validator
 * Enforces strict domain allowlists, HTTPS protocol, and rejects credential leaks or untrusted schemes.
 */

const DEFAULT_APPROVED_DOMAINS = [
  "teams.microsoft.com",
  "teams.live.com",
  "meet.microsoft.com",
  "gov.teams.microsoft.us",
  "dod.teams.microsoft.us"
];

export function getApprovedTeamsDomains() {
  const envDomains = process.env.TEAMS_ALLOWED_DOMAINS
    ? process.env.TEAMS_ALLOWED_DOMAINS.split(",").map((d) => d.trim().toLowerCase())
    : [];
  return Array.from(new Set([...DEFAULT_APPROVED_DOMAINS, ...envDomains]));
}

/**
 * Validates whether a given URL is a legitimate Microsoft Teams meeting link.
 * @param {string} url - Meeting URL string
 * @returns {{ valid: boolean, error?: string, normalizedUrl?: string }}
 */
export function validateTeamsMeetingUrl(url) {
  if (!url || typeof url !== "string") {
    return { valid: false, error: "Meeting URL is required." };
  }

  const trimmed = url.trim();

  // Reject malicious schemes immediately
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) {
    return { valid: false, error: "Invalid URL scheme. Only secure HTTPS Microsoft Teams links are permitted." };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: "Malformed URL syntax." };
  }

  // Enforce HTTPS
  if (parsed.protocol !== "https:") {
    return { valid: false, error: "Meeting URL must strictly use HTTPS protocol." };
  }

  // Reject embedded credentials
  if (parsed.username || parsed.password) {
    return { valid: false, error: "Security restriction: Meeting URLs must not contain embedded user credentials." };
  }

  const hostname = parsed.hostname.toLowerCase();
  const approvedDomains = getApprovedTeamsDomains();

  // Check if hostname matches approved domain or is a valid subdomain of teams.microsoft.com
  const isApproved = approvedDomains.some((domain) => {
    return hostname === domain || hostname.endsWith(`.${domain}`);
  });

  if (!isApproved) {
    return {
      valid: false,
      error: `Domain '${hostname}' is not an authorized Microsoft Teams meeting host. Approved hosts include teams.microsoft.com, teams.live.com, or meet.microsoft.com.`
    };
  }

  // Ensure path is not completely empty root
  if (!parsed.pathname || parsed.pathname === "/") {
    return { valid: false, error: "Incomplete Teams meeting URL. Please provide the full meeting link (e.g., https://teams.microsoft.com/l/meetup-join/...)." };
  }

  return { valid: true, normalizedUrl: parsed.toString() };
}

