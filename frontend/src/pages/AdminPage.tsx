import { useAdminStats } from "../hooks/api/useAdminStats";
import { useUserMe } from "../hooks/api/useUser";
import AdminLayout, {
  ADM,
  Kpi,
  SectionH,
  TopBar,
  Btn,
} from "../components/AdminLayout";

const ACTIVITY_LABELS: Record<string, string> = {
  watched: "Watched",
  currently_watching: "Currently Watching",
  want_to_watch: "Want to Watch",
  rated: "Rated",
  episode_watched: "Ep. Watched",
};

const TIER_COLOR: Record<string, string> = {
  free: "#94a3b8",
  premium: ADM.amber,
  admin: ADM.rose,
};

export default function AdminPage() {
  const { data: me } = useUserMe();
  const { data: stats, isLoading, isError, refetch } = useAdminStats();

  if (me && me.subscription_tier !== "admin") {
    return (
      <AdminLayout>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontFamily: ADM.mono, fontSize: 12, color: ADM.textDim }}>
            ACCESS DENIED
          </span>
        </div>
      </AdminLayout>
    );
  }

  if (isLoading) {
    return (
      <AdminLayout>
        <TopBar crumb="ADMIN /" title="Console" />
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              border: `2px solid ${ADM.primary}`,
              borderTopColor: "transparent",
              animation: "spin 0.8s linear infinite",
            }}
          />
        </div>
      </AdminLayout>
    );
  }

  if (isError || !stats) {
    return (
      <AdminLayout>
        <TopBar crumb="ADMIN /" title="Console" />
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontFamily: ADM.mono, fontSize: 12, color: ADM.rose }}>
            FAILED TO LOAD STATS
          </span>
        </div>
      </AdminLayout>
    );
  }

  const { users, tracking, activity, social, top_shows, top_movies, growth } = stats;
  const totalTracked =
    tracking.total_watchlist +
    tracking.total_watched +
    tracking.total_currently_watching;

  const tierEntries = [
    { key: "free", label: "FREE", count: users.tier_breakdown.free ?? 0 },
    { key: "premium", label: "PREMIUM", count: users.tier_breakdown.premium ?? 0 },
    { key: "admin", label: "ADMIN", count: users.tier_breakdown.admin ?? 0 },
  ];

  const freeW = users.total > 0 ? ((users.tier_breakdown.free ?? 0) / users.total) * 100 : 0;
  const premW = users.total > 0 ? ((users.tier_breakdown.premium ?? 0) / users.total) * 100 : 0;
  const admW = users.total > 0 ? ((users.tier_breakdown.admin ?? 0) / users.total) * 100 : 0;

  const sortedActivity = Object.entries(activity.by_type).sort(([, a], [, b]) => b - a);
  const maxActivity = sortedActivity[0]?.[1] ?? 1;

  const maxShowCount = top_shows[0]?.tracking_count ?? 1;
  const maxMovieCount = top_movies[0]?.tracking_count ?? 1;

  const growthMax = Math.max(...growth.map((g) => g.signups), 1);

  return (
    <AdminLayout>
      {/* Top bar */}
      <TopBar
        crumb="ADMIN /"
        title="Console"
        actions={
          <Btn color="ghost" size="xs" onClick={() => refetch()}>
            REFRESH ↻
          </Btn>
        }
      />

      {/* KPI band */}
      <div
        style={{
          padding: "14px 18px 8px",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <Kpi label="Total Users" value={users.total} sub={`${users.new_7d} new this week`} />
        <Kpi label="New (7d)" value={users.new_7d} sub={`${users.new_30d} new this month`} />
        <Kpi
          label="Email Notifs On"
          value={users.email_notifications_enabled}
          sub={`${users.total > 0 ? Math.round((users.email_notifications_enabled / users.total) * 100) : 0}% of users`}
        />
        <Kpi
          label="Total Tracked"
          value={totalTracked}
          sub={`WL ${tracking.total_watchlist.toLocaleString()} · W ${tracking.total_watched.toLocaleString()}`}
        />
        <Kpi
          label="Currently Watching"
          value={tracking.total_currently_watching}
          sub="active shows"
        />
        <Kpi
          label="Episodes Watched"
          value={tracking.total_episodes_watched}
          sub="all time"
        />
        <Kpi
          label="Activity (7d)"
          value={activity.last_7d}
          sub={`${activity.last_30d.toLocaleString()} last 30d`}
        />
        <Kpi
          label="Social"
          value={social.total_friendships}
          sub={`${social.total_followers} followers`}
        />
      </div>

      {/* Tier + activity + growth strip */}
      <div
        style={{
          padding: "6px 18px 14px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1.4fr",
          gap: 8,
          flexShrink: 0,
        }}
      >
        {/* Tier breakdown */}
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
              marginBottom: 8,
            }}
          >
            Subscription tier breakdown
          </div>
          <div
            style={{
              display: "flex",
              height: 8,
              borderRadius: 4,
              overflow: "hidden",
              marginBottom: 10,
            }}
          >
            <div style={{ width: `${freeW}%`, background: "#475569" }} />
            <div style={{ width: `${premW}%`, background: ADM.amber }} />
            <div style={{ width: `${admW}%`, background: ADM.rose }} />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              fontFamily: ADM.mono,
              fontSize: 11,
            }}
          >
            {tierEntries.map((t) => (
              <div key={t.key}>
                <span style={{ color: TIER_COLOR[t.key], fontSize: 10 }}>
                  ● {t.label}
                </span>
                <div
                  style={{
                    color: ADM.text,
                    fontSize: 16,
                    fontWeight: 600,
                    marginTop: 2,
                    fontFamily: ADM.sans,
                  }}
                >
                  {t.count.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Activity by type */}
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
              marginBottom: 8,
            }}
          >
            Activity by type
          </div>
          {sortedActivity.slice(0, 5).map(([type, count]) => {
            const pct = Math.round((count / maxActivity) * 100);
            return (
              <div
                key={type}
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 1fr 50px",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 5,
                  fontFamily: ADM.mono,
                  fontSize: 10.5,
                }}
              >
                <span style={{ color: ADM.textMuted, whiteSpace: "nowrap" }}>
                  {ACTIVITY_LABELS[type] ?? type}
                </span>
                <div
                  style={{
                    height: 4,
                    background: ADM.surface3,
                    borderRadius: 99,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: ADM.primary,
                      borderRadius: 99,
                    }}
                  />
                </div>
                <span style={{ color: ADM.textMuted, textAlign: "right" }}>
                  {count.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>

        {/* Signups chart */}
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
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontFamily: ADM.mono,
                fontSize: 9.5,
                color: ADM.textDim,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              Signups · last {growth.length}d
            </span>
            <span style={{ flex: 1 }} />
            <span
              style={{
                fontFamily: ADM.mono,
                fontSize: 10.5,
                color: ADM.primary,
              }}
            >
              {users.new_7d} this week
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 3,
              height: 56,
            }}
          >
            {growth.map((d, i) => {
              const h = Math.max((d.signups / growthMax) * 100, 4);
              const isLast = i === growth.length - 1;
              return (
                <div
                  key={d.date}
                  title={`${d.date}: ${d.signups}`}
                  style={{ flex: 1, display: "flex", alignItems: "flex-end", height: "100%" }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: `${h}%`,
                      background: isLast ? ADM.primary : ADM.borderStrong,
                      borderRadius: 2,
                      minHeight: 3,
                    }}
                  />
                </div>
              );
            })}
          </div>
          {growth.length > 0 && (
            <div
              style={{
                fontFamily: ADM.mono,
                fontSize: 9.5,
                color: ADM.textDim,
                marginTop: 4,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>{growth[0]?.date?.slice(5)}</span>
              <span>TODAY</span>
            </div>
          )}
        </div>
      </div>

      {/* Top tracked content */}
      <div
        style={{
          padding: "0 18px 18px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          flex: 1,
        }}
      >
        {/* Top shows */}
        <div
          style={{
            background: ADM.surface,
            border: `1px solid ${ADM.border}`,
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <SectionH>⊞ Top tracked shows</SectionH>
          <div style={{ padding: "8px 14px" }}>
            {top_shows.length === 0 ? (
              <span
                style={{
                  fontFamily: ADM.mono,
                  fontSize: 11,
                  color: ADM.textDim,
                }}
              >
                No data yet.
              </span>
            ) : (
              top_shows.map((show, i) => {
                const pct = Math.round((show.tracking_count / maxShowCount) * 100);
                return (
                  <div
                    key={show.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "24px 1fr 60px",
                      alignItems: "center",
                      gap: 10,
                      padding: "5px 0",
                      fontSize: 12,
                      fontFamily: ADM.mono,
                    }}
                  >
                    <span style={{ color: ADM.textDim }}>{i + 1}</span>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: ADM.sans,
                          fontWeight: 500,
                          fontSize: 12,
                          color: ADM.text,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          width: 140,
                        }}
                      >
                        {show.name}
                      </span>
                      <div
                        style={{
                          flex: 1,
                          height: 4,
                          background: ADM.surface3,
                          borderRadius: 99,
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: "100%",
                            background: ADM.primary,
                            borderRadius: 99,
                          }}
                        />
                      </div>
                    </div>
                    <span
                      style={{
                        textAlign: "right",
                        color: ADM.textMuted,
                      }}
                    >
                      {show.tracking_count.toLocaleString()}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Top movies */}
        <div
          style={{
            background: ADM.surface,
            border: `1px solid ${ADM.border}`,
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <SectionH>⊞ Top tracked movies</SectionH>
          <div style={{ padding: "8px 14px" }}>
            {top_movies.length === 0 ? (
              <span
                style={{
                  fontFamily: ADM.mono,
                  fontSize: 11,
                  color: ADM.textDim,
                }}
              >
                No data yet.
              </span>
            ) : (
              top_movies.map((movie, i) => {
                const pct = Math.round(
                  (movie.tracking_count / maxMovieCount) * 100
                );
                return (
                  <div
                    key={movie.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "24px 1fr 60px",
                      alignItems: "center",
                      gap: 10,
                      padding: "5px 0",
                      fontSize: 12,
                      fontFamily: ADM.mono,
                    }}
                  >
                    <span style={{ color: ADM.textDim }}>{i + 1}</span>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: ADM.sans,
                          fontWeight: 500,
                          fontSize: 12,
                          color: ADM.text,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          width: 140,
                        }}
                      >
                        {movie.title}
                      </span>
                      <div
                        style={{
                          flex: 1,
                          height: 4,
                          background: ADM.surface3,
                          borderRadius: 99,
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: "100%",
                            background: ADM.blue,
                            borderRadius: 99,
                          }}
                        />
                      </div>
                    </div>
                    <span
                      style={{
                        textAlign: "right",
                        color: ADM.textMuted,
                      }}
                    >
                      {movie.tracking_count.toLocaleString()}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
