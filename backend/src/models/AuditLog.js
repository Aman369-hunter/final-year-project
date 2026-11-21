import mongoose from 'mongoose';
import { ROLES } from '../domain.js';

const { ObjectId } = mongoose.Schema.Types;

// Section 5: who viewed or modified which patient, and when.
// Holds ids only, no names or clinical values.
const AuditLogSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true, default: Date.now, index: true },
    actor: { type: ObjectId, ref: 'User' },
    role: { type: String, enum: ROLES },
    action: { type: String, required: true }, // e.g. case.view, case.transition, auth.login
    resource_type: { type: String, enum: ['case', 'patient', 'user', 'assessment', 'predict'] },
    resource_id: { type: ObjectId },
    patient: { type: ObjectId, ref: 'Patient', index: true },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { versionKey: false },
);

// Append-only through the model: updates and deletes are refused.
// (The dev seed script wipes the raw collection directly; nothing else should.)
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  AuditLogSchema.pre(op, function blockMutation() {
    throw new Error('Audit log is append-only');
  });
}

export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
