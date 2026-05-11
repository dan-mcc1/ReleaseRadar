import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";
import { apiFetch } from "../../utils/apiFetch";
import { useAuthUser } from "../useAuthUser";

export function useMyBlocks() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.myBlocks(user?.uid ?? ""),
    queryFn: () => queryFetch("/moderation/blocks"),
    enabled: !!user,
  });
}

export function useBlockUser() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/moderation/block/${userId}`, { method: "POST" }),
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
      apiFetch(`/moderation/block/${userId}`, { method: "DELETE" }),
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
  reported_type: "review" | "user";
  reported_id: string;
  reason: ReportReason;
  message?: string;
}

export function useSubmitReport() {
  return useMutation({
    mutationFn: (payload: SubmitReportPayload) =>
      apiFetch("/moderation/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
  });
}

// ── Admin hooks ────────────────────────────────────────────────────────────────

export function useAdminReports(status: "pending" | "accepted" | "rejected" = "pending") {
  return useQuery({
    queryKey: queryKeys.adminReports(status),
    queryFn: () => queryFetch(`/admin/reports?status=${status}`),
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
      apiFetch(`/admin/reports/${reportId}/accept`, {
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
      apiFetch(`/admin/reports/${reportId}/reject`, {
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
      apiFetch(`/admin/users/${userId}/unsuspend`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useAdminSuspendUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, days, reason }: { userId: string; days: number; reason?: string }) =>
      apiFetch(`/admin/users/${userId}/suspend`, {
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
      apiFetch(`/admin/users/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useAdminAppeals(status: "pending" | "approved" | "rejected" = "pending") {
  return useQuery({
    queryKey: ["admin", "appeals", status],
    queryFn: () => queryFetch(`/admin/appeals?status=${status}`),
  });
}

export function useApproveAppeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ appealId, adminNotes, liftSilence }: { appealId: number; adminNotes?: string; liftSilence?: boolean }) =>
      apiFetch(`/admin/appeals/${appealId}/approve`, {
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
      apiFetch(`/admin/appeals/${appealId}/reject`, {
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
    queryFn: () =>
      queryFetch(`/admin/users?search=${encodeURIComponent(search)}&skip=${skip}&limit=50`),
  });
}

export function usePromoteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, tier }: { userId: string; tier: string }) =>
      apiFetch(`/admin/users/${userId}/tier`, {
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
      apiFetch(`/admin/users/${userId}/ban`, {
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
      apiFetch(`/admin/users/${userId}/unban`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useAdminUnsilenceUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/admin/users/${userId}/unsilence`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useAdminBannedEmails() {
  return useQuery({
    queryKey: ["admin", "banned-emails"],
    queryFn: () =>
      queryFetch<{ id: number; email: string; user_id: string | null; banned_at: string }[]>(
        "/admin/banned-emails"
      ),
  });
}

export function useAdminRemoveBannedEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: number) =>
      apiFetch(`/admin/banned-emails/${entryId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "banned-emails"] });
    },
  });
}
