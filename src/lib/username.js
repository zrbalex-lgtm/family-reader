export function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

export function usernameToEmail(username) {
  const normalized = normalizeUsername(username);
  // A restricted local part gives every family account one unambiguous login.
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(normalized)) {
    throw new Error('Use 1–32 letters, numbers, hyphens or underscores. Start with a letter or number.');
  }
  return `${normalized}@reader.local`;
}

export function usernameFromUser(user) {
  return user?.email?.split('@')[0] || 'Reader';
}
