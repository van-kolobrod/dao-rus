import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import {
  DisplayNameValidationError,
  updateParticipantDisplayName,
} from "@/lib/profile";
import { getCurrentParticipant } from "@/lib/session";

export const runtime = "nodejs";

function profileRedirect(status: string) {
  const url = new URL("/profile", appBaseUrl());
  url.searchParams.set("profile_update", status);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) {
    return NextResponse.redirect(new URL("/", appBaseUrl()), 303);
  }

  const formData = await request.formData();

  try {
    const result = await updateParticipantDisplayName(
      participant.id,
      formData.get("display_name"),
    );
    return profileRedirect(result.changed ? "updated" : "unchanged");
  } catch (error) {
    if (error instanceof DisplayNameValidationError) {
      return profileRedirect("empty_name");
    }
    throw error;
  }
}
