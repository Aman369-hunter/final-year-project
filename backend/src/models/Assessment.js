import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// Section 5: every prediction response is stored verbatim, so a report stays
// reproducible after the weights change.
const AssessmentSchema = new mongoose.Schema(
  {
    case: { type: ObjectId, ref: 'Case', required: true, index: true },
    patient: { type: ObjectId, ref: 'Patient', required: true },
    response: { type: mongoose.Schema.Types.Mixed, required: true },
    engine_version: String,
    engine_mode: String,
    weights_version: String,
    trigger: { type: String, enum: ['enter_doctor_review', 'lab_data_changed', 'early_review'], required: true },
    created_by: { type: ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);

export const Assessment = mongoose.models.Assessment || mongoose.model('Assessment', AssessmentSchema);
