/**
 * "Powered by Strava" attribution badge.
 *
 * Required by Strava's API Brand Guidelines whenever data sourced from
 * the Strava API is displayed. The wordmark uses Strava's official orange
 * (#FC4C02). The badge links to strava.com per their attribution rules.
 *
 * Used wherever Strava-sourced data is rendered to the user (settings
 * page, freshness card when Strava-sourced data has been imported).
 *
 * NOTE: Strava's brand kit distributes the official SVG wordmark from
 * the developer dashboard. Swap the placeholder triangle for the
 * official SVG once you have it from your Strava API app.
 */
export function StravaPoweredBadge({
  variant = "default",
}: {
  /** "default" = full badge; "compact" = small inline mark. */
  variant?: "default" | "compact";
}) {
  const fontSize = variant === "compact" ? 10 : 11;
  const padding = variant === "compact" ? "2px 6px" : "4px 8px";
  return (
    <a
      href="https://www.strava.com"
      target="_blank"
      rel="noreferrer noopener"
      aria-label="Powered by Strava"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding,
        borderRadius: 999,
        background: "transparent",
        border: "1px solid #FC4C02",
        textDecoration: "none",
        fontSize,
        lineHeight: 1,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "#FC4C02",
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden style={{ fontSize: variant === "compact" ? 10 : 11 }}>▲</span>
      <span>Powered by Strava</span>
    </a>
  );
}
