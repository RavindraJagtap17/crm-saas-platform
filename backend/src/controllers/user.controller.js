const userService = require("../services/userService");
const asyncHandler = require("../utils/asyncHandler");

// Step 11A: now also returns `invitations` (pending, this Client's own)
// and `seatUsage` (informational — the backend remains authoritative on
// every write path regardless of what this shows).
const list = asyncHandler(async (req, res) => {
  res.json(await userService.list(req.clientId));
});

const invite = asyncHandler(async (req, res) => {
  const result = await userService.invite(req.clientId, req.body, req.user.sub);
  res.status(201).json(result);
});

// Step 11A — cancels a pending invitation belonging to this Client only.
const cancelInvitation = asyncHandler(async (req, res) => {
  const invitation = await userService.cancelInvitation(req.clientId, req.params.id);
  res.json({ invitation });
});

const setStatus = asyncHandler(async (req, res) => {
  const user = await userService.setStatus(req.clientId, req.params.id, req.body);
  res.json({ user });
});

module.exports = { list, invite, cancelInvitation, setStatus };
