import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch, checkedFetch } from "./queryFetch";
import { useAuthUser } from "../useAuthUser";

export interface BlockEntry {
  user_id: string;
  username: string | null;
  blocked_at: string;
}

export function useMyBlocks() {
  const user = useAuthUser();
  return useQuery<BlockEntry[]>({
    queryKey: queryKeys.myBlocks(user?.uid ?? ""),
    queryFn: ({ signal }) => queryFetch<BlockEntry[]>("/moderation/blocks", { signal }),
    enabled: !!user,
  });
}

export function useBlockUser() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      checkedFetch(`/moderation/block/${userId}`, { method: "POST" }),
    onSuccess: () => {
      if (!user) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.myBlocks(user.uid) });
    },
  });
}

export function useUnblockUser() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      checkedFetch(`/moderation/block/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      if (!user) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.myBlocks(user.uid) });
    },
  });
}

export type ReportReason =
  | "spam"
  | "harassment"
  | "hate_speech"
  | "inappropriate_content"
  | "misinformation"
  | "other";

export interface SubmitReportPayload {
  reported_type:
    | "review"
    | "user"
    | "community"
    | "community_post"
    | "community_reply";
  reported_id: string;
  reason: ReportReason;
  message?: string;
}

export function useSubmitReport() {
  return useMutation({
    mutationFn: (payload: SubmitReportPayload) =>
      checkedFetch("/moderation/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
  });
}

// â”€â”€ Admin hooks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function useAdminReports(status: "pending" | "accepted" | "rejected" = "pending") {
  return useQuery({
    queryKey: queryKeys.adminReports(status),
    queryFn: ({ signal }) => queryFetch(`/admin/reports?status=${status}`, { signal }),
  });
}

export function useAcceptReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      reportId,
      action,
      adminNotes,
      suspendDays,
    }: {
      reportId: number;
      action: string;
      adminNotes?: string;
      suspendDays?: number;
    }) =>
      checkedFetch(`/admin/reports/${reportId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          admin_notes: adminNotes ?? null,
          suspend_days: suspendDays ?? null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
    },
  });
}

export function useRejectReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      reportId,
      adminNotes,
    }: {
      reportId: number;
      adminNotes?: string;
    }) =>
      checkedFetch(`/admin/reports/${reportId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admin_notes: adminNotes ?? null }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
    },
  });
}

export function useUnsuspendUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      checkedFetch(`/admin/users/${userId}/unsuspend`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useAdminSuspendUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, days, reason }: { userId: string; days: number; reason?: string }) =>
      checkedFetch(`/admin/users/${userId}/suspend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days, reason: reason ?? null }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useAdminDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      checkedFetch(`/admin/users/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useAdminAppeals(status: "pending" | "approved" | "rejected" = "pending") {
  return useQuery({
    queryKey: ["admin", "appeals", status],
    queryFn: ({ signal }) => queryFetch(`/admin/appeals?status=${status}`, { signal }),
  });
}

export function useApproveAppeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ appealId, adminNotes, liftSilence }: { appealId: number; adminNotes?: string; liftSilence?: boolean }) =>
      checkedFetch(`/admin/appeals/${appealId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admin_notes: adminNotes ?? null, lift_silence: liftSilence ?? false }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "appeals"] });
    },
  });
}

export function useRejectAppeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ appealId, adminNotes }: { appealId: number; adminNotes?: string }) =>
      checkedFetch(`/admin/appeals/${appealId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admin_notes: adminNotes ?? null }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "appeals"] });
    },
  });
}

export function useAdminUsers(search: string, skip: number) {
  return useQuery({
    queryKey: queryKeys.adminUsers(search, skip),
    queryFn: ({ signal }) =>
      queryFetch(`/admin/users?search=${encodeURIComponent(search)}&skip=${skip}&limit=50`, { signal }),
  });
}

export function usePromoteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, tier }: { userId: string; tier: string }) =>
      checkedFetch(`/admin/users/${userId}/tier`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useAdminBanUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason?: string }) =>
      checkedFetch(`/admin/users/${userId}/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason ?? null }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useAdminUnbanUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      checkedFetch(`/admin/users/${userId}/unban`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useAdminUnsilenceUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      checkedFetch(`/admin/users/${userId}/unsilence`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useAdminBannedEmails() {
  return useQuery({
    queryKey: ["admin", "banned-emails"],
    queryFn: ({ signal }) =>
      queryFetch<{ id: number; email: string; user_id: string | null; banned_at: string }[]>(
        "/admin/banned-emails",
        { signal },
      ),
  });
}

export function useAdminRemoveBannedEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: number) =>
      checkedFetch(`/admin/banned-emails/${entryId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "banned-emails"] });
    },
  });
}
