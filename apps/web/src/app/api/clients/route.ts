import { z } from "zod";
import { db } from "@/lib/db";
import { clientLink, newClientToken, seatUsage } from "@/lib/clients";
import { handle, HttpError, requireUser } from "@/lib/session";
import { limitByIp } from "@/lib/rateLimit";
import { KeyFingerprint, requireCurrentKey } from "@/lib/keys";
import { accessOf, clientScopeWhere, requirePerm } from "@/lib/permissions";

const One = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  /** The client's new key, wrapped with the team key on the trainer's device. */
  teamKeyWrap: z.string().min(40).max(200),
});
const Body = One.extend({ keyFingerprint: KeyFingerprint });
/** Several at once, pasted as a list on the Clients page. */
const Many = z.object({ clients: z.array(One).min(1).max(200), keyFingerprint: KeyFingerprint });

export const GET = handle(async () => {
  const me = await requireUser();
  const { workspace } = me;
  const clients = await db.client.findMany({
    where: { ...clientScopeWhere(accessOf(me)), removedAt: null },
    orderBy: { name: "asc" },
    include: { _count: { select: { videos: true } } },
  });
  return Response.json({
    seats: await seatUsage(workspace),
    clients: clients.map((c) => ({ id: c.id, name: c.name, email: c.email, link: clientLink(c.token), teamKeyWrap: c.teamKeyWrap, videoCount: c._count.videos, assignedToId: c.assignedToId, paused: !!c.pausedAt, linkOff: !!c.linkDisabledAt })),
  });
});

/** Add a client, or several at once. Each active client uses one seat; clients never pay. */
export const POST = handle(async (req: Request) => {
  const me = await requireUser();
  const { user, workspace, role } = me;
  requirePerm(accessOf(me), "addClients", "Ask the owner or an admin to add new clients");
  const json = await req.json().catch(() => null);
  const many = Many.safeParse(json);
  const one = many.success ? null : Body.safeParse(json);
  await limitByIp("clients", 30, 3600);
  if (!many.success && !one?.success) throw new HttpError(400, "Enter a name and, optionally, a valid email");
  const keyFingerprint = many.success ? many.data.keyFingerprint : one!.data!.keyFingerprint;
  await requireCurrentKey(workspace, keyFingerprint);
  const wanted = many.success ? many.data.clients : [one!.data!];
  const created = await db.$transaction(async (tx) => {
    // One add at a time per team, so two quick adds can't both take the last seat.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"clients:" + workspace.id}))`;
    const seats = await seatUsage(workspace, tx);
    const left = seats.limit - seats.used;
    if (left <= 0) throw new HttpError(402, `All ${seats.limit} client seats are in use. Add more seats or remove a client first.`);
    if (wanted.length > left) throw new HttpError(402, `That's ${wanted.length} clients, but only ${left} client ${left === 1 ? "seat is" : "seats are"} left. Add more seats, or add fewer clients.`);
    const out = [];
    for (const c of wanted) {
      out.push(await tx.client.create({ data: { name: c.name, email: c.email, teamKeyWrap: c.teamKeyWrap, token: newClientToken(), workspaceId: workspace.id, assignedToId: role === "MEMBER" ? user.id : null } }));
    }
    return out;
  });
  const dto = (c: (typeof created)[number]) => ({ id: c.id, name: c.name, email: c.email, link: clientLink(c.token), teamKeyWrap: c.teamKeyWrap, videoCount: 0, assignedToId: c.assignedToId });
  return Response.json(many.success ? { clients: created.map(dto) } : { client: dto(created[0]) }, { status: 201 });
});
