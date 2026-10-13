import { prisma } from '@/server/infrastructure/db/client';
import type { Actor } from '@/server/domain/rbac/authorize';

/**
 * The small amount of profile detail the header shows.
 *
 * Kept out of `Actor` deliberately: the actor is the authorisation subject and
 * is resolved on every request, so it carries only what an access decision
 * needs. Display detail is fetched where it is displayed.
 */
export interface HeaderProfile {
  email: string;
  organisation: string;
}

export async function loadHeaderProfile(actor: Actor): Promise<HeaderProfile> {
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: {
      email: true,
      organization: { select: { name: true } },
      department: { select: { name: true } },
    },
  });

  return {
    email: user?.email ?? '',
    organisation:
      user?.department?.name ?? user?.organization?.name ?? 'NIB International Bank S.C.',
  };
}
