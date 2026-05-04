import { asAppRole, type Role } from "@/lib/labels";

export function asRole(role: string): Role {
  return asAppRole(role);
}

export const can = {
  manageUsers(role: string): boolean {
    return asAppRole(role) === "admin";
  },
  accessAdmin(role: string): boolean {
    return asAppRole(role) === "admin";
  },
  isAdmin(role: string): boolean {
    return asAppRole(role) === "admin";
  },
};

export type BoardRole = "owner" | "member";

export function isBoardOwner(role: BoardRole | string | undefined): boolean {
  return role === "owner";
}
