const mongoose = require("mongoose");

const ContactSchema = new mongoose.Schema(
  {
    name:    { type: String, required: true, trim: true },
    phone:   { type: String, required: true, trim: true },
    subject: { type: String, trim: true },
    message: { type: String, trim: true },
    read:    { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Contact", ContactSchema);
