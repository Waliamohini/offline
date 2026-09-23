// Decodes the JWT stored in localStorage and returns role + user info
// No external deps — pure base64 decode

export interface AuthUser {
  email: string;
  user_id: string;
  role: "admin" | "auditor" | string;
  displayName: string; // derived from email: "yashi@kpmg.com" → "Yashi"
}

function parseJwt(token: string): AuthUser | null {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const payload = JSON.parse(json);
    const email: string = payload.sub || payload.email || "";
    // Capitalise first part of email as display name
    const raw = email.split("@")[0].replace(/[._-]/g, " ");
    const displayName = raw.replace(/\b\w/g, c => c.toUpperCase());
    return { email, user_id: payload.user_id, role: payload.role, displayName };
  } catch {
    return null;
  }
}

export function useAuth(): AuthUser | null {
  const token = localStorage.getItem("token");
  if (!token) return null;
  return parseJwt(token);
}

export function isAdmin(): boolean {
  const token = localStorage.getItem("token");
  if (!token) return false;
  const user = parseJwt(token);
  return user?.role === "admin";
}
