import { mailbox } from "@/lib/emailAddress";
import { clientIp, isLimited, rateLimit } from "@/lib/rateLimit";

const HOUR = 3600;

/** Which allowance ran out: everyone on this network (an office, a phone carrier) together, or this address. */
export type SignInLimit = "network" | "address";

/**
 * A network can be a whole office or a phone carrier's shared address, so
 * its allowance is generous; one address's is small, so nobody's inbox can
 * be flooded.
 */
async function limits(email: string): Promise<[string, number, SignInLimit][]> {
  return [
    [`signin-email:ip:${await clientIp()}`, 30, "network"],
    [`signin-email:to:${email}`, 5, "address"],
    // Tagged and dotted versions of one inbox share an allowance.
    [`signin-email:box:${mailbox(email)}`, 8, "address"],
  ];
}

/** Counts one sign-in email; throws when this address, inbox or network has had too many this hour. */
export async function countSignInEmail(email: string) {
  for (const [key, limit] of await limits(email)) await rateLimit(key, limit, HOUR);
}

/** Which limit sending one more sign-in email would hit, if any, without counting it. */
export async function signInEmailLimited(email: string): Promise<SignInLimit | null> {
  for (const [key, limit, kind] of await limits(email)) if (await isLimited(key, limit, HOUR)) return kind;
  return null;
}
