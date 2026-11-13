import { getAvatarColor } from "../constants";

/** A round initial on the member's chosen avatar colour. */
export default function MemberAvatar({
  name,
  avatarKey,
  size = 28,
}: {
  name: string;
  avatarKey: string | null;
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: getAvatarColor(avatarKey) ?? "#525252",
      }}
      className="inline-flex flex-shrink-0 items-center justify-center rounded-full font-semibold text-white"
    >
      {(name[0] ?? "?").toUpperCase()}
    </span>
  );
}
