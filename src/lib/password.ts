import "server-only";

import { randomInt } from "node:crypto";

/*
 * One-time passwords for new users and resets. 14 characters (SPEC 11 minimum is 10) from an
 * alphabet without look-alike characters, so they can be read out or written down. Shown once to
 * the admin, never stored or logged.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export function generatePassword(length = 14): string {
  let password = "";
  for (let i = 0; i < length; i += 1) password += ALPHABET[randomInt(ALPHABET.length)];
  return password;
}
