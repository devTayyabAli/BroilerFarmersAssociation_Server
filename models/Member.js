const mongoose = require("mongoose");

const MemberSchema = new mongoose.Schema(
  {
    name:                { type: String, required: true, trim: true },
    FatherName:          { type: String, trim: true },
    cnicNo:              { type: String, trim: true },
    Qualification:       { type: String, trim: true },
    noOfForm:            { type: Number },
    totalBirds:          { type: Number },
    permanentResidency:  { type: String, required: true, trim: true },
    businessResidency:   { type: String, trim: true },
    tehsil:              { type: String, trim: true },
    district:            { type: String, trim: true },
    cellNO:              { type: String, required: true, trim: true },
    phoneNumber:         { type: String, trim: true },
    email:               { type: String, trim: true, lowercase: true },
    status:              { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  },
  { timestamps: true }
);

// Prevent duplicate CNIC
MemberSchema.index({ cnicNo: 1 }, { unique: true, sparse: true });
// Prevent duplicate cell number
MemberSchema.index({ cellNO: 1 }, { unique: true });

module.exports = mongoose.model("Member", MemberSchema);
