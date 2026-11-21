import mongoose from 'mongoose';
import { ROLES } from '../domain.js';

const RefreshTokenSchema = new mongoose.Schema(
  {
    hash: { type: String, required: true }, // sha256 of the opaque token; the token itself is never stored
    expiresAt: { type: Date, required: true },
  },
  { _id: false },
);

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true }, // the account's primary role
    // Section 5 is role-based, not account-based. A project/demo account may be
    // allowed to act as several roles; the ACTIVE role lives in the access token
    // and every filter downstream (caseScope, casePresenter, predictionFilter)
    // keys off it, so a single login never widens what a role may see.
    roles: { type: [String], enum: ROLES, default: undefined },
    // Labs and doctors are scoped to a facility (Section 5). Patients belong to one too.
    facility: { type: String, trim: true, maxlength: 64 },
    active: { type: Boolean, default: true },
    refreshTokens: { type: [RefreshTokenSchema], default: [], select: false },
  },
  { timestamps: true },
);

UserSchema.index({ 'refreshTokens.hash': 1 });

// The roles this account may switch between. Falls back to its single role.
UserSchema.methods.allowedRoles = function allowedRoles() {
  return this.roles?.length ? this.roles : [this.role];
};

UserSchema.methods.toPublic = function toPublic() {
  return {
    id: this.id,
    name: this.name,
    email: this.email,
    role: this.role,
    roles: this.allowedRoles(),
    facility: this.facility ?? null,
  };
};

export const User = mongoose.models.User || mongoose.model('User', UserSchema);
