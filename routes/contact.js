const express = require("express");
const router  = express.Router();
const Contact = require("../models/Contact");

// POST /api/contact — save a contact/inquiry message
router.post("/", async (req, res) => {
  try {
    const { name, phone, subject, message } = req.body;

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        error_msg: "Name and phone number are required.",
      });
    }

    const contact = new Contact({ name, phone, subject, message });
    await contact.save();

    res.status(201).json({
      success: true,
      error: false,
      message: "Message received. We will get back to you shortly.",
      data: { id: contact._id },
    });
  } catch (err) {
    console.error("[contact POST]", err.message);
    res.status(500).json({ success: false, error: true, error_msg: "Server error. Please try again." });
  }
});

// GET /api/contact — list all messages (admin use)
router.get("/", async (req, res) => {
  try {
    const { page = 1, limit = 50, read } = req.query;
    const filter = {};
    if (read !== undefined) filter.read = read === "true";

    const total    = await Contact.countDocuments(filter);
    const messages = await Contact
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .select("-__v");

    res.json({ success: true, total, page: Number(page), data: messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/contact/:id/read — mark a message as read
router.patch("/:id/read", async (req, res) => {
  try {
    const msg = await Contact.findByIdAndUpdate(
      req.params.id,
      { read: true },
      { new: true }
    );
    if (!msg) return res.status(404).json({ success: false, error_msg: "Message not found." });
    res.json({ success: true, data: msg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
