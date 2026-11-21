import { AuditLog } from '../models/AuditLog.js';

// Awaited on purpose: if the audit write fails, the request fails.
export async function audit(actor, action, { resourceType, resourceId, patient, meta } = {}) {
  await AuditLog.create({
    actor: actor?._id,
    role: actor?.role,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    patient,
    meta,
  });
}

export function auditCase(actor, action, caseDoc, meta) {
  return audit(actor, action, {
    resourceType: 'case',
    resourceId: caseDoc._id,
    patient: caseDoc.patient?._id ?? caseDoc.patient,
    meta,
  });
}
