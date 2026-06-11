import { HomeClient } from "@/app/home-client";

function getInitialMessage(googleState?: string) {
  if (googleState === "connected") {
    return "Google account connected. New tasks can now sync automatically.";
  }

  if (googleState === "invalid-state") {
    return "Google connection could not be completed. Please try again.";
  }

  if (googleState === "missing-config") {
    return "Google settings are missing. Add the required environment variables first.";
  }

  return "";
}

export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const params = await searchParams;
  const googleState = params.google;

  return (
    <HomeClient
      initialMessage={getInitialMessage(googleState)}
      shouldCleanQuery={Boolean(googleState)}
    />
  );
}
