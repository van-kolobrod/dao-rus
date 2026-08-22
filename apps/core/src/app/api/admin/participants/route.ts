import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl, hasPrototypeAdminAccess } from "@/lib/config";
import {
  ParticipantRegistryNotFoundError,
  ParticipantRegistryValidationError,
  updateParticipantRegistry,
} from "@/lib/participant-registry";
import { getCurrentParticipant } from "@/lib/session";

export const runtime = "nodejs";

function registryRedirect(status: string) {
  const url = new URL("/admin/participants", appBaseUrl());
  url.searchParams.set("registry_update", status);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) {
    return NextResponse.redirect(new URL("/", appBaseUrl()), 303);
  }
  if (!hasPrototypeAdminAccess(participant.id)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  try {
    const result = await updateParticipantRegistry(
      participant.id,
      formData.get("telegram_user_id"),
      formData.get("field"),
      formData.get("value"),
    );
    return registryRedirect(result.changed ? "updated" : "unchanged");
  } catch (error) {
    if (error instanceof ParticipantRegistryValidationError) {
      return registryRedirect("invalid");
    }
    if (error instanceof ParticipantRegistryNotFoundError) {
      return registryRedirect("not_found");
    }
    throw error;
  }
}
