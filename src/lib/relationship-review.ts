export type RelationshipDecision = 'confirmed' | 'rejected';

export async function recordRelationshipReview(client: any, relationshipId: string, decision: RelationshipDecision, actorId: string, reviewedAt = new Date().toISOString(), reviewNote?: string) {
  const update = {
    review_status: decision,
    reviewed_at: reviewedAt,
    reviewed_by: actorId,
    ...(reviewNote?.trim() ? { review_note: reviewNote.trim() } : {}),
  };
  return client.from('case_relationships').update(update).eq('id', relationshipId);
}
