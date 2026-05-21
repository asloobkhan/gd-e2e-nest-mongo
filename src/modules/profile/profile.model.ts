import { Schema, Document, Types } from 'mongoose';

import { AppRoles } from '../app/app.roles';

export const PROFILE_MODEL_NAME = 'Profile';

export const Profile = new Schema({
  username: { type: String, required: true, unique: true, index: true },
  email: { type: String, required: true },
  name: { type: String, required: true },
  password: { type: String, required: true },
  avatar: { type: String, required: true },
  roles: [{ type: String, enum: Object.values(AppRoles), default: AppRoles.DEFAULT }],
  date: {
    type: Date,
    default: Date.now,
  },
});

export interface IProfile extends Document {
  readonly _id: Types.ObjectId;
  readonly username: string;
  readonly email: string;
  readonly name: string;
  password: string;
  readonly avatar: string;
  readonly roles: AppRoles[];
  readonly date: Date;
}
