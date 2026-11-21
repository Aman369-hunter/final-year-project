// Section 5: every case query is scoped by role. A case outside the scope is
// treated as not existing (404), so ids can't be probed.
//
//  patient → only cases for their own patient record
//  lab     → cases at their facility, once submitted (never someone's DRAFT)
//  doctor  → their facility's worklist: cases at the doctor stage or decided
//  admin   → no case access (manages accounts only)
const DOCTOR_STATES = ['DOCTOR_REVIEW', 'REPORTED', 'REFERRED'];

export function caseScopeFor(user) {
  switch (user.role) {
    case 'patient':
      return { patientUser: user._id };
    case 'lab':
      return { facility: user.facility ?? '__none__', state: { $ne: 'DRAFT' } };
    case 'doctor':
      return { facility: user.facility ?? '__none__', state: { $in: DOCTOR_STATES } };
    default:
      return { _id: { $exists: false } };
  }
}
