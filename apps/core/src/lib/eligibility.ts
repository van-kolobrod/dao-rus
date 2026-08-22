export type MembershipSubject = {
  membershipStatus: string;
};

export function isCurrentMember(participant: MembershipSubject): boolean {
  return participant.membershipStatus === "participant";
}

export function canCreateProposal(participant: MembershipSubject): boolean {
  return isCurrentMember(participant);
}
