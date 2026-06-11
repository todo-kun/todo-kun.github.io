import { HomeClient } from "@/app/home-client";

function getInitialMessage(googleState?: string, reason?: string) {
  if (googleState === "connected") {
    return "Google account connected. New tasks can now sync automatically.";
  }

  if (googleState === "invalid-state") {
    return "Google connection could not be completed. Please try again.";
  }

  if (googleState === "missing-config") {
    return "Google settings are missing. Add the required environment variables first.";
  }

  if (googleState === "oauth-error") {
    return reason
      ? `Google connection was cancelled or blocked: ${reason}`
      : "Google connection was cancelled or blocked.";
  }

  if (googleState === "token-error") {
    return "Google returned an authorization code, but the app could not finish the sign-in. Please review the OAuth client settings and try again.";
  }

  return "";
}

export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ google?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const googleState = params.google;
  const reason = params.reason;

  return (
    <HomeClient
      initialMessage={getInitialMessage(googleState, reason)}
      shouldCleanQuery={Boolean(googleState)}
    />
  );
}
