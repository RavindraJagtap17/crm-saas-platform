const express = require("express");

const router = express.Router();

// GET /health — used by Plesk/Passenger (and anyone else) to check the API is up.
router.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
