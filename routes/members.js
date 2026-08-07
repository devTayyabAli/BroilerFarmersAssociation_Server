const express = require("express");
const router  = express.Router();
const Member  = require("../models/Member");

// POST /api/members — register a new member
router.post("/", async (req, res) => {
  try {
    const {
      name, FatherName, cnicNo, Qualification,
      noOfForm, totalBirds,
      permanentResidency, businessResidency,
      tehsil, district,
      cellNO, phoneNumber, email,
    } = req.body;

    // Required field check
    if (!name || !permanentResidency || !cellNO) {
      return res.status(400).json({
        success: false,
        error_msg: "Name, permanent address, and cell number are required.",
      });
    }

    // Sanitize CNIC — strip dashes if present
    const cleanCNIC = cnicNo ? cnicNo.replace(/-/g, "").trim() : undefined;

    const member = new Member({
      name, FatherName, cnicNo: cleanCNIC, Qualification,
      noOfForm: noOfForm ? Number(noOfForm) : undefined,
      totalBirds: totalBirds ? Number(totalBirds) : undefined,
      permanentResidency, businessResidency,
      tehsil, district,
      cellNO, phoneNumber, email,
    });

    await member.save();

    res.status(201).json({
      success: true,
      error: false,
      message: "Member registered successfully.",
      data: { id: member._id, name: member.name },
    });
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      const label = field === "cellNO" ? "Cell number" : "CNIC";
      return res.status(409).json({
        success: false,
        error: true,
        error_msg: `${label} already registered.`,
      });
    }
    console.error("[members POST]", err.message);
    res.status(500).json({ success: false, error: true, error_msg: "Server error. Please try again." });
  }
});

// GET /api/members — list all (admin use, no auth for now)
router.get("/", async (req, res) => {
  try {
    const { page = 1, limit = 50, district, status } = req.query;
    const filter = {};
    if (district) filter.district = new RegExp(district, "i");
    if (status)   filter.status   = status;

    const total   = await Member.countDocuments(filter);
    const members = await Member
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .select("-__v");

    res.json({ success: true, total, page: Number(page), data: members });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
