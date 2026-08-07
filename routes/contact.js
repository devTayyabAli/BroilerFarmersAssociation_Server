const express = require("express");
const router  = express.Router();
const Contact = require("../models/Contact");

// POST /api/contact — save a contact message
router.post("/", async (req, res) => {
  try {
    const { name, phone, subject, message } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ success: false, error: "Name and phone are required." });
    }

    const msg = new Contact({ name, phone, subject, message });
    await msg.save();

    res.status(201).json({ success: true, message: "Message sent successfully." });
  } catch (err) {
    console.error("[contact POST]", err.message);
    res.status(500).json({ success: false, error: "Server error. Please try again." });
  }
});

// GET /api/contact — list messages (admin)
router.get("/", async (req, res) => {
  try {
    const messages = await Contact.find().sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
