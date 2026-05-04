import { type Role, ROLES } from "@/lib/labels";

export function asRole(role: string): Role {
  return (ROLES as readonly string[]).includes(role) ? (role as Role) : "support";
}

export const can = {
  manageUsers(role: string): boolean {
    return asRole(role) === "admin";
  },
  accessAdmin(role: string): boolean {
    return asRole(role) === "admin";
  },
  isAdmin(role: string): boolean {
    return asRole(role) === "admin";
  },
};

export type BoardRole = "owner" | "member";

export function isBoardOwner(role: BoardRole | string | undefined): boolean {
  return role === "owner";
}
