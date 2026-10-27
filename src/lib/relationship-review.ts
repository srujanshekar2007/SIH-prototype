export type RelationshipDecision = 'confirmed' | 'rejected';

export async function recordRelationshipReview(client: any, relationshipId: string, decision: RelationshipDecision, actorId: string, reviewedAt = new Date().toISOString()) {
  return client.from('case_relationships').update({
    review_status: decision,
    reviewed_at: reviewedAt,
    reviewed_by: actorId,
  }).eq('id', relationshipId);
}
