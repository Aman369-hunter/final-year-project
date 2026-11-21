// Section 6.1: the case lifecycle shown to the patient in friendly words.
// The backend already sends a `status_label`; here we add the progress stepper
// and short descriptions. No raw state names are shown to the patient.

// The happy-path steps, in order. LAB_REJECTED and REFERRED are handled as
// special cases on top of this track.
export const STEPS = [
  { key: 'DRAFT', title: 'Your details', blurb: 'Tell us about your symptoms and history.' },
  { key: 'SUBMITTED', title: 'Submitted', blurb: 'Waiting for the lab to begin.' },
  { key: 'LAB_PENDING', title: 'With the lab', blurb: 'Samples and measurements are being taken.' },
  { key: 'DOCTOR_REVIEW', title: 'Doctor review', blurb: 'A doctor is looking at your results.' },
  { key: 'REPORTED', title: 'Report ready', blurb: 'Your doctor has finished the review.' },
];

const STATE_TO_INDEX = {
  DRAFT: 0,
  SUBMITTED: 1,
  LAB_REJECTED: 1, // back near the start — a new sample is needed
  LAB_PENDING: 2,
  DOCTOR_REVIEW: 3,
  REPORTED: 4,
  REFERRED: 4,
};

export function stepIndex(state) {
  return STATE_TO_INDEX[state] ?? 0;
}

export function isRejected(state) {
  return state === 'LAB_REJECTED';
}

// A case the patient can still edit + submit.
export function isEditable(state) {
  return state === 'DRAFT' || state === 'LAB_REJECTED';
}

// A finished case whose outcome the doctor may have released.
export function isComplete(state) {
  return state === 'REPORTED' || state === 'REFERRED';
}
