import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";
import { useAuthUser } from "../useAuthUser";

export function useMyActivity() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.myActivity(user?.uid ?? ""),
    queryFn: () => queryFetch("/friends/my-activity"),
    enabled: !!user,
  });
}

export function useFriendsActivity() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.friendsActivity(user?.uid ?? ""),
    queryFn: () => queryFetch("/friends/activity"),
    enabled: !!user,
  });
}
