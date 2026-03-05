import type { AppRole } from "../domain/auth.js";
import { normalizeRoles } from "../domain/auth.js";

export interface RoleAssignmentsRepository {
  listRolesForSubject(subjectId: string): Promise<AppRole[]>;
}

export class NoopRoleAssignmentsRepository implements RoleAssignmentsRepository {
  async listRolesForSubject(_subjectId: string): Promise<AppRole[]> {
    return [];
  }
}

export async function resolveEffectiveRoles(args: {
  subjectId: string;
  claimRoles: AppRole[];
  repository: RoleAssignmentsRepository;
  defaultRoles: AppRole[];
}): Promise<AppRole[]> {
  const assignedRoles = await args.repository.listRolesForSubject(args.subjectId);
  const merged = normalizeRoles([...args.claimRoles, ...assignedRoles, ...args.defaultRoles]);
  return merged;
}
