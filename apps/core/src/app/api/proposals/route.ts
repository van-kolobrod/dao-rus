import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import { canCreateProposal } from "@/lib/eligibility";
import {
  createProposal,
  ProposalEligibilityError,
  ProposalValidationError,
} from "@/lib/proposals";
import { getCurrentParticipant } from "@/lib/session";

export const runtime = "nodejs";

function proposalsRedirect(status: string) {
  const url = new URL("/proposals", appBaseUrl());
  url.searchParams.set("proposal_create", status);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) {
    return NextResponse.redirect(new URL("/", appBaseUrl()), 303);
  }
  if (!canCreateProposal(participant)) {
    return proposalsRedirect("not_eligible");
  }

  const formData = await request.formData();

  try {
    await createProposal(
      participant.id,
      formData.get("title"),
      formData.get("body"),
    );
    return proposalsRedirect("created");
  } catch (error) {
    if (error instanceof ProposalEligibilityError) {
      return proposalsRedirect("not_eligible");
    }
    if (error instanceof ProposalValidationError) {
      return proposalsRedirect(`empty_${error.field}`);
    }
    throw error;
  }
}
