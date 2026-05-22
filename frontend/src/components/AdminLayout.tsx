import { Link, useLocation } from "react-router-dom";
import { useUserMe } from "../hooks/api/useUser";
import type { ReactNode, CSSProperties } from "react";

export const ADM = {
  bg: "#0a0a0a",
  surface: "#111111",
  surface2: "#171717",
  surface3: "#1f1f1f",
  border: "rgba(255,255,255,0.07)",
  borderStrong: "rgba(255,255,255,0.14)",
  text: "#e5e5e5",
  textMuted: "rgba(229,229,229,0.62)",
  textDim: "rgba(229,229,229,0.4)",
  primary: "#10b981",
  primarySoft: "rgba(16,185,129,0.14)",
  amber: "#fbbf24",
  amberSoft: "rgba(251,191,36,0.13)",
  rose: "#fb7185",
  roseSoft: "rgba(251,113,133,0.13)",
  blue: "#60a5fa",
  blueSoft: "rgba(96,165,250,0.13)",
  purple: "#a78bfa",
  purpleSoft: "rgba(167,139,250,0.13)",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
  sans: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif",
} as const;

const NAV_GROUPS = [
  {
    title: "OVERVIEW",
    items: [{ id: "console", label: "Console", icon: "◉", to: "/admin" }],
  },
  {
    title: "MODERATION",
    items: [
      { id: "moderation", label: "Reports & Appeals", icon: "⚐", to: "/admin/moderation" },
    ],
  },
  {
    title: "DATA",
    items: [
      { id: "users", label: "Users", icon: "◍", to: "/admin/users" },
      { id: "feedback", label: "Feedback", icon: "◎", to: "/admin/feedback" },
    ],
  },
];

function getActiveId(pathname: string) {
  if (pathname.startsWith("/admin/moderation")) return "moderation";
  if (pathname.startsWith("/admin/users")) return "users";
  if (pathname.startsWith("/admin/feedback")) return "feedback";
  return "console";
}

function AdminSidebar() {
  const { pathname } = useLocation();
  const { data: me } = useUserMe();
  const active = getActiveId(pathname);
  const initials = me?.username ? me.username.slice(0, 2).toUpperCase() : "AD";

  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: `1px solid ${ADM.border}`,
        background: ADM.surface,
        padding: "14px 0",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        height: "100%",
        overflowY: "auto",
      }}
    >
      {/* Logo row */}
      <div
        style={{
          padding: "6px 16px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke={ADM.primary} strokeWidth="2" />
          <circle cx="12" cy="12" r="4" fill={ADM.primary} />
          <line x1="12" y1="2" x2="12" y2="6" stroke={ADM.primary} strokeWidth="2" />
          <line x1="12" y1="18" x2="12" y2="22" stroke={ADM.primary} strokeWidth="2" />
          <line x1="2" y1="12" x2="6" y2="12" stroke={ADM.primary} strokeWidth="2" />
          <line x1="18" y1="12" x2="22" y2="12" stroke={ADM.primary} strokeWidth="2" />
        </svg>
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: ADM.text,
              letterSpacing: "-0.01em",
              fontFamily: ADM.sans,
            }}
          >
            Release Radar
          </div>
          <div
            style={{
              fontFamily: ADM.mono,
              fontSize: 9.5,
              color: ADM.textDim,
              letterSpacing: "0.1em",
            }}
          >
            ADMIN CONSOLE
          </div>
        </div>
      </div>

      {/* Divider */}
      <div
        style={{
          margin: "0 12px 8px",
          borderBottom: `1px solid ${ADM.border}`,
          paddingBottom: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            background: ADM.bg,
            border: `1px solid ${ADM.border}`,
            borderRadius: 6,
            fontSize: 12,
            color: ADM.textMuted,
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke={ADM.textDim}
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <span style={{ fontFamily: ADM.mono, fontSize: 11 }}>Quick find…</span>
        </div>
      </div>

      {/* Nav groups */}
      {NAV_GROUPS.map((g, gi) => (
        <div key={gi} style={{ marginBottom: 10 }}>
          <div
            style={{
              padding: "4px 16px",
              fontFamily: ADM.mono,
              fontSize: 9.5,
              color: ADM.textDim,
              letterSpacing: "0.12em",
              fontWeight: 600,
            }}
          >
            {g.title}
          </div>
          {g.items.map((item) => {
            const isActive = item.id === active;
            return (
              <Link key={item.id} to={item.to} style={{ textDecoration: "none" }}>
                <div
                  style={{
                    margin: "1px 8px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 8px",
                    borderRadius: 5,
                    fontSize: 12.5,
                    fontWeight: isActive ? 500 : 400,
                    color: isActive ? ADM.text : ADM.textMuted,
                    background: isActive ? ADM.surface3 : "transparent",
                    cursor: "pointer",
                    fontFamily: ADM.sans,
                  }}
                >
                  <span
                    style={{
                      fontFamily: ADM.mono,
                      fontSize: 12,
                      color: isActive ? ADM.primary : ADM.textDim,
                      width: 14,
                      textAlign: "center",
                    }}
                  >
                    {item.icon}
                  </span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ))}

      <div style={{ flex: 1 }} />

      {/* Back to site */}
      <div style={{ padding: "0 8px 8px" }}>
        <Link to="/" style={{ textDecoration: "none" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 8px",
              borderRadius: 5,
              fontSize: 12,
              color: ADM.textDim,
              fontFamily: ADM.sans,
              cursor: "pointer",
            }}
          >
            <span style={{ fontFamily: ADM.mono, fontSize: 12 }}>←</span>
            <span>Back to site</span>
          </div>
        </Link>
      </div>

      {/* User footer */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: `1px solid ${ADM.border}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: ADM.roseSoft,
            border: `1.5px solid ${ADM.rose}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: ADM.mono,
            fontSize: 10,
            fontWeight: 700,
            color: ADM.rose,
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: ADM.text,
              fontFamily: ADM.sans,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {me?.username ? `@${me.username}` : "Admin"}
          </div>
          <div
            style={{
              fontFamily: ADM.mono,
              fontSize: 9.5,
              color: ADM.rose,
              letterSpacing: "0.08em",
            }}
          >
            ● ADMIN
          </div>
        </div>
      </div>
    </aside>
  );
}

// ── Shared building blocks ─────────────────────────────────────────────

export function Pill({
  children,
  color = ADM.text,
  bg,
  style,
}: {
  children: ReactNode;
  color?: string;
  bg?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 6px",
        borderRadius: 3,
        fontFamily: ADM.mono,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        color,
        background: bg || `${color}1a`,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function Kpi({
  label,
  value,
  sub,
  delta,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  delta?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: ADM.surface,
        border: `1px solid ${ADM.border}`,
        borderRadius: 8,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          fontFamily: ADM.mono,
          fontSize: 9.5,
          color: ADM.textDim,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          marginTop: 4,
        }}
      >
        <span
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: color || ADM.text,
            fontFamily: ADM.sans,
          }}
        >
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
        {delta && (
          <span
            style={{
              fontFamily: ADM.mono,
              fontSize: 10.5,
              color: delta.startsWith("+") ? ADM.primary : ADM.rose,
              fontWeight: 600,
            }}
          >
            {delta}
          </span>
        )}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 10.5,
            color: ADM.textMuted,
            marginTop: 3,
            fontFamily: ADM.mono,
            letterSpacing: "0.04em",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

export function Btn({
  children,
  color = "default",
  size = "sm",
  onClick,
  disabled,
  style,
  type,
}: {
  children: ReactNode;
  color?: string;
  size?: "xs" | "sm";
  onClick?: () => void;
  disabled?: boolean;
  style?: CSSProperties;
  type?: "button" | "submit";
}) {
  const variants: Record<string, { bg: string; color: string; border: string }> = {
    default: { bg: "transparent", color: ADM.text, border: ADM.borderStrong },
    primary: { bg: ADM.primary, color: "#001a10", border: "transparent" },
    danger: { bg: "#a31919", color: "#fff", border: "transparent" },
    warn: { bg: "#a16207", color: "#fff", border: "transparent" },
    rose: { bg: ADM.roseSoft, color: ADM.rose, border: "transparent" },
    amber: { bg: ADM.amberSoft, color: ADM.amber, border: "transparent" },
    blue: { bg: ADM.blueSoft, color: ADM.blue, border: "transparent" },
    green: { bg: ADM.primarySoft, color: ADM.primary, border: "transparent" },
    ghost: { bg: "transparent", color: ADM.textMuted, border: ADM.border },
  };
  const v = variants[color] ?? variants.default;
  const padding = size === "xs" ? "3px 7px" : "4px 9px";
  const fontSize = size === "xs" ? 10.5 : 11;
  return (
    <button
      type={type ?? "button"}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding,
        fontFamily: ADM.mono,
        fontSize,
        fontWeight: 600,
        letterSpacing: "0.04em",
        background: v.bg,
        color: v.color,
        border: `1px solid ${v.border}`,
        borderRadius: 4,
        cursor: disabled ? "not-allowed" : "pointer",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function SectionH({
  children,
  action,
  count,
}: {
  children: ReactNode;
  action?: ReactNode;
  count?: string | number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderBottom: `1px solid ${ADM.border}`,
        fontFamily: ADM.mono,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: ADM.text,
        flexShrink: 0,
      }}
    >
      {children}
      {count != null && (
        <span style={{ color: ADM.textDim, fontWeight: 400 }}>· {count}</span>
      )}
      <span style={{ flex: 1 }} />
      {action}
    </div>
  );
}

export function TopBar({
  crumb,
  title,
  sub,
  actions,
}: {
  crumb: string;
  title: string;
  sub?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        height: 44,
        padding: "0 18px",
        borderBottom: `1px solid ${ADM.border}`,
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: ADM.surface,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontFamily: ADM.mono,
          fontSize: 11,
          color: ADM.textDim,
          letterSpacing: "0.08em",
        }}
      >
        {crumb}
      </span>
      <h1
        style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: "-0.005em",
          color: ADM.text,
          fontFamily: ADM.sans,
        }}
      >
        {title}
      </h1>
      {sub && (
        <span
          style={{
            fontFamily: ADM.mono,
            fontSize: 10.5,
            color: ADM.textDim,
          }}
        >
          {sub}
        </span>
      )}
      <span style={{ flex: 1 }} />
      {actions}
    </div>
  );
}

// ── Main layout wrapper ────────────────────────────────────────────────

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: ADM.bg,
        color: ADM.text,
        fontFamily: ADM.sans,
      }}
    >
      <AdminSidebar />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </div>
    </div>
  );
}
