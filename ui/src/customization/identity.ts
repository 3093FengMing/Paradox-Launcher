const shortIdentity = /^[a-z0-9][a-z0-9.-]{0,47}$/;
const targetIdentity = /^[a-z][a-zA-Z0-9.-]*$/;

// Deterministic 64-bit identifier made from two independent 32-bit hashes.
// This is a DOM identity, not a cryptographic digest or an authorization token.
function hashIdentity(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    first = Math.imul(first ^ unit, 0x01000193);
    second = Math.imul(second ^ unit, 0x5bd1e995);
    second ^= second >>> 13;
  }
  return `id-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

/** Keep short safe keys readable; bound every other business identity. */
export function identityToken(value: string): string {
  return shortIdentity.test(value) ? value : hashIdentity(value);
}

/** Append a business identity while keeping the complete target within 96 chars. */
export function safeTargetIdentity(target: string, value: string): string {
  if (!targetIdentity.test(target)) throw new Error('Invalid UI customization target.');
  const candidate = `${target}.${identityToken(value)}`;
  if (candidate.length <= 96) return candidate;
  // Include the entire original target in the hash when its visible prefix has
  // to be shortened, otherwise equal prefixes could address different rows.
  return `${target.slice(0, 76)}.${hashIdentity(`${target}\0${value}`)}`;
}
